'use strict';
// Minimal dependency-free ZIP reader (handles stored + deflate).
// Sufficient for OJ test-case bundles (small .in/.out text files).
const zlib = require('zlib');

const SIG_EOCD = 0x06054b50;
const SIG_CEN = 0x02014b50;

function findEOCD(buf) {
  const min = Math.max(0, buf.length - 0xffff);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) return i;
  }
  return -1;
}

// Returns [{ name: string, data: Buffer }]
function parseZip(buf) {
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf);
  const eocd = findEOCD(buf);
  if (eocd < 0) throw new Error('找不到中央目录（不是有效的 ZIP）');
  const cdOffset = buf.readUInt32LE(eocd + 16);
  const total = buf.readUInt16LE(eocd + 10);
  const files = [];
  let p = cdOffset;
  for (let n = 0; n < total; n++) {
    if (buf.readUInt32LE(p) !== SIG_CEN) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    let data = buf.slice(dataStart, dataStart + compSize);
    if (method === 8) data = zlib.inflateRawSync(data);
    else if (method !== 0) throw new Error('不支持的压缩方式: ' + method);
    files.push({ name, data });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

// Match *.in / *.out (or .ans/.sol) pairs by base name.
// Returns { cases:[{input,output}], skipped:[string] }
function matchCases(files) {
  const roleOf = (name) => {
    const lower = name.toLowerCase();
    if (lower.endsWith('.in')) return ['in', lower.slice(0, -3)];
    if (lower.endsWith('.out') || lower.endsWith('.ans') || lower.endsWith('.sol')) {
      return ['out', lower.slice(0, lower.lastIndexOf('.'))];
    }
    return null;
  };
  const map = new Map();
  const skipped = [];
  for (const f of files) {
    if (f.name.endsWith('/')) continue; // directory entry
    const bn = f.name.split('/').pop();
    const role = roleOf(bn);
    if (!role) { skipped.push(bn); continue; }
    const [r, key] = role;
    if (!map.has(key)) map.set(key, {});
    map.get(key)[r] = f.data.toString('utf8');
  }
  const keys = [...map.keys()].sort((a, b) => {
    const na = parseInt(a, 10), nb = parseInt(b, 10);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return a.localeCompare(b);
  });
  const cases = keys.map((k) => ({
    input: map.get(k).in != null ? map.get(k).in : '',
    output: map.get(k).out != null ? map.get(k).out : '',
  }));
  return { cases, skipped };
}

module.exports = { parseZip, matchCases };
