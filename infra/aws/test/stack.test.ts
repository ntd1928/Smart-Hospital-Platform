// SPDX-FileCopyrightText: Copyright 2026 Smart Hospital Platform contributors
// SPDX-License-Identifier: Apache-2.0

import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { SmartHospitalInfraStack } from '../src/stack';
import { parseInfraConfig } from '../src/types';

const config = parseInfraConfig({
  account: '000000000000',
  region: 'us-west-2',
  availabilityZones: ['us-west-2a', 'us-west-2b'],
  stackName: 'SmartHospitalTest',
  environment: 'test',
  adminEmail: 'admin@example.com',
  hostedZoneId: 'Z00000000000000000000',
  hostedZoneName: 'example.com',
  appSubdomain: 'app',
  apiSubdomain: 'api',
  certificateArn: 'arn:aws:acm:us-west-2:000000000000:certificate/00000000-0000-0000-0000-000000000000',
  desiredCount: 1,
});

describe('SmartHospitalInfraStack', () => {
  it('creates private encrypted persistence with backups and retention', () => {
    const stack = new SmartHospitalInfraStack(new App(), config);
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::RDS::DBInstance', {
      DBName: 'smart_hospital',
      StorageEncrypted: true,
      PubliclyAccessible: false,
      BackupRetentionPeriod: 7,
      DeletionProtection: true,
    });
    template.hasResourceProperties('AWS::ElastiCache::ReplicationGroup', {
      AtRestEncryptionEnabled: true,
      TransitEncryptionEnabled: true,
      NumCacheClusters: 1,
    });
    template.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: Match.objectLike({
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      }),
      VersioningConfiguration: { Status: 'Enabled' },
    });
  });

  it('serves app and API on HTTPS hostnames behind private Fargate tasks', () => {
    const stack = new SmartHospitalInfraStack(new App(), config);
    const template = Template.fromStack(stack);

    template.resourceCountIs('AWS::ECS::Service', 2);
    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::Listener', {
      Port: 80,
      DefaultActions: [Match.objectLike({ Type: 'redirect' })],
    });
    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::Listener', {
      Port: 443,
      Protocol: 'HTTPS',
    });
    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::ListenerRule', {
      Conditions: Match.arrayWith([
        Match.objectLike({
          Field: 'host-header',
          HostHeaderConfig: { Values: ['api.example.com'] },
        }),
      ]),
    });
    template.hasResourceProperties('AWS::ECS::TaskDefinition', {
      ContainerDefinitions: Match.arrayWith([
        Match.objectLike({
          Environment: Match.arrayWith([
            Match.objectLike({ Name: 'MEDPLUM_BASE_URL', Value: 'https://api.example.com/' }),
            Match.objectLike({ Name: 'MEDPLUM_APP_BASE_URL', Value: 'https://app.example.com/' }),
            Match.objectLike({ Name: 'MEDPLUM_DATABASE_SSL_REQUIRE', Value: 'true' }),
            Match.objectLike({ Name: 'MEDPLUM_DEFAULT_SUPER_ADMIN_EMAIL', Value: 'admin@example.com' }),
          ]),
          Secrets: Match.arrayWith([
            Match.objectLike({ Name: 'MEDPLUM_DEFAULT_SUPER_ADMIN_PASSWORD', ValueFrom: Match.anyValue() }),
          ]),
        }),
      ]),
    });
  });

  it('rejects incomplete account and TLS configuration', () => {
    expect(() => parseInfraConfig({ ...config, account: 'local' })).toThrow(/12-digit AWS account ID/);
    expect(() => parseInfraConfig({ ...config, certificateArn: 'not-an-arn' })).toThrow(/ACM certificate ARN/);
  });
});
