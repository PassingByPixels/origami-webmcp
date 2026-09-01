/**
 * A small PNG, generated here rather than fetched or vendored — the reel embeds it as a data URI
 * inside a document fold to show that an IMAGE is just another block in the flow.
 *
 * Written by hand because the repo has no image encoder and this script may not add a dependency:
 * signature, IHDR, one deflated IDAT of filter-0 RGB scanlines, IEND. Flat paper colours, so the
 * whole thing deflates to a few KB — well inside the 30 KB the reel budgets for it.
 */
import { deflateSync } from 'node:zlib';

const W = 420;
const H = 236;

const LINEN = [0xef, 0xe9, 0xdc];
const PAPER = [0xfa, 0xf7, 0xf2];
const GREEN_DARK = [0x3f, 0x5f, 0x39];
const GREEN = [0x55, 0x7a, 0x4e];
const COPPER = [0x8a, 0x45, 0x22];
const COPPER_LIGHT = [0xb3, 0x66, 0x38];
const RULE = [0xd8, 0xcf, 0xbc];

/** Point-in-triangle by sign of the three edge cross-products. */
function inTri(px, py, [ax, ay], [bx, by], [cx, cy]) {
  const d = (x1, y1, x2, y2, x3, y3) => (x1 - x3) * (y2 - y3) - (x2 - x3) * (y1 - y3);
  const d1 = d(px, py, ax, ay, bx, by);
  const d2 = d(px, py, bx, by, cx, cy);
  const d3 = d(px, py, cx, cy, ax, ay);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

/* One paper kite, folded: two facets catching different light, exactly the way the site's petals
   are drawn. Left facet dark, right facet light, a hairline crease down the spine. */
function petal(cx, cy, halfW, up, down, dark, light) {
  const tip = [cx, cy - up];
  const base = [cx, cy + down];
  const left = [cx - halfW, cy];
  const right = [cx + halfW, cy];
  return (x, y) => {
    if (inTri(x, y, tip, left, base)) return Math.abs(x - cx) < 1.2 ? RULE : dark;
    if (inTri(x, y, tip, right, base)) return Math.abs(x - cx) < 1.2 ? RULE : light;
    return null;
  };
}

function pixels() {
  const shapes = [
    petal(140, 118, 46, 86, 54, GREEN_DARK, GREEN),
    petal(232, 126, 40, 74, 46, COPPER, COPPER_LIGHT),
    petal(314, 132, 34, 62, 38, [0x7c, 0x96, 0x73], [0xb7, 0xca, 0xb0]),
  ];
  const rows = [];
  for (let y = 0; y < H; y++) {
    const row = Buffer.alloc(1 + W * 3); // leading filter byte 0
    for (let x = 0; x < W; x++) {
      // the sheet the petals lie on: paper inset in a linen border, with a hairline edge
      const onSheet = x >= 16 && x < W - 16 && y >= 14 && y < H - 14;
      const onEdge = onSheet && (x === 16 || x === W - 17 || y === 14 || y === H - 15);
      let c = onEdge ? RULE : onSheet ? PAPER : LINEN;
      for (const s of shapes) {
        const hit = s(x, y);
        if (hit) c = hit;
      }
      row[1 + x * 3] = c[0];
      row[2 + x * 3] = c[1];
      row[3 + x * 3] = c[2];
    }
    rows.push(row);
  }
  return Buffer.concat(rows);
}

const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return (buf) => {
    let c = -1;
    for (const b of buf) c = t[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
})();

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(CRC(body));
  return Buffer.concat([len, body, crc]);
}

function png() {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(pixels(), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const BYTES = png();

/** The `src` for an <img>. Inert by the format's rules: a data: URI fetches nothing. */
export const IMAGE_DATA_URI = `data:image/png;base64,${BYTES.toString('base64')}`;
export const IMAGE_BYTES = BYTES.length;
export const IMAGE_SIZE = { width: W, height: H };
