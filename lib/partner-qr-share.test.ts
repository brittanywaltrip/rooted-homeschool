import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const component = readFileSync(new URL('../components/PartnerQrShareCard.tsx', import.meta.url), 'utf8');
const settings = readFileSync(new URL('../app/dashboard/settings/page.tsx', import.meta.url), 'utf8');

test('the Settings QR screenshot box carries the commission disclosure inside it', () => {
  const box = component.slice(component.indexOf('<figure'), component.indexOf('</figure>'));
  assert.match(box, /<img[\s\S]*api\/affiliate\/qr/);
  assert.match(box, /\{PARTNER_DISCLOSURE\}/);
  assert.match(box, /\{code\}/);
});

test('the guidance asks partners to keep the disclosure in the screenshot', () => {
  assert.match(component, /Keep this whole box in the picture so the disclosure stays visible/);
  assert.doesNotMatch(component + settings, /Screenshot to share anywhere/);
});

test('both the partner panel and the admin preview use the shared QR box', () => {
  assert.match(settings, /<PartnerQrShareCard code=\{previewAffiliate\.code\} \/>/);
  assert.match(settings, /<PartnerQrShareCard code=\{affiliateData\.code\} \/>/);
  assert.equal((settings.match(/api\/affiliate\/qr/g) ?? []).length, 0);
});
