// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import * as schema from './schema';
export const MigrationVersion = { FIRST_BOOT: -2, UNKNOWN: -1, NONE: 0 } as const;
export function getPreDeployMigrationVersions(): number[] {
  return Object.keys(schema)
    .filter((key) => /^v\d+$/.test(key))
    .map((key) => Number(key.slice(1)))
    .sort((a, b) => a - b);
}
export function getPostDeployMigrationVersions(): number[] {
  return [];
}
export function getLatestPostDeployMigrationVersion(): number {
  return 0;
}
