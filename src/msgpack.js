// Minimal MsgPack — enough for the microReticulum Provisioning envelope
// ([op, seq, payload] with int keys, bools, strings, bin, arrays, maps).
export function pack(v) {
  const out = [];
  const enc = (x) => {
    if (x === null || x === undefined) { out.push(0xC0); return; }
    if (x === true) { out.push(0xC3); return; }
    if (x === false) { out.push(0xC2); return; }
    if (typeof x === 'number') {
      if (Number.isInteger(x)) {
        if (x >= 0 && x < 128) out.push(x);
        else if (x >= -32 && x < 0) out.push(0x100 + x);
        else if (x >= 0 && x < 256) out.push(0xCC, x);
        else if (x >= 0 && x < 65536) out.push(0xCD, x >> 8, x & 0xFF);
        else if (x >= 0 && x < 2 ** 32) out.push(0xCE, (x >>> 24) & 0xFF, (x >>> 16) & 0xFF, (x >>> 8) & 0xFF, x & 0xFF);
        else if (x < 0 && x >= -128) out.push(0xD0, x & 0xFF);
        else if (x < 0 && x >= -32768) out.push(0xD1, (x >> 8) & 0xFF, x & 0xFF);
        else if (x < 0 && x >= -(2 ** 31)) out.push(0xD2, (x >>> 24) & 0xFF, (x >>> 16) & 0xFF, (x >>> 8) & 0xFF, x & 0xFF);
        else throw new Error('int out of range');
      } else {
        const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, x); out.push(0xCB, ...b);
      }
      return;
    }
    if (x instanceof Uint8Array) {
      if (x.length < 256) out.push(0xC4, x.length);
      else if (x.length < 65536) out.push(0xC5, x.length >> 8, x.length & 0xFF);
      else out.push(0xC6, (x.length >>> 24) & 0xFF, (x.length >>> 16) & 0xFF, (x.length >>> 8) & 0xFF, x.length & 0xFF);
      for (const b of x) out.push(b);
      return;
    }
    if (typeof x === 'string') {
      const u = new TextEncoder().encode(x);
      if (u.length < 32) out.push(0xA0 | u.length);
      else if (u.length < 256) out.push(0xD9, u.length);
      else out.push(0xDA, u.length >> 8, u.length & 0xFF);
      for (const b of u) out.push(b);
      return;
    }
    if (Array.isArray(x)) {
      if (x.length < 16) out.push(0x90 | x.length); else out.push(0xDC, x.length >> 8, x.length & 0xFF);
      x.forEach(enc); return;
    }
    if (typeof x === 'object') {
      const keys = Object.keys(x);
      if (keys.length < 16) out.push(0x80 | keys.length); else out.push(0xDE, keys.length >> 8, keys.length & 0xFF);
      for (const k of keys) { enc(/^-?\d+$/.test(k) ? parseInt(k, 10) : k); enc(x[k]); }
      return;
    }
    throw new Error('cannot pack ' + typeof x);
  };
  enc(v);
  return new Uint8Array(out);
}

export function unpack(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let i = 0;
  const str = (n) => { const s = new TextDecoder().decode(bytes.subarray(i, i + n)); i += n; return s; };
  const bin = (n) => { const b = bytes.slice(i, i + n); i += n; return b; };
  const arr = (n) => { const a = []; for (let k = 0; k < n; k++) a.push(dec()); return a; };
  const map = (n) => { const m = {}; for (let k = 0; k < n; k++) { const key = dec(); m[key] = dec(); } return m; };
  const dec = () => {
    const t = bytes[i++];
    if (t <= 0x7F) return t;
    if (t >= 0xE0) return t - 256;
    if ((t & 0xF0) === 0x80) return map(t & 0x0F);
    if ((t & 0xF0) === 0x90) return arr(t & 0x0F);
    if ((t & 0xE0) === 0xA0) return str(t & 0x1F);
    switch (t) {
      case 0xC0: return null;
      case 0xC2: return false;
      case 0xC3: return true;
      case 0xC4: return bin(bytes[i++]);
      case 0xC5: { const n = dv.getUint16(i); i += 2; return bin(n); }
      case 0xC6: { const n = dv.getUint32(i); i += 4; return bin(n); }
      case 0xCA: { const f = dv.getFloat32(i); i += 4; return f; }
      case 0xCB: { const f = dv.getFloat64(i); i += 8; return f; }
      case 0xCC: return bytes[i++];
      case 0xCD: { const n = dv.getUint16(i); i += 2; return n; }
      case 0xCE: { const n = dv.getUint32(i); i += 4; return n; }
      case 0xCF: { const n = Number(dv.getBigUint64(i)); i += 8; return n; }
      case 0xD0: return dv.getInt8(i++);
      case 0xD1: { const n = dv.getInt16(i); i += 2; return n; }
      case 0xD2: { const n = dv.getInt32(i); i += 4; return n; }
      case 0xD3: { const n = Number(dv.getBigInt64(i)); i += 8; return n; }
      case 0xD9: return str(bytes[i++]);
      case 0xDA: { const n = dv.getUint16(i); i += 2; return str(n); }
      case 0xDB: { const n = dv.getUint32(i); i += 4; return str(n); }
      case 0xDC: { const n = dv.getUint16(i); i += 2; return arr(n); }
      case 0xDD: { const n = dv.getUint32(i); i += 4; return arr(n); }
      case 0xDE: { const n = dv.getUint16(i); i += 2; return map(n); }
      case 0xDF: { const n = dv.getUint32(i); i += 4; return map(n); }
      default: throw new Error('msgpack: unsupported type 0x' + t.toString(16));
    }
  };
  return dec();
}
