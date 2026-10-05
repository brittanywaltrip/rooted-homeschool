import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { SupabaseClient } from '@supabase/supabase-js';
import { extractPath, coverBucketFor, signedPhotoUrl, signedPhotoUrls } from './photo-url.ts';

test('browser photo helpers import without admin dependencies or secrets', () => {
  const source = readFileSync(new URL('./photo-url.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /supabase-admin|SERVICE_ROLE|photo-url-admin/);
  const admin = readFileSync(new URL('./photo-url-admin.ts', import.meta.url), 'utf8');
  assert.match(admin, /^import "server-only";/);
  for (const path of ['./family-feed.ts', '../app/api/cron/family-digest/route.ts']) {
    assert.match(readFileSync(new URL(path, import.meta.url), 'utf8'), /from "@\/lib\/photo-url-admin"/);
  }
});

test('historical photo URLs and cover fallbacks preserve existing paths', () => {
  assert.equal(extractPath('https://storage.test/storage/v1/object/sign/memory-photos/family/photo.jpg?token=x', 'memory-photos'), 'family/photo.jpg');
  assert.equal(extractPath('family/photo.jpg', 'memory-photos'), 'family/photo.jpg');
  assert.equal(extractPath('https://external.test/avatar.png', 'family-photos'), null);
  assert.equal(coverBucketFor('family/cover.jpg'), 'yearbook-covers');
  assert.equal(coverBucketFor('/object/public/family-photos/family/photo.jpg'), 'family-photos');
});

test('single signing still uses the supplied authenticated client and expiry', async () => {
  const calls: unknown[] = [];
  const client = { storage: { from(bucket: string) { calls.push(bucket); return {
    async createSignedUrl(path: string, expiry: number) {
      calls.push([path, expiry]); return { data: { signedUrl: 'https://signed.test/photo' }, error: null };
    },
  }; } } } as unknown as SupabaseClient;
  assert.equal(await signedPhotoUrl(client, 'memory-photos', 'family/photo.jpg', 600), 'https://signed.test/photo');
  assert.deepEqual(calls, ['memory-photos', ['family/photo.jpg', 600]]);
});

test('batch signing preserves order and external URL placeholders', async () => {
  const client = { storage: { from() { return {
    async createSignedUrls(paths: string[]) {
      assert.deepEqual(paths, ['a.jpg', 'b.jpg']);
      return { data: [{ path: 'b.jpg', signedUrl: 'signed-b' }, { path: 'a.jpg', signedUrl: 'signed-a' }], error: null };
    },
  }; } } } as unknown as SupabaseClient;
  assert.deepEqual(await signedPhotoUrls(client, 'memory-photos', ['a.jpg', 'https://external.test/photo', 'b.jpg']), ['signed-a', null, 'signed-b']);
});
