#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Polycode Limited

import { App } from "aws-cdk-lib";
import { WebsiteStack } from "../lib/website-stack";
import { ApexStack } from "../lib/apex-stack";
import { EdgeGuardStack } from "../lib/edge-guard-stack";

const app = new App();

// Context (mirrors seonix/marginalia/bedrock-meter):
//   env=ci|prod   account=<id>   slug=<branch slug>   region=eu-west-2
//   hostname=tmct.polycode.co.uk
//   certArn=<us-east-1 ACM cert ARN>   (required for the WebsiteStack)
//   hostedZoneId / zoneName            (optional — lets CDK write the A-record)
//   rowServiceTtlDays / rowServiceTableRowCap (optional — the row service's
//     TTL_DAYS/TABLE_ROW_CAP deployment parameters, default 7 / 2,000,000)
const envName = app.node.tryGetContext("env") ?? "ci";
const account = app.node.tryGetContext("account") ?? process.env.CDK_DEFAULT_ACCOUNT;
const slug = app.node.tryGetContext("slug") ?? "local";
const region = app.node.tryGetContext("region") ?? "eu-west-2";
const hostname = app.node.tryGetContext("hostname") ?? "tmct.polycode.co.uk";
const certArn = app.node.tryGetContext("certArn");
const hostedZoneId = app.node.tryGetContext("hostedZoneId");
const zoneName = app.node.tryGetContext("zoneName");
const rowServiceTtlDays = app.node.tryGetContext("rowServiceTtlDays");
const rowServiceTableRowCap = app.node.tryGetContext("rowServiceTableRowCap");

// Apex (DNS) stack — deploy once per environment to create the delegated zone.
// Run this first (`cdk deploy tmct-<env>-apex`), wire up the NS delegation +
// ACM cert, then supply certArn to bring up the WebsiteStack.
new ApexStack(app, `tmct-${envName}-apex`, {
  envName,
  env: { account, region },
});

// The WAF web ACL and the billing alarm both watch a CLOUDFRONT/us-east-1-only
// resource, so they deploy from their own always-us-east-1 stack regardless of
// which region the website stack targets — same reasoning as the ACM cert.
// Only instantiated alongside the website stack, which is the only consumer
// of its ARN.
const edgeGuard = certArn
  ? new EdgeGuardStack(app, `tmct-${envName}-${slug}-edge-guard`, {
      envName,
      slug,
      billingAlarmThresholdUsd: 20,
      env: { account, region: "us-east-1" },
    })
  : undefined;

// Website stack — needs the us-east-1 ACM cert ARN. Only instantiated when
// certArn is in context, so the apex stack can deploy before the cert exists.
if (certArn) {
  new WebsiteStack(app, `tmct-${envName}-${slug}-website`, {
    envName,
    slug,
    hostname,
    certArn,
    hostedZoneId,
    zoneName,
    rowServiceTtlDays: rowServiceTtlDays ? Number(rowServiceTtlDays) : undefined,
    rowServiceTableRowCap: rowServiceTableRowCap ? Number(rowServiceTableRowCap) : undefined,
    webAclArn: edgeGuard?.webAcl.attrArn,
    env: { account, region },
    crossRegionReferences: true,
  });
}

app.synth();
