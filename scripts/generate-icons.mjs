import sharp from 'sharp';
import { copyFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pub = (file) => resolve(__dirname, '../public', file);

function makeSvg(size) {
  const s = size / 512;
  const rx = Math.round(110 * s);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
  <rect width="${size}" height="${size}" rx="${rx}" fill="#5c7f63"/>
  <g transform="translate(${size / 2},${size / 2}) scale(${0.72 * s})">
    <path d="M0,-140 C60,-140 130,-90 130,-10 C130,60 80,120 0,140 C-80,120 -130,60 -130,-10 C-130,-90 -60,-140 0,-140 Z"
      fill="none" stroke="white" stroke-width="18" stroke-linejoin="round"/>
    <path d="M0,140 L0,210"
      stroke="white" stroke-width="18" stroke-linecap="round"/>
    <path d="M0,20 C-40,20 -80,0 -80,-40"
      stroke="white" stroke-width="14" stroke-linecap="round" fill="none"/>
    <path d="M0,20 C40,20 80,0 80,-40"
      stroke="white" stroke-width="14" stroke-linecap="round" fill="none"/>
    <path d="M0,-140 L0,20"
      stroke="white" stroke-width="14" stroke-linecap="round"/>
  </g>
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
