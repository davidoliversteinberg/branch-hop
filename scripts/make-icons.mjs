// Draws the toolbar icon (a branch on Axiom lime) at each size Chrome and Safari ask for.
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const LIME = [0xab, 0xff, 0x44];
const INK = [0x20, 0x23, 0x20];
const NODES = [
  [0.36, 0.27],
  [0.36, 0.73],
  [0.66, 0.36],
];
const LINES = [
  [0.36, 0.27, 0.36, 0.73],
  [0.66, 0.36, 0.4, 0.6],
];
const NODE_R = 0.095;
const LINE_W = 0.09;
const CORNER = 0.22;

function segmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function insideRoundedSquare(x, y) {
  const cx = Math.min(Math.max(x, CORNER), 1 - CORNER);
  const cy = Math.min(Math.max(y, CORNER), 1 - CORNER);
  return Math.hypot(x - cx, y - cy) <= CORNER;
}

function insideGlyph(x, y) {
  return NODES.some(([nx, ny]) => Math.hypot(x - nx, y - ny) <= NODE_R) || LINES.some(([ax, ay, bx, by]) => segmentDistance(x, y, ax, ay, bx, by) <= LINE_W / 2);
}

function render(size) {
  const ss = 6;
  const px = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bg = 0;
      let ink = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const u = (x + (sx + 0.5) / ss) / size;
          const v = (y + (sy + 0.5) / ss) / size;
          if (insideRoundedSquare(u, v)) {
            bg++;
            if (insideGlyph(u, v)) ink++;
          }
        }
      }
      const n = ss * ss;
      const alpha = bg / n;
      const mix = bg ? ink / bg : 0;
      const i = (y * size + x) * 4;
      for (let c = 0; c < 3; c++) px[i + c] = Math.round(LIME[c] * (1 - mix) + INK[c] * mix);
      px[i + 3] = Math.round(alpha * 255);
    }
  }
  return px;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

mkdirSync("public/icons", { recursive: true });
for (const size of [16, 32, 48, 128]) {
  writeFileSync(`public/icons/icon-${size}.png`, png(size, render(size)));
  console.log(`public/icons/icon-${size}.png`);
}
