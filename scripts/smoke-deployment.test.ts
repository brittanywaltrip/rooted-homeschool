import test from 'node:test';
import assert from 'node:assert/strict';
import { deploymentOrigin, eligibleDeployment, successfulOrigin, verifyIdentity, discoverDeployment } from './smoke-deployment.mjs';

const sha = 'cf60aea1be604679cc4eb696afbbd58a4de0b6e2';
const origin = 'https://rooted-homeschool-66luefo8n-brittanywaltrips-projects.vercel.app';
const deployment = { id: 6571500973, sha, environment: 'Preview', production_environment: false, creator: { login: 'vercel[bot]' } };
const success = { state: 'success', environment_url: origin, creator: { login: 'vercel[bot]' } };

test('only this project immutable deployment origins can receive the bypass', () => {
  assert.equal(deploymentOrigin(origin), origin);
  for (const value of [
    'https://www.rootedhomeschoolapp.com',
    'https://rooted-homeschool-env-rooted-staging-brittanywaltrips-projects.vercel.app',
    origin + '.evil.example', origin + '/path', origin + '?token=x', origin + '#x',
    origin.replace('https:', 'http:'), origin.replace('https://', 'https://user:pass@'),
    origin.replace('.vercel.app', '.vercel.app:444'),
  ]) assert.equal(deploymentOrigin(value), null);
});

test('production, unrelated commits and untrusted creators are rejected before health', () => {
  assert.equal(eligibleDeployment(deployment, sha), true);
  for (const patch of [{ production_environment: true }, { production_environment: undefined },
    { sha: 'a'.repeat(40) }, { environment: 'Production' }, { creator: { login: 'someone' } }]) {
    assert.equal(eligibleDeployment({ ...deployment, ...patch }, sha), false);
  }
});

test('newer inactive or failed status cannot fall back to an earlier success', () => {
  assert.equal(successfulOrigin([success]), origin);
  assert.equal(successfulOrigin([{ ...success, state: 'inactive' }, success]), null);
  assert.equal(successfulOrigin([{ ...success, state: 'failure' }, success]), null);
});

test('health must prove database, staging, identity and exact commit', () => {
  const health = { env: 'staging', identityOk: true, projectRef: 'cvgqovweybggrqakhdtd', commit: sha };
  assert.doesNotThrow(() => verifyIdentity(health, sha));
  for (const patch of [{ env: 'production' }, { identityOk: false },
    { projectRef: 'gvkbegvvmhcrmxdorctk' }, { commit: 'a'.repeat(40) }]) {
    assert.throws(() => verifyIdentity({ ...health, ...patch }, sha));
  }
});

test('discovery uses commit-filtered metadata and ignores supplied API URLs', async () => {
  const calls: string[] = [];
  const request: typeof fetch = async (url, options) => {
    calls.push(String(url));
    assert.equal(options?.redirect, 'error');
    return Response.json(calls.length === 1
      ? [{ ...deployment, production_environment: true }, { ...deployment, statuses_url: 'https://evil.example' }]
      : [success]);
  };
  assert.equal(await discoverDeployment({ sha, token: 'test-only', request }), origin);
  assert.equal(calls.length, 2);
  assert.match(calls[0], new RegExp(`deployments\\?sha=${sha}&per_page=100$`));
  assert.equal(calls[1], `https://api.github.com/repos/brittanywaltrip/rooted-homeschool/deployments/${deployment.id}/statuses?per_page=1`);
});
