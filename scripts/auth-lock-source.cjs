/* eslint-disable @typescript-eslint/no-require-imports -- plain CommonJS script, not app code */
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const hashes = {
  '2.99.2': '9834c7664024ea8be4c911e0252479eb860cb374b790a70fb476e0aed0de9ecc',
  '2.112.4': 'dff51f514d51045d15216c9c76239290b15a646f12e34449234960622e0366ff',
};
module.exports = async function loadLockSource(version) {
  if (!hashes[version]) throw new Error('Unapproved comparison version');
  const file = path.join(__dirname, '../scratchpad/auth-lock-20261006', `locks-${version}.js`);
  let source;
  try { source = await fs.readFile(file, 'utf8'); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const response = await fetch(`https://unpkg.com/@supabase/auth-js@${version}/dist/module/lib/locks.js`, { signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`SDK source download failed: ${response.status}`);
    source = await response.text();
  }
  if (createHash('sha256').update(source).digest('hex') !== hashes[version]) throw new Error('Published source hash mismatch');
  return source.replace(/^import .*?;$/gm, 'const supportsLocalStorage = () => false;').replace(/\bexport /g, '');
};
