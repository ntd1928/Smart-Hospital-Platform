// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { PgQueryable } from '../fhir/sql';
import * as schema from './schema';
import type { PreDeployMigration } from './schema/types';

// Fresh databases only; legacy Medplum data migrations are not included.
export async function getPendingPostDeployMigration(_client: PgQueryable): Promise<number> {
  return 0;
}
export function enforceStrictMigrationVersionChecks(): boolean {
  return true;
}
export function getPostDeployManifestEntry(_version: number): { serverVersion: string; requiredBefore?: string } {
  throw new Error('Legacy Medplum data upgrades are not part of this extraction');
}
export function getPreDeployMigration(version: number): PreDeployMigration {
  const migration = (schema as Record<string, PreDeployMigration>)[`v${version}`];
  if (!migration) throw new Error(`Missing schema migration ${version}`);
  return migration;
}
