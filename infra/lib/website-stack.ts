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
} from "aws-cdk-lib";
import { Construct } from "constructs";

export interface WebsiteStackProps extends StackProps {
  readonly envName: string;
  readonly slug: string;
  readonly hostname: string;
  /** ACM cert ARN — MUST be in us-east-1 (CloudFront requirement). */
  readonly certArn: string;
  /** Optional: supply both to have CDK write the Route53 A-record alias. */
  readonly hostedZoneId?: string;
  readonly zoneName?: string;
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
  }
}
