#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Polycode Limited

import { App } from "aws-cdk-lib";
import { WebsiteStack } from "../lib/website-stack";
import { ApexStack } from "../lib/apex-stack";

const app = new App();

// Context (mirrors seonix/marginalia/bedrock-meter):
//   env=ci|prod   account=<id>   slug=<branch slug>   region=eu-west-2
//   hostname=tmct.polycode.co.uk
//   certArn=<us-east-1 ACM cert ARN>   (required for the WebsiteStack)
//   hostedZoneId / zoneName            (optional — lets CDK write the A-record)
const envName = app.node.tryGetContext("env") ?? "ci";
const account = app.node.tryGetContext("account") ?? process.env.CDK_DEFAULT_ACCOUNT;
const slug = app.node.tryGetContext("slug") ?? "local";
const region = app.node.tryGetContext("region") ?? "eu-west-2";
const hostname = app.node.tryGetContext("hostname") ?? "tmct.polycode.co.uk";
const certArn = app.node.tryGetContext("certArn");
const hostedZoneId = app.node.tryGetContext("hostedZoneId");
const zoneName = app.node.tryGetContext("zoneName");

// Apex (DNS) stack — deploy once per environment to create the delegated zone.
// Run this first (`cdk deploy tmct-<env>-apex`), wire up the NS delegation +
// ACM cert, then supply certArn to bring up the WebsiteStack.
new ApexStack(app, `tmct-${envName}-apex`, {
  envName,
  env: { account, region },
});

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
    env: { account, region },
  });
}

app.synth();
