import { createCanvas } from 'canvas';
import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function generateIcon(size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  // Background: rounded square
  const radius = size * 0.22;
  ctx.fillStyle = '#5c7f63';
  ctx.beginPath();
  ctx.moveTo(radius, 0);
  ctx.lineTo(size - radius, 0);
  ctx.quadraticCurveTo(size, 0, size, radius);
  ctx.lineTo(size, size - radius);
  ctx.quadraticCurveTo(size, size, size - radius, size);
  ctx.lineTo(radius, size);
  ctx.quadraticCurveTo(0, size, 0, size - radius);
  ctx.lineTo(0, radius);
  ctx.quadraticCurveTo(0, 0, radius, 0);
  ctx.closePath();
  ctx.fill();

  // Leaf emoji centered
  const fontSize = Math.round(size * 0.55);
  ctx.font = `${fontSize}px serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('🌿', size / 2, size / 2);

  return canvas.toBuffer('image/png');
}

const sizes = [192, 512];
for (const size of sizes) {
  const buf = generateIcon(size);
  const out = resolve(__dirname, `../public/icon-${size}.png`);
  writeFileSync(out, buf);
  console.log(`✓ Generated public/icon-${size}.png (${size}×${size})`);
}
