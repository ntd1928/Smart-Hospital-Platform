// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-FileCopyrightText: Copyright 2026 Smart Hospital Platform contributors
// SPDX-License-Identifier: Apache-2.0

import { App } from 'aws-cdk-lib';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SmartHospitalInfraStack } from './stack';
import { parseInfraConfig } from './types';

const app = new App();
const configFile = app.node.tryGetContext('config');
if (typeof configFile !== 'string' || configFile.length === 0) {
  throw new Error('Missing CDK context "config". Use -c config=cdk.config.json.');
}

const config = parseInfraConfig(JSON.parse(readFileSync(resolve(configFile), 'utf-8')));
// VPC construction validates the supplied AZ names against this stack context. Supplying it here
// keeps synthesis deterministic and avoids requiring credentials for a read-only AZ lookup.
app.node.setContext(`availability-zones:account=${config.account}:region=${config.region}`, config.availabilityZones);
new SmartHospitalInfraStack(app, config);
app.synth();
