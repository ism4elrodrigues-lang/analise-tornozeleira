// Gera ícones simples da extensão (um "pin" de localização) nos tamanhos exigidos pelo manifest.
// Executado uma vez em dev-time; não faz parte do runtime da extensão.
const { PNG } = require('pngjs');
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..', 'icons');
const BG = [0x1e, 0x3a, 0x5f, 255]; // azul petróleo
const PIN = [0xff, 0xff, 0xff, 255]; // branco
const DOT = [0x4c, 0xaf, 0xd9, 255]; // azul claro (furo do pin)

function drawIcon(size) {
  const png = new PNG({ width: size, height: size });
  const cx = size / 2;
  const cy = size * 0.42;
  const r = size * 0.28;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (size * y + x) << 2;
      let color = BG;

      // corpo do pin: círculo + triângulo apontando para baixo
      const dx = x - cx;
      const dy = y - cy;
      const inCircle = dx * dx + dy * dy <= r * r;

      const triTop = cy + r * 0.15;
      const triBottom = size * 0.86;
      const halfWidthAt = (yy) => {
        const t = (triBottom - yy) / (triBottom - triTop);
        return Math.max(0, r * 0.9 * t);
      };
      const inTriangle =
        y >= triTop && y <= triBottom && Math.abs(dx) <= halfWidthAt(y);

      if (inCircle || inTriangle) {
        color = PIN;
      }

      const innerR = r * 0.4;
      if (dx * dx + dy * dy <= innerR * innerR) {
        color = DOT;
      }

      png.data[idx] = color[0];
      png.data[idx + 1] = color[1];
      png.data[idx + 2] = color[2];
      png.data[idx + 3] = color[3];
    }
  }
  return png;
}

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

for (const size of [16, 32, 48, 128]) {
  const png = drawIcon(size);
  const outPath = path.join(OUT_DIR, `icon${size}.png`);
  png.pack().pipe(fs.createWriteStream(outPath)).on('finish', () => {
    console.log('gerado', outPath);
  });
}
