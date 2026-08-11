// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Polycode Limited

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, join, relative, sep } from "node:path";
import {
  Stack,
  StackProps,
  CfnOutput,
  Duration,
  RemovalPolicy,
  Size,
  Tags,
  aws_s3 as s3,
  aws_s3_assets as s3assets,
  aws_s3_deployment as s3deploy,
  aws_cloudfront as cloudfront,
  aws_cloudfront_origins as origins,
  aws_certificatemanager as acm,
  aws_route53 as route53,
  aws_route53_targets as targets,
  aws_dynamodb as dynamodb,
  aws_lambda as lambda,
  aws_events as events,
  aws_events_targets as events_targets,
  aws_iam as iam,
} from "aws-cdk-lib";
import { Construct } from "constructs";

// The row service's bundle (`npm run build:row-service`, esbuild, AWS SDK
// left external because the Lambda Node runtime ships it) — a sibling of the
// built site, not part of it.
const ROW_SERVICE_DIST_DIR = join(__dirname, "..", "..", "server", "row-service", "dist");

// The turn service's bundle (`npm run build:turn-service`) plus its
// cold-boot seed (`npm run build:turn-seed`, written beside the source
// handler rather than into dist/ — see the mid-seed copy below).
const TURN_SERVICE_DIST_DIR = join(__dirname, "..", "..", "server", "turn-service", "dist");
const TURN_SERVICE_MID_SEED_SOURCE = join(__dirname, "..", "..", "server", "turn-service", "mid-seed.json");

// The news worker's bundle (`npm run build:news-worker`) — its xl seed is
// bundled INSIDE handler.js by esbuild (a static `import()` of
// public/chat-seed.json, §3.22), so unlike the turn service this directory
// needs no sibling file staged beside it.
const NEWS_WORKER_DIST_DIR = join(__dirname, "..", "..", "server", "news-worker", "dist");

export interface WebsiteStackProps extends StackProps {
  readonly envName: string;
  readonly slug: string;
  readonly hostname: string;
  /** ACM cert ARN — MUST be in us-east-1 (CloudFront requirement). */
  readonly certArn: string;
  /** Optional: supply both to have CDK write the Route53 A-record alias. */
  readonly hostedZoneId?: string;
  readonly zoneName?: string;
  /** The row service's session/row TTL, in days (§3.8's `TTL_DAYS`). */
  readonly rowServiceTtlDays?: number;
  /** The row service's hard global row cap (§3.8's `TABLE_ROW_CAP`). */
  readonly rowServiceTableRowCap?: number;
  /** The `/api/*` WAF web ACL's ARN, read cross-region from `EdgeGuardStack`
   *  (its CLOUDFRONT-scope ACL lives in us-east-1, same constraint as the
   *  ACM cert). Omitted, the distribution deploys without a web ACL — the
   *  posture a synth with no edge-guard stack in context still needs to
   *  produce a valid template. */
  readonly webAclArn?: string;
}

// CloudFront only compresses on the fly up to this size; anything larger has
// to be served from a precompressed sibling instead (see findOversizedAssets).
const COMPRESSION_CEILING_BYTES = 10 * 1024 * 1024;

// tmct's built site (`npm run build:ask-bundle && npm run demo:build`) is
// generated, not checked in — unlike seonix's `../site`, this directory only
// exists once the CI job (or an operator) has built it before `cdk deploy`.
const SITE_SOURCE_DIR = join(__dirname, "..", "..", "public");

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  ".json": "application/json",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".html": "text/html",
};

function contentTypeFor(assetPath: string): string {
  return CONTENT_TYPE_BY_EXT[extname(assetPath)] ?? "application/octet-stream";
}

/**
 * Scan the built site for files over CloudFront's 10 MB on-the-fly
 * compression ceiling (today: `chat-seed.json`, 40.5 MB raw). Each one must
 * already have `.br`/`.gz` siblings — `scripts/build-demo-site.mjs`'s
 * precompression pass writes these for every text asset >= 50 KB. Baking the
 * path list in here (rather than guessing inside the CloudFront Function)
 * means the rewrite table always matches the actual build output.
 */
function findOversizedAssets(siteDir: string): string[] {
  if (!existsSync(siteDir)) return [];
  const oversized: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (entry.name.endsWith(".br") || entry.name.endsWith(".gz")) continue;
      if (statSync(full).size <= COMPRESSION_CEILING_BYTES) continue;
      if (!existsSync(`${full}.br`) || !existsSync(`${full}.gz`)) {
        throw new Error(
          `${full} is over the CloudFront compression ceiling but has no .br/.gz sibling — ` +
            "re-run the demo:build precompression pass before deploying.",
        );
      }
      oversized.push(`/${relative(siteDir, full).split(sep).join("/")}`);
    }
  };
  walk(siteDir);
  return oversized;
}

function oversizedRewriteFunctionSource(oversizedPaths: string[]): string {
  // JS 2.0 CloudFront Function: for the baked-in oversized paths only, swap
  // in the precompressed sibling by Accept-Encoding. CACHING_OPTIMIZED already
  // folds Accept-Encoding into the cache key, so no custom cache policy is
  // needed. Every other tmct URL has a file extension, so (unlike seonix's
  // template) no SPA-style extensionless rewrite is needed here.
  return [
    "function handler(event) {",
    "  var request = event.request;",
    `  var oversized = ${JSON.stringify(oversizedPaths)};`,
    "  if (oversized.indexOf(request.uri) === -1) { return request; }",
    "  var enc = request.headers['accept-encoding'];",
    "  var acceptEncoding = (enc && enc.value) || '';",
    "  if (acceptEncoding.indexOf('br') !== -1) {",
    "    request.uri = request.uri + '.br';",
    "  } else if (acceptEncoding.indexOf('gzip') !== -1) {",
    "    request.uri = request.uri + '.gz';",
    "  }",
    "  return request;",
    "}",
  ].join("\n");
}

/**
 * The tmct marketing/docs website edge.
 *
 * One stack holds the publish bucket, the BucketDeployment(s) (from
 * `../public`), AND the CloudFront distribution on purpose. CDK's
 * `S3BucketOrigin.withOriginAccessControl(bucket)` adds a bucket policy that
 * references the distribution ARN; splitting Publish and Edge into separate
 * stacks makes that a bidirectional cross-stack reference (a cyclic
 * dependency). Co-locating them avoids the cycle.
 *
 * The ACM cert lives in us-east-1 (CloudFront requirement); the rest of tmct
 * is eu-west-2. The cert ARN comes from context so we never cross-region in
 * CDK.
 */
export class WebsiteStack extends Stack {
  constructor(scope: Construct, id: string, props: WebsiteStackProps) {
    super(scope, id, props);

    const { envName, slug, hostname, certArn, hostedZoneId, zoneName } = props;

    const cert = acm.Certificate.fromCertificateArn(this, "Cert", certArn);

    // ---------- publish bucket (private, OAC-only) ----------
    const publishBucket = new s3.Bucket(this, "PublishBucket", {
      bucketName: `tmct-${envName}-${slug}-web-${this.account}`,
      versioned: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      // Non-prod branch deploys can be torn down freely; prod retains.
      removalPolicy: envName === "prod" ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      autoDeleteObjects: envName !== "prod",
    });

    // ---------- CloudFront access log bucket ----------
    // CloudFront's standard logging delivery writes objects via a canned ACL,
    // which the default (bucket-owner-enforced) ObjectOwnership rejects. This
    // is the only bucket in the stack that needs OBJECT_WRITER.
    const logBucket = new s3.Bucket(this, "LogBucket", {
      bucketName: `tmct-${envName}-${slug}-logs-${this.account}`,
      objectOwnership: s3.ObjectOwnership.OBJECT_WRITER,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      lifecycleRules: [{ expiration: Duration.days(400) }],
      removalPolicy: envName === "prod" ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      autoDeleteObjects: envName !== "prod",
    });

    const oversizedPaths = findOversizedAssets(SITE_SOURCE_DIR);

    const oversizedRewriteFn = new cloudfront.Function(this, "OversizedAssetRewriteFn", {
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      comment: `tmct ${envName}/${slug}: rewrite assets over the CloudFront compression ` +
        "ceiling to their precompressed .br/.gz sibling by Accept-Encoding",
      code: cloudfront.FunctionCode.fromInline(oversizedRewriteFunctionSource(oversizedPaths)),
    });

    // ---------- CloudFront distribution ----------
    const siteOrigin = origins.S3BucketOrigin.withOriginAccessControl(publishBucket);
    const rewriteAssociation = [
      {
        function: oversizedRewriteFn,
        eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
      },
    ];

    const distribution = new cloudfront.Distribution(this, "CDN", {
      comment: `tmct ${envName}/${slug}`,
      defaultRootObject: "index.html",
      domainNames: [hostname],
      certificate: cert,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      defaultBehavior: {
        origin: siteOrigin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        // Handles every asset up to the 10 MB ceiling (incl. vendor/wink.js,
        // 3.7 MB) — the post-deploy smoke's vendorEncoding() check passes with
        // no extra work for those.
        compress: true,
        functionAssociations: rewriteAssociation,
      },
      enableLogging: true,
      logBucket,
      logFilePrefix: "cf/",
      logIncludesCookies: false,
      // The oversized paths are the only ones the rewrite function ever swaps
      // for a sibling that is already brotli or gzip on disk. An object that
      // arrives at the edge already compressed must not be compressed again:
      // the browser undoes exactly one layer, so a second one leaves JSON.parse
      // holding compressed bytes. CACHING_OPTIMIZED still varies the cache key
      // by Accept-Encoding with compression off, which is what keeps one cached
      // entry per sibling. The trailing `*` also covers a direct request for
      // `<path>.br`/`<path>.gz`, which the function leaves alone.
      additionalBehaviors: Object.fromEntries(
        oversizedPaths.map((assetPath) => [
          `${assetPath.slice(1)}*`,
          {
            origin: siteOrigin,
            viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
            cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
            compress: false,
            functionAssociations: rewriteAssociation,
          },
        ]),
      ),
    });

    // ---------- publish the built site + invalidate on deploy ----------
    // Staged as its own asset rather than inline in the deployment below, so
    // the sibling metadata pass further down can key its own asset hash off
    // this one and re-run whenever this deployment does.
    const siteAsset = new s3assets.Asset(this, "SiteAsset", { path: SITE_SOURCE_DIR });

    // The 85 MB payload is bigger than seonix's `../site`; raise the
    // deployment Lambda's memory/ephemeral storage above CDK defaults so the
    // zip/unzip doesn't run out of room. If asset churn or Lambda limits still
    // hurt, the fallback (not implemented here) is publishing content from CI
    // via the three-pass `aws s3 sync` in `scripts/fast-deploy-web.sh` plus two
    // metadata-only passes, leaving CDK to own only the infra.
    const mainDeployment = new s3deploy.BucketDeployment(this, "WebDeployment", {
      destinationBucket: publishBucket,
      sources: [s3deploy.Source.bucket(siteAsset.bucket, siteAsset.s3ObjectKey)],
      distribution,
      distributionPaths: ["/*"],
      cacheControl: [
        s3deploy.CacheControl.maxAge(Duration.minutes(5)),
        s3deploy.CacheControl.sMaxAge(Duration.minutes(5)),
      ],
      prune: true,
      retainOnDelete: false,
      memoryLimit: 3008,
      ephemeralStorageSize: Size.mebibytes(2048),
    });

    // ---------- re-upload oversized assets' siblings with real encoding metadata ----------
    // The main deployment above uploads the .br/.gz siblings too, but with
    // whatever content-type S3 infers from the extension and no
    // Content-Encoding header. These scoped, non-pruning deployments overwrite
    // just the sibling objects the rewrite function above serves, so a client
    // that gets redirected to `chat-seed.json.br` receives it with
    // `Content-Encoding: br` and the original mime type.
    //
    // Each staged source folds the whole site's asset hash into its own, so
    // this pass runs on every deploy the main deployment runs. Keyed on the
    // sibling's own bytes alone it would skip any deploy where the seed did not
    // change, leaving the main pass's header-less copy at the edge for a
    // browser to fail on. Each one invalidates its own path too: the main
    // deployment's `/*` invalidation fires before this pass, so without it the
    // edge can cache the header-less copy for its whole TTL.
    let previousOversizedDeployment: s3deploy.BucketDeployment | undefined;
    for (const assetPath of oversizedPaths) {
      const relativeAsset = assetPath.slice(1); // strip leading "/"
      const contentType = contentTypeFor(relativeAsset);
      for (const [ext, encoding] of [
        [".br", "br"],
        [".gz", "gzip"],
      ] as const) {
        // `s3deploy.Source.asset()` only accepts a directory or a .zip, never
        // a bare file — so stage this one sibling file alone in its own temp
        // directory. `destinationKeyPrefix` below already supplies the
        // asset's own subdirectory, so the staged file only needs its
        // basename to land at the same S3 key this always used.
        const siblingFileName = `${basename(relativeAsset)}${ext}`;
        const stagingDir = mkdtempSync(join(tmpdir(), "tmct-oversized-sibling-"));
        copyFileSync(join(SITE_SOURCE_DIR, `${relativeAsset}${ext}`), join(stagingDir, siblingFileName));
        const siblingDeployment = new s3deploy.BucketDeployment(
          this,
          `OversizedSibling${encoding === "br" ? "Br" : "Gz"}${relativeAsset.replace(/[^a-zA-Z0-9]/g, "")}`,
          {
            destinationBucket: publishBucket,
            sources: [
              s3deploy.Source.asset(stagingDir, {
                assetHash: createHash("sha256")
                  .update(siteAsset.assetHash)
                  .update(siblingFileName)
                  .digest("hex"),
              }),
            ],
            destinationKeyPrefix: relativeAsset.includes("/")
              ? relativeAsset.slice(0, relativeAsset.lastIndexOf("/"))
              : undefined,
            distribution,
            distributionPaths: [`${assetPath}*`],
            prune: false,
            retainOnDelete: false,
            extract: true,
            contentType,
            contentEncoding: encoding,
            cacheControl: [
              s3deploy.CacheControl.maxAge(Duration.minutes(5)),
              s3deploy.CacheControl.sMaxAge(Duration.minutes(5)),
            ],
          },
        );
        // Order after the main deployment (which would otherwise clobber the
        // metadata this pass sets) and after each other, one at a time.
        siblingDeployment.node.addDependency(previousOversizedDeployment ?? mainDeployment);
        previousOversizedDeployment = siblingDeployment;
      }
    }

    // ---------- the row service: table, Lambda, function URL, /api/* ----------
    // No explicit tableName: every shipped consumer (the DynamoDB backend
    // default, the corpus loader, retrieval, the breaker) speaks "pk"/"sk",
    // so the key attribute names below matter more than a stable table name
    // — CloudFormation names it instead, since a named table can't be
    // replaced when the key schema changes without a name collision.
    const rowTable = new dynamodb.Table(this, "RowServiceTable", {
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: "expiresAt",
      removalPolicy: envName === "prod" ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });

    const rowServiceFn = new lambda.Function(this, "RowServiceFn", {
      functionName: `tmct-${envName}-${slug}-row-service`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "handler.handler",
      code: lambda.Code.fromAsset(ROW_SERVICE_DIST_DIR),
      memorySize: 256,
      timeout: Duration.seconds(10),
      // No reserved concurrency: this account's total concurrency sits at the
      // Lambda service floor, so any reservation is rejected at deploy time.
      // The account-wide cap is itself the blunt compute bound here.
      environment: {
        TABLE_NAME: rowTable.tableName,
        TTL_DAYS: String(props.rowServiceTtlDays ?? 7),
        TABLE_ROW_CAP: String(props.rowServiceTableRowCap ?? 2_000_000),
      },
    });
    rowTable.grantReadWriteData(rowServiceFn);
    // OAC's own lambda:InvokeFunctionUrl grant (added by
    // FunctionUrlOrigin.withOriginAccessControl below) is not enough on its
    // own — the URL auth layer checks lambda:InvokeFunction for the
    // cloudfront.amazonaws.com principal too, so without this a signed
    // request 403s at the edge before the handler ever runs.
    rowServiceFn.addPermission("CloudFrontServiceInvoke", {
      principal: new iam.ServicePrincipal("cloudfront.amazonaws.com"),
      action: "lambda:InvokeFunction",
      sourceArn: `arn:aws:cloudfront::${this.account}:distribution/${distribution.distributionId}`,
    });

    // ---------- the news worker: one Lambda, invoked async by the row
    // service's poll/enrich/ingest trigger routes and by the turn service
    // (materialize mode) — never invoked directly by a caller.
    const newsWorkerFn = new lambda.Function(this, "NewsWorkerFn", {
      functionName: `tmct-${envName}-${slug}-news-worker`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "handler.handler",
      code: lambda.Code.fromAsset(NEWS_WORKER_DIST_DIR),
      memorySize: 512,
      timeout: Duration.seconds(60),
      // No reserved concurrency, same account-wide floor as the row service
      // above — §3.9's "default 5" ceiling is aspirational until the account
      // can support any reservation at all.
      environment: {
        TABLE_NAME: rowTable.tableName,
        TTL_DAYS: String(props.rowServiceTtlDays ?? 7),
      },
    });
    rowTable.grantReadWriteData(newsWorkerFn);
    newsWorkerFn.grantInvoke(rowServiceFn);
    rowServiceFn.addEnvironment("NEWS_WORKER_FUNCTION_NAME", newsWorkerFn.functionName);

    const rowServiceUrl = rowServiceFn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.AWS_IAM,
    });

    // ---------- the turn service: its own Lambda, function URL, and the
    // more specific /api/sessions/*/turn behavior. Registered on the
    // distribution BEFORE the row service's /api/* catch-all below —
    // CloudFront matches path patterns in the order they're listed, first
    // match wins, so the more specific pattern has to come first or every
    // turn request would be served by the row service instead.
    if (!existsSync(join(TURN_SERVICE_DIST_DIR, "handler.js"))) {
      throw new Error(
        `${TURN_SERVICE_DIST_DIR}/handler.js is missing — run npm run build:turn-service before synth.`,
      );
    }
    if (!existsSync(TURN_SERVICE_MID_SEED_SOURCE)) {
      throw new Error(
        `${TURN_SERVICE_MID_SEED_SOURCE} is missing — run npm run build:turn-seed before synth.`,
      );
    }
    // build-seed.mjs writes mid-seed.json beside the source handler, not
    // into dist/ (esbuild's own output target) — copied in here so the one
    // asset directory `lambda.Code.fromAsset` packages carries both files
    // side by side, the shape `loadMidSeed`'s own `import.meta.url`-relative
    // default expects at runtime.
    copyFileSync(TURN_SERVICE_MID_SEED_SOURCE, join(TURN_SERVICE_DIST_DIR, "mid-seed.json"));

    const turnServiceFn = new lambda.Function(this, "TurnServiceFn", {
      functionName: `tmct-${envName}-${slug}-turn-service`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "handler.handler",
      code: lambda.Code.fromAsset(TURN_SERVICE_DIST_DIR),
      memorySize: 512,
      timeout: Duration.seconds(10),
      // No reserved concurrency, same account-wide floor as the row service
      // above — §3.12's "default 5" ceiling is aspirational until the
      // account can support any reservation at all.
      environment: {
        TABLE_NAME: rowTable.tableName,
        TTL_DAYS: String(props.rowServiceTtlDays ?? 7),
        TABLE_ROW_CAP: String(props.rowServiceTableRowCap ?? 2_000_000),
      },
    });
    // Read/write: a turn both queries the corpus bands (read) and persists
    // what it learned into the caller's own session partition (write) —
    // the same table the row service owns, never a copy of it.
    rowTable.grantReadWriteData(turnServiceFn);
    // Same second permission the row service Lambda needs above: the URL
    // auth layer checks lambda:InvokeFunction for the cloudfront.amazonaws.com
    // principal, separately from OAC's own lambda:InvokeFunctionUrl grant.
    turnServiceFn.addPermission("CloudFrontServiceInvoke", {
      principal: new iam.ServicePrincipal("cloudfront.amazonaws.com"),
      action: "lambda:InvokeFunction",
      sourceArn: `arn:aws:cloudfront::${this.account}:distribution/${distribution.distributionId}`,
    });
    // A turn whose factsTouched is non-empty fires the same materialize
    // invoke the row service's own trigger routes fire — the news worker
    // Lambda, so a taught fact reaches the feed within the next version
    // poll instead of waiting on an unrelated cycle.
    newsWorkerFn.grantInvoke(turnServiceFn);
    turnServiceFn.addEnvironment("NEWS_WORKER_FUNCTION_NAME", newsWorkerFn.functionName);

    const turnServiceUrl = turnServiceFn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.AWS_IAM,
    });
    // ALL_VIEWER_EXCEPT_HOST_HEADER, not ALL_VIEWER: forwarding the viewer's
    // Host header to a Lambda function URL invalidates the OAC's SigV4
    // signature (the signature is computed against the function URL's own
    // host), and every request 403s at the edge.
    distribution.addBehavior("/api/sessions/*/turn", origins.FunctionUrlOrigin.withOriginAccessControl(turnServiceUrl), {
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
      cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
    });

    // No caching (every route is a session-scoped read or a mutation) and
    // every header/method/body forwarded, since the handler reads the
    // session key from `x-tmct-session` and the mutating verbs need their
    // JSON bodies intact.
    distribution.addBehavior("/api/*", origins.FunctionUrlOrigin.withOriginAccessControl(rowServiceUrl), {
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
      cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
    });

    if (props.webAclArn) {
      distribution.attachWebAclId(props.webAclArn);
    }

    // The daily reconcile: a physical recount that corrects the TTL-driven
    // upward drift in the row service's own global-cap counter (§3.8).
    new events.Rule(this, "RowServiceReconcileRule", {
      ruleName: `tmct-${envName}-${slug}-row-reconcile`,
      schedule: events.Schedule.rate(Duration.days(1)),
      targets: [
        new events_targets.LambdaFunction(rowServiceFn, {
          event: events.RuleTargetInput.fromObject({ mode: "reconcile" }),
        }),
      ],
    });

    // ---------- Route 53 A-record alias to CloudFront ----------
    if (hostedZoneId && zoneName) {
      const zone = route53.HostedZone.fromHostedZoneAttributes(this, "Zone", {
        hostedZoneId,
        zoneName,
      });
      new route53.ARecord(this, "ARecord", {
        zone,
        recordName: hostname,
        target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution)),
      });
    } else {
      new CfnOutput(this, "ARecordTodo", {
        value:
          `Add an A/ALIAS record for ${hostname} -> ${distribution.distributionDomainName} ` +
          `in the tmct hosted zone, or re-deploy with -c hostedZoneId=... -c zoneName=... ` +
          `to have CDK manage it.`,
      });
    }

    Tags.of(this).add("tmct-web", "true");
    Tags.of(this).add("tmct-env", envName);
    Tags.of(this).add("tmct-slug", slug);

    new CfnOutput(this, "PublishBucketName", { value: publishBucket.bucketName });
    new CfnOutput(this, "DistributionId", { value: distribution.distributionId });
    new CfnOutput(this, "DistributionDomain", { value: distribution.distributionDomainName });
    new CfnOutput(this, "Hostname", { value: hostname });
    new CfnOutput(this, "RowTableName", { value: rowTable.tableName });
  }
}
