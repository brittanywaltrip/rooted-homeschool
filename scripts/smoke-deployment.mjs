// Select an immutable Vercel deployment for this commit, never a shared alias.
// GitHub deployment metadata is only discovery. /api/health and global-setup
// still have to prove staging identity before any browser/database test runs.
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const REPOSITORY = 'brittanywaltrip/rooted-homeschool';
const STAGING_REF = 'cvgqovweybggrqakhdtd';

export function deploymentOrigin(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port ||
        url.pathname !== '/' || url.search || url.hash) return null;
    // Only immutable deployment hosts for this project/team. Branch/custom
    // aliases may change underneath the runner even after the health check.
    if (!/^rooted-homeschool-[a-z0-9]{9}-brittanywaltrips-projects\.vercel\.app$/.test(url.hostname)) return null;
    return url.origin;
  } catch { return null; }
}

export function eligibleDeployment(deployment, sha) {
  return deployment.sha === sha && deployment.production_environment === false &&
    ['preview', 'rooted-staging', 'staging'].includes(deployment.environment?.toLowerCase()) &&
    deployment.creator?.login === 'vercel[bot]' && Number.isSafeInteger(deployment.id);
}

export function successfulOrigin(statuses) {
  // Never resurrect an old success after a newer inactive/failure status.
  const latest = statuses[0];
  if (latest?.state !== 'success' || latest.creator?.login !== 'vercel[bot]') return null;
  return deploymentOrigin(latest.environment_url || latest.target_url);
}

export function verifyIdentity(health, sha) {
  if (health?.env !== 'staging' || health.identityOk !== true ||
      health.projectRef !== STAGING_REF || health.commit !== sha) {
    throw new Error('Selected deployment does not prove the expected staging database and commit. No tests started.');
  }
}

export async function discoverDeployment({ sha, token, request = fetch }) {
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('A full expected commit SHA is required.');
  async function github(path) {
    const response = await request(`https://api.github.com/repos/${REPOSITORY}/${path}`, {
      headers: { Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      redirect: 'error', signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`GitHub deployment discovery returned HTTP ${response.status}.`);
    return response.json();
  }
  const deployments = await github(`deployments?sha=${sha}&per_page=100`);
  for (const deployment of deployments) {
    if (!eligibleDeployment(deployment, sha)) continue;
    // Build the API path ourselves. Never forward the GitHub token to a URL
    // supplied in the deployment payload.
    const origin = successfulOrigin(await github(`deployments/${deployment.id}/statuses?per_page=1`));
    if (origin) return origin;
  }
  return null;
}

export async function run(env = process.env) {
  if (env.GITHUB_REPOSITORY !== REPOSITORY) throw new Error('Unexpected repository.');
  const sha = env.EXPECTED_COMMIT;
  if (!sha || !/^[a-f0-9]{40}$/.test(sha)) throw new Error('A full expected commit SHA is required.');
  // No keys are logged and no redirect can carry the bypass to another host.
  for (let attempt = 1; attempt <= 48; attempt++) {
    const origin = await discoverDeployment({ sha, token: env.GITHUB_TOKEN });
    if (origin) {
      const response = await fetch(`${origin}/api/health`, {
        headers: env.VERCEL_AUTOMATION_BYPASS_SECRET
          ? { 'x-vercel-protection-bypass': env.VERCEL_AUTOMATION_BYPASS_SECRET } : {},
        redirect: 'manual', signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error(`Selected deployment health returned HTTP ${response.status}; check protection/configuration. No tests started.`);
      let health;
      try { health = await response.json(); }
      catch { throw new Error('Selected deployment did not return JSON health. No tests started.'); }
      verifyIdentity(health, sha);
      if (!env.GITHUB_OUTPUT) throw new Error('Missing GitHub output destination.');
      appendFileSync(env.GITHUB_OUTPUT, `base_url=${origin}\n`);
      console.log(`Verified staging ${STAGING_REF} at ${sha}: ${origin}`);
      return;
    }
    console.log(`Waiting for a successful non-production deployment of ${sha} (${attempt}/48)`);
    if (attempt < 48) await new Promise(resolve => setTimeout(resolve, 15000));
  }
  throw new Error('No successful non-production deployment for this commit after 12 minutes.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch(error => { console.error(error.message); process.exitCode = 1; });
}
