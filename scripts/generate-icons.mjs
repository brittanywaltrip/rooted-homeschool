import sharp from 'sharp';
import { copyFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pub = (file) => resolve(__dirname, '../public', file);

function makeSvg(size) {
  const rx = Math.round(size * 0.208); // ~40/192 ratio
  const fontSize = Math.round(size * 0.573); // ~110/192 ratio
  const textY = Math.round(size * 0.677); // ~130/192 ratio
  const cx = Math.round(size / 2);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
  <rect width="${size}" height="${size}" rx="${rx}" fill="#5c7f63"/>
  <text x="${cx}" y="${textY}" font-size="${fontSize}" text-anchor="middle" font-family="Apple Color Emoji, Segoe UI Emoji, serif">🌿</text>
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
