import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const iconsDir = path.join(projectRoot, 'src-tauri', 'icons');

// Desktop App & Tray SVG with distinct Cyan-Blue gradient and Desktop display badge
const desktopSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="bg-grad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0284c7" />
      <stop offset="50%" stop-color="#0369a1" />
      <stop offset="100%" stop-color="#0f172a" />
    </linearGradient>
    <linearGradient id="pi-grad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#38bdf8" />
      <stop offset="100%" stop-color="#ffffff" />
    </linearGradient>
    <linearGradient id="glow-grad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.8" />
      <stop offset="100%" stop-color="#818cf8" stop-opacity="0.8" />
    </linearGradient>
  </defs>
  <!-- Background with subtle border -->
  <rect x="1" y="1" width="62" height="62" rx="14" fill="url(#bg-grad)" stroke="url(#glow-grad)" stroke-width="2" />
  
  <!-- Desktop monitor / window frame accent line at top -->
  <rect x="10" y="8" width="44" height="2.5" rx="1.2" fill="#38bdf8" opacity="0.8" />

  <!-- The Pi Emblem in crisp bright cyan/white -->
  <path fill="url(#pi-grad)" d="M14 17h36v7H40v31h-7V24h-6v22h-7V24h-6z" />

  <!-- "D" (Desktop) small badge indicator at bottom-right corner -->
  <circle cx="50" cy="50" r="10" fill="#0284c7" stroke="#38bdf8" stroke-width="1.5" />
  <text x="50" y="54" font-family="sans-serif" font-weight="900" font-size="10" fill="#ffffff" text-anchor="middle">D</text>
</svg>
`;

// Pure Tray SVG: optimized for 16x16 / 32x32 / 48x48 taskbar visibility
const desktopTraySvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="tray-bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0284c7" />
      <stop offset="100%" stop-color="#0369a1" />
    </linearGradient>
  </defs>
  <!-- Vibrant rounded squircle -->
  <rect width="64" height="64" rx="16" fill="url(#tray-bg)" />
  <rect x="2" y="2" width="60" height="60" rx="14" fill="none" stroke="#38bdf8" stroke-width="3" />
  
  <!-- Desktop screen outline -->
  <rect x="8" y="8" width="48" height="48" rx="8" fill="#0c4a6e" />
  <!-- Pi glyph inside -->
  <path fill="#38bdf8" d="M16 16h32v6H38v26h-6V22h-6v18h-6V22h-4z" />
  <!-- Stand base -->
  <rect x="22" y="58" width="20" height="3" rx="1.5" fill="#38bdf8" />
</svg>
`;

function buildIco(pngBuffers) {
  const count = pngBuffers.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // icon type
  header.writeUInt16LE(count, 4);

  const dirSize = 16 * count;
  let offset = 6 + dirSize;
  const dirBuffers = [];

  for (const { buffer, size } of pngBuffers) {
    const dir = Buffer.alloc(16);
    dir.writeUInt8(size >= 256 ? 0 : size, 0);
    dir.writeUInt8(size >= 256 ? 0 : size, 1);
    dir.writeUInt8(0, 2); // colors
    dir.writeUInt8(0, 3); // reserved
    dir.writeUInt16LE(1, 4); // color planes
    dir.writeUInt16LE(32, 6); // bpp
    dir.writeUInt32LE(buffer.length, 8); // image size
    dir.writeUInt32LE(offset, 12); // offset
    dirBuffers.push(dir);
    offset += buffer.length;
  }

  return Buffer.concat([header, ...dirBuffers, ...pngBuffers.map(p => p.buffer)]);
}

async function run() {
  if (!fs.existsSync(iconsDir)) {
    fs.mkdirSync(iconsDir, { recursive: true });
  }

  console.log('Generating Desktop app icons and distinctive Tray icons...');

  // Standard sizes
  const sizes = [16, 24, 32, 48, 64, 128, 256, 512];
  const appPngBuffers = [];
  const trayPngBuffers = [];

  for (const size of sizes) {
    const appBuf = await sharp(Buffer.from(desktopSvg)).resize(size, size).png().toBuffer();
    appPngBuffers.push({ buffer: appBuf, size });

    const trayBuf = await sharp(Buffer.from(desktopTraySvg)).resize(size, size).png().toBuffer();
    trayPngBuffers.push({ buffer: trayBuf, size });

    if (size === 32) {
      fs.writeFileSync(path.join(iconsDir, '32x32.png'), appBuf);
      fs.writeFileSync(path.join(iconsDir, 'tray-desktop-32.png'), trayBuf);
    } else if (size === 128) {
      fs.writeFileSync(path.join(iconsDir, '128x128.png'), appBuf);
      fs.writeFileSync(path.join(iconsDir, 'tray-desktop-128.png'), trayBuf);
    } else if (size === 256) {
      fs.writeFileSync(path.join(iconsDir, '128x128@2x.png'), appBuf);
    } else if (size === 512) {
      fs.writeFileSync(path.join(iconsDir, 'icon.png'), appBuf);
      fs.writeFileSync(path.join(iconsDir, 'tray-desktop.png'), trayBuf);
    }
  }

  // Generate ICOs
  const appIco = buildIco(appPngBuffers.filter(p => [16, 24, 32, 48, 64, 128, 256].includes(p.size)));
  fs.writeFileSync(path.join(iconsDir, 'icon.ico'), appIco);

  const trayIco = buildIco(trayPngBuffers.filter(p => [16, 24, 32, 48, 64].includes(p.size)));
  fs.writeFileSync(path.join(iconsDir, 'tray-desktop.ico'), trayIco);

  console.log('Successfully generated distinct desktop app & tray icons!');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
