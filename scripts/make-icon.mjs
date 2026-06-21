/*
 * M2_LOG
 * Copyright (c) 2026 OA Hsiao
 * SPDX-License-Identifier: MIT
 *
 * This source code is licensed under the MIT License found in the
 * LICENSE file in the root directory of this source tree.
 */

// Generate the M2_LOG app icon (a yellow "log document" mark on a dark rounded
// tile) as a PNG, with zero external dependencies. The same geometry is mirrored
// by the inline SVG brand logo + favicon in index.html, so every logo surface
// shows the identical yellow icon.
//
// Run: node scripts/make-icon.mjs

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const S = 512; // canvas size
const TILE = [31, 39, 51]; // dark slate #1f2733
const YEL = [250, 204, 21]; // #facc15

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function sdRoundRect(px, py, cx, cy, hx, hy, r) {
  const qx = Math.abs(px - cx) - (hx - r);
  const qy = Math.abs(py - cy) - (hy - r);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  const inside = Math.min(Math.max(qx, qy), 0);
  return outside + inside - r;
}

function sdSegment(px, py, ax, ay, bx, by) {
  const pax = px - ax;
  const pay = py - ay;
  const bax = bx - ax;
  const bay = by - ay;
  const h = clamp((pax * bax + pay * bay) / (bax * bax + bay * bay), 0, 1);
  return Math.hypot(pax - bax * h, pay - bay * h);
}

// Straight-alpha "source over". Colors are [r,g,b] 0-255; alpha 0-1.
function over(dst, color, a) {
  const sa = a;
  const da = dst[3];
  const oa = sa + da * (1 - sa);
  if (oa <= 0) return [0, 0, 0, 0];
  const r = (color[0] * sa + dst[0] * da * (1 - sa)) / oa;
  const g = (color[1] * sa + dst[1] * da * (1 - sa)) / oa;
  const b = (color[2] * sa + dst[2] * da * (1 - sa)) / oa;
  return [r, g, b, oa];
}

// Geometry (in 512 space): a tall document outline with three text lines.
const tileR = 112;
const pageHX = S * 0.24;
const pageHY = S * 0.32;
const pageR = 44;
const strokePage = 28;
const lineW = 24;
const lines = [
  [S * 0.32, S * 0.68, S * 0.36],
  [S * 0.32, S * 0.68, S * 0.5],
  [S * 0.32, S * 0.58, S * 0.64],
];

const buf = Buffer.alloc(S * S * 4);
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const px = x + 0.5;
    const py = y + 0.5;
    let col = [0, 0, 0, 0];

    // dark rounded tile
    const sdT = sdRoundRect(px, py, S / 2, S / 2, S / 2, S / 2, tileR);
    const covT = clamp(0.5 - sdT, 0, 1);
    if (covT > 0) col = over(col, TILE, covT);

    // yellow page outline (stroke)
    const sdP = sdRoundRect(px, py, S / 2, S / 2, pageHX, pageHY, pageR);
    const covP = clamp(0.5 - (Math.abs(sdP) - strokePage / 2), 0, 1);
    if (covP > 0) col = over(col, YEL, covP);

    // yellow text lines
    for (const [ax, bx, ly] of lines) {
      const d = sdSegment(px, py, ax, ly, bx, ly) - lineW / 2;
      const cov = clamp(0.5 - d, 0, 1);
      if (cov > 0) col = over(col, YEL, cov);
    }

    const i = (y * S + x) * 4;
    buf[i] = Math.round(col[0]);
    buf[i + 1] = Math.round(col[1]);
    buf[i + 2] = Math.round(col[2]);
    buf[i + 3] = Math.round(col[3] * 255);
  }
}

// --- Minimal PNG encoder (RGBA, 8-bit) ---
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf2) {
  let c = 0xffffffff;
  for (let i = 0; i < buf2.length; i++) c = CRC_TABLE[(c ^ buf2[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}
function encodePng(rgba, w, h) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

const png = encodePng(buf, S, S);
const targets = [path.join(ROOT, 'src', 'assets', 'icon.png'), path.join(ROOT, 'build', 'icon.png')];
for (const t of targets) {
  fs.mkdirSync(path.dirname(t), { recursive: true });
  fs.writeFileSync(t, png);
  console.log('wrote', path.relative(ROOT, t), `(${png.length} bytes)`);
}
