// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Polycode Limited

import {
  Stack,
  StackProps,
  CfnOutput,
  Fn,
  aws_route53 as route53,
  aws_ssm as ssm,
} from "aws-cdk-lib";
import { Construct } from "constructs";

export interface ApexStackProps extends StackProps {
  readonly envName: string;
}

/**
 * Route 53 hosted zone for tmct.polycode.co.uk in this environment.
 *
 * The parent polycode.co.uk zone lives in the polycode-management account.
 * After this stack deploys, the operator copies the Nameservers output into an
 * NS record in the parent zone to delegate the subdomain:
 *
 *   tmct.polycode.co.uk.   NS   <nameservers from this stack>
 *
 * The zone id + name are also published to SSM so the WebsiteStack (or
 * post-deploy scripts) can resolve the zone without a cross-stack export.
 */
export class ApexStack extends Stack {
  public readonly zone: route53.PublicHostedZone;

  constructor(scope: Construct, id: string, props: ApexStackProps) {
    super(scope, id, props);

    const { envName } = props;

    this.zone = new route53.PublicHostedZone(this, "Zone", {
      zoneName: "tmct.polycode.co.uk",
      comment: `Delegated from polycode.co.uk in polycode-management (${envName} environment).`,
    });

    new ssm.StringParameter(this, "ZoneIdParam", {
      parameterName: `/tmct/${envName}/apex/zone-id`,
      stringValue: this.zone.hostedZoneId,
      description: `Route 53 hosted zone id for tmct.polycode.co.uk (${envName})`,
    });

    new ssm.StringParameter(this, "ZoneNameParam", {
      parameterName: `/tmct/${envName}/apex/zone-name`,
      stringValue: this.zone.zoneName,
      description: `Route 53 hosted zone name for tmct ${envName}`,
    });

    new CfnOutput(this, "ZoneId", {
      value: this.zone.hostedZoneId,
      exportName: `tmct-${envName}-zone-id`,
    });

    new CfnOutput(this, "ZoneName", {
      value: this.zone.zoneName,
      exportName: `tmct-${envName}-zone-name`,
    });

    new CfnOutput(this, "Nameservers", {
      value: Fn.join(",", this.zone.hostedZoneNameServers ?? []),
      description:
        "Copy these into an NS record for tmct.polycode.co.uk in the " +
        "polycode-management polycode.co.uk Route 53 zone.",
    });
  }
}
