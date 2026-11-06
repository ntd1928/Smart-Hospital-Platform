import { MedplumClient } from '@medplum/core';
import type { LoginAuthenticationResponse } from '@medplum/core';
import { readFile } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';

export const baseUrl = process.env.MEDPLUM_BASE_URL ?? 'http://localhost:8103/';
export const password = process.env.DEMO_PASSWORD ?? 'HospitalDemo!2026';
export async function fixture() {
  return JSON.parse(await readFile(new URL('../.runtime/demo.json', import.meta.url), 'utf8')) as {
    projectId: string;
    doctors: { id: string; membershipId: string }[];
    patients: { id: string; identifier: string }[];
    appointments: string[];
    slots: string[];
    isolatedProjectId: string;
    isolatedPatientId: string;
  };
}
export async function signIn(email: string, projectId: string, secret = password) {
  const client = new MedplumClient({ baseUrl, cacheTime: 0 });
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  let result = await client.startLogin({
    email,
    password: secret,
    projectId,
    scope: 'openid offline_access',
    remember: true,
    codeChallenge: challenge,
    codeChallengeMethod: 'S256',
  });
  if (!result.code && result.memberships?.length === 1)
    result = await client.post<LoginAuthenticationResponse>('auth/profile', {
      login: result.login,
      profile: result.memberships[0].id,
    });
  if (!result.code) throw new Error('Expected an authorization code for demo account');
  const response = await fetch(new URL('oauth2/token', baseUrl), {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: result.code,
      code_verifier: verifier,
      client_id: '',
      redirect_uri: 'http://localhost:3000',
    }),
  });
  if (!response.ok) throw new Error(`Token exchange failed: ${await response.text()}`);
  const tokens = await response.json();
  await client.setActiveLogin({
    project: tokens.project,
    profile: tokens.profile,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
  });
  return client;
}
export async function request(path: string, token?: string, method = 'GET', body?: unknown) {
  return fetch(new URL(path, baseUrl), {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/fhir+json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}
