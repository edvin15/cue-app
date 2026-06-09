// Generate Cue brand icons (PWA + iOS) from an SVG source.
// Run once: `node tools/make-icons.cjs`. Writes into ./icons/.
const sharp = require('/tmp/node_modules/sharp');
const fs    = require('fs');
const path  = require('path');

// Brand: warm cream background, lowercase "cue" in serif, rose dot.
// Dot mirrors the home-screen wordmark: small, sits at baseline level
// to the right of "e" with a clear gap (acts like a period/tittle).
const SIZE = 1024;
const SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}">
  <defs>
    <radialGradient id="bg" cx="50%" cy="40%" r="75%">
      <stop offset="0%"  stop-color="#FBF5EC"/>
      <stop offset="100%" stop-color="#F0E5D2"/>
    </radialGradient>
  </defs>
  <rect width="${SIZE}" height="${SIZE}" fill="url(#bg)"/>
  <g transform="translate(${SIZE/2 - 80}, ${SIZE/2 + 110})">
    <text
      text-anchor="middle"
      x="0" y="0"
      font-family="Georgia, 'Times New Roman', serif"
      font-size="380"
      font-weight="400"
      letter-spacing="-10"
      fill="#2B2320">cue</text>
    <circle cx="270" cy="-8" r="24" fill="#C97A6D"/>
  </g>
</svg>`;

const outDir = path.join(__dirname, '..', 'icons');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

// Maskable variant: extra padding so platforms can mask without clipping.
const SVG_MASKABLE = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}">
  <rect width="${SIZE}" height="${SIZE}" fill="#F0E5D2"/>
  <g transform="translate(${SIZE/2 - 60}, ${SIZE/2 + 85})">
    <text
      text-anchor="middle"
      x="0" y="0"
      font-family="Georgia, 'Times New Roman', serif"
      font-size="290"
      font-weight="400"
      letter-spacing="-8"
      fill="#2B2320">cue</text>
    <circle cx="205" cy="-6" r="18" fill="#C97A6D"/>
  </g>
</svg>`;

const targets = [
  { name: 'icon-192.png',           size: 192, svg: SVG },
  { name: 'icon-512.png',           size: 512, svg: SVG },
  { name: 'icon-180.png',           size: 180, svg: SVG },  // apple-touch-icon
  { name: 'icon-maskable-512.png',  size: 512, svg: SVG_MASKABLE },
];

(async () => {
  for (const t of targets) {
    await sharp(Buffer.from(t.svg))
      .resize(t.size, t.size)
      .png()
      .toFile(path.join(outDir, t.name));
    console.log('wrote', t.name);
  }
})();
