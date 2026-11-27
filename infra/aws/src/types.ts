// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-FileCopyrightText: Copyright 2026 Smart Hospital Platform contributors
// SPDX-License-Identifier: Apache-2.0

/** Configuration for one Smart Hospital AWS environment. No credential values belong here. */
export interface SmartHospitalInfraConfig {
  account: string;
  region: string;
  availabilityZones: string[];
  stackName: string;
  environment: string;
  adminEmail: string;
  hostedZoneId: string;
  hostedZoneName: string;
  appSubdomain: string;
  apiSubdomain: string;
  certificateArn: string;
  desiredCount: number;
}

export function parseInfraConfig(value: unknown): SmartHospitalInfraConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Infrastructure configuration must be a JSON object');
  }

  const config = value as Record<string, unknown>;
  const requiredStrings = [
    'account',
    'region',
    'stackName',
    'environment',
    'adminEmail',
    'hostedZoneId',
    'hostedZoneName',
    'appSubdomain',
    'apiSubdomain',
    'certificateArn',
  ] as const;

  for (const key of requiredStrings) {
    if (typeof config[key] !== 'string' || config[key].trim().length === 0) {
      throw new Error(`Infrastructure configuration requires a non-empty string "${key}"`);
    }
  }

  if (!/^\d{12}$/.test(config.account as string)) {
    throw new Error('Infrastructure "account" must be a 12-digit AWS account ID');
  }
  if (!/^[a-z]{2}(-gov)?-[a-z]+-\d$/.test(config.region as string)) {
    throw new Error('Infrastructure "region" must be an AWS region name');
  }
  if (
    !Array.isArray(config.availabilityZones) ||
    config.availabilityZones.length !== 2 ||
    config.availabilityZones.some(
      (zone) =>
        typeof zone !== 'string' ||
        !zone.startsWith(config.region as string) ||
        zone.length !== (config.region as string).length + 1 ||
        !/[a-z]$/.test(zone)
    )
  ) {
    throw new Error('Infrastructure "availabilityZones" must contain two AZ names in the configured region');
  }
  if (!/^arn:aws(?:-[a-z]+)?:acm:[a-z0-9-]+:\d{12}:certificate\/[0-9a-f-]+$/.test(config.certificateArn as string)) {
    throw new Error('Infrastructure "certificateArn" must be an ACM certificate ARN');
  }
  const certificateArnParts = (config.certificateArn as string).split(':');
  if (certificateArnParts[3] !== config.region || certificateArnParts[4] !== config.account) {
    throw new Error('Infrastructure certificateArn must belong to the configured account and region');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.adminEmail as string)) {
    throw new Error('Infrastructure "adminEmail" must be a valid email address');
  }
  if (!Number.isInteger(config.desiredCount) || (config.desiredCount as number) < 1) {
    throw new Error('Infrastructure "desiredCount" must be a positive integer');
  }
  if (config.appSubdomain === config.apiSubdomain) {
    throw new Error('Infrastructure appSubdomain and apiSubdomain must differ');
  }

  return config as unknown as SmartHospitalInfraConfig;
}
