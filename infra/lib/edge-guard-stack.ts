// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Polycode Limited

import {
  Stack,
  StackProps,
  CfnOutput,
  Duration,
  aws_wafv2 as wafv2,
  aws_cloudwatch as cloudwatch,
} from "aws-cdk-lib";
import { Construct } from "constructs";

export interface EdgeGuardStackProps extends StackProps {
  readonly envName: string;
  readonly slug: string;
  /** Estimated-charges alarm threshold in USD. */
  readonly billingAlarmThresholdUsd: number;
}

/**
 * The two guards a CloudFront distribution needs that CloudFront's own stack
 * cannot host: a WAFv2 web ACL (CLOUDFRONT-scope WAFv2 resources only exist
 * in us-east-1, same constraint as the ACM cert) and the account's
 * estimated-charges alarm (the `AWS/Billing` metric is likewise us-east-1
 * only). `WebsiteStack` reads `webAcl.attrArn` across the region boundary via
 * `crossRegionReferences`, the same way it already reads the ACM cert by ARN.
 *
 * One rate-based rule protects `/api/*`: 300 requests per 5 minutes,
 * aggregated per source IP. The web ACL's default action is allow — nothing
 * else on the site needs a WAF rule — so this rule is the whole ACL.
 */
export class EdgeGuardStack extends Stack {
  public readonly webAcl: wafv2.CfnWebACL;

  constructor(scope: Construct, id: string, props: EdgeGuardStackProps) {
    super(scope, id, { ...props, crossRegionReferences: true });

    const { envName, slug, billingAlarmThresholdUsd } = props;
    const metricPrefix = `tmct-${envName}-${slug}`;

    this.webAcl = new wafv2.CfnWebACL(this, "ApiRateLimit", {
      scope: "CLOUDFRONT",
      defaultAction: { allow: {} },
      visibilityConfig: {
        sampledRequestsEnabled: true,
        cloudWatchMetricsEnabled: true,
        metricName: `${metricPrefix}-waf`,
      },
      rules: [
        {
          name: "RateLimitApi",
          priority: 0,
          action: { block: {} },
          statement: {
            rateBasedStatement: {
              aggregateKeyType: "IP",
              limit: 300,
              evaluationWindowSec: 300,
              scopeDownStatement: {
                byteMatchStatement: {
                  fieldToMatch: { uriPath: {} },
                  positionalConstraint: "STARTS_WITH",
                  searchString: "/api/",
                  textTransformations: [{ priority: 0, type: "NONE" }],
                },
              },
            },
          },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: `${metricPrefix}-waf-rate-limit-api`,
          },
        },
      ],
    });

    // AWS/Billing's EstimatedCharges only publishes once "receive billing
    // alerts" is turned on for the account (an account-level preference, not
    // a CDK-managed setting) and only into us-east-1 — the alarm has to live
    // here beside the metric it watches.
    new cloudwatch.Alarm(this, "EstimatedChargesAlarm", {
      alarmDescription: `tmct ${envName}/${slug}: estimated AWS charges over $${billingAlarmThresholdUsd}/month`,
      metric: new cloudwatch.Metric({
        namespace: "AWS/Billing",
        metricName: "EstimatedCharges",
        dimensionsMap: { Currency: "USD" },
        statistic: "Maximum",
        // The billing metric only updates a few times a day; a shorter
        // period would just re-evaluate the same last-known value.
        period: Duration.hours(6),
      }),
      threshold: billingAlarmThresholdUsd,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    new CfnOutput(this, "WebAclArn", { value: this.webAcl.attrArn });
  }
}
