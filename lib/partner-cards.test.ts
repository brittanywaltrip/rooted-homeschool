import { test } from 'node:test';
import assert from 'node:assert/strict';
import { printCardHtml, shareCardHtml } from './partner-cards.ts';
import { PARTNER_DISCLOSURE } from './partner-disclosure.ts';

for (const [label, render] of [['print', printCardHtml], ['share', shareCardHtml]] as const) {
  test(`${label} card keeps financial disclosure with the discount, inside the shared card`, () => {
    const html = render('Synthetic Partner', 'SYNTHETIC', 'rootedhomeschoolapp.com/?ref=SYNTHETIC', 'data:image/png;base64,TEST');
    const disclosure = html.indexOf(`<p class="disclosure">${PARTNER_DISCLOSURE}</p>`);
    const card = html.indexOf('<div class="card">');
    const discount = html.indexOf('15% off Rooted+', card);
    assert.ok(card >= 0 && discount > card && disclosure > discount);
    assert.ok(disclosure - discount < 150, 'disclosure belongs beside the offer');
    assert.match(html, /\.disclosure\{font-size:14px;line-height:1\.5;color:#2d2926/);
    assert.ok(!/\.disclosure[^}]*display\s*:\s*none/.test(html));
    assert.ok(html.includes('https://rootedhomeschoolapp.com/?ref=SYNTHETIC'));
    assert.ok(html.includes('data:image/png;base64,TEST'));
  });

  test(`${label} card escapes partner input without losing the disclosure`, () => {
    const html = render('<img src=x onerror=alert(1)>', '<script>alert(1)</script>', 'rootedhomeschoolapp.com/?ref="bad"&x=1', 'data:image/png;base64,TEST');
    assert.ok(!html.includes('<script>'));
    assert.ok(!html.includes('<img src=x'));
    assert.ok(html.includes('&lt;script&gt;'));
    assert.ok(html.includes('ref=&quot;bad&quot;&amp;x=1'));
    assert.ok(html.includes(PARTNER_DISCLOSURE));
  });
}
