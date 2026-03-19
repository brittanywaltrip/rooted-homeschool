import sharp from 'sharp';
import { copyFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pub = (file) => resolve(__dirname, '../public', file);

function makeSvg(size) {
  const rx = Math.round(size * 0.215);
  const fontSize = Math.round(size * 0.58);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
  <rect width="${size}" height="${size}" rx="${rx}" fill="#5c7f63"/>
  <text
    x="${size / 2}"
    y="${Math.round(size * 0.75)}"
    font-family="Georgia, 'Times New Roman', serif"
    font-size="${fontSize}"
    font-weight="bold"
    fill="white"
    text-anchor="middle"
  >R</text>
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
