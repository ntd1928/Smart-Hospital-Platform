// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

/** Resources whose clinical writes are available only through server-side lifecycle operations. */
export const OPERATION_MANAGED_CLINICAL_RESOURCES: ReadonlySet<string> = new Set([
  'AllergyIntolerance',
  'Condition',
  'Encounter',
  'MedicationAdministration',
  'MedicationRequest',
  'MedicationStatement',
  'Observation',
]);
