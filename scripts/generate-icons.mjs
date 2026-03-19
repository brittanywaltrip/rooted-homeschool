import sharp from 'sharp';
import { copyFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pub = (file) => resolve(__dirname, '../public', file);

function makeSvg(size) {
  const s = size / 512; // scale factor relative to 512px master
  const r = (n) => Math.round(n * s);
  const f = (n) => parseFloat((n * s).toFixed(3));

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
  <rect width="${size}" height="${size}" rx="${r(115)}" fill="#5c7f63"/>
  <!-- Stem -->
  <rect x="${r(243)}" y="${r(280)}" width="${r(26)}" height="${r(120)}" rx="${r(13)}" fill="white"/>
  <!-- Left leaf -->
  <ellipse cx="${r(185)}" cy="${r(240)}" rx="${r(70)}" ry="${r(40)}" fill="white" transform="rotate(-35 ${r(185)} ${r(240)})"/>
  <!-- Right leaf -->
  <ellipse cx="${r(327)}" cy="${r(240)}" rx="${r(70)}" ry="${r(40)}" fill="white" transform="rotate(35 ${r(327)} ${r(240)})"/>
  <!-- Top sprout -->
  <ellipse cx="${r(256)}" cy="${r(190)}" rx="${r(38)}" ry="${r(55)}" fill="white"/>
  <!-- Small soil mound -->
  <ellipse cx="${r(256)}" cy="${r(395)}" rx="${r(60)}" ry="${r(18)}" fill="rgba(255,255,255,0.3)"/>
</svg>`;
}

for (const size of [192, 512]) {
  const svg = Buffer.from(makeSvg(size));
  const out = pub(`icon-${size}.png`);
  await sharp(svg).png().toFile(out);
  console.log(`✓ Generated public/icon-${size}.png (${size}×${size})`);
}

copyFileSync(pub('icon-192.png'), pub('apple-touch-icon.png'));
console.log('✓ Copied icon-192.png → apple-touch-icon.png');
