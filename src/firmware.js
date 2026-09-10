// Firmware index, download with progress + sha256 check, zip unpacking,
// and the two firmware-hash algorithms the RNode firmware family uses.
export async function loadIndex() {
  const r = await fetch('firmware/index.json', { cache: 'no-store' });
  if (!r.ok) throw new Error('firmware index unavailable (' + r.status + ')');
  return await r.json();
}

export async function download(url, expectedSize, onProgress) {
  const r = await fetch(url, { cache: 'force-cache' });
  if (!r.ok) throw new Error(`download failed (${r.status})`);
  const total = Number(r.headers.get('content-length')) || expectedSize || 0;
  const reader = r.body.getReader(); const chunks = []; let got = 0;
  for (;;) { const { value, done } = await reader.read(); if (done) break; chunks.push(value); got += value.length; onProgress && onProgress(got, total); }
  const out = new Uint8Array(got); let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

export async function sha256hex(bytes) {
  const d = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(d), b => b.toString(16).padStart(2, '0')).join('');
}
export async function sha256(bytes) { return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)); }

// zip.js (global `zip`, loaded as a classic script) → { name: Uint8Array }
export async function unzip(bytes) {
  const reader = new zip.ZipReader(new zip.Uint8ArrayReader(bytes));
  const entries = await reader.getEntries(); const files = {};
  for (const e of entries) if (!e.directory) files[e.filename] = await e.getData(new zip.Uint8ArrayWriter());
  await reader.close();
  return files;
}

// What esp_partition_get_sha256() reports for an app image — and what the
// firmware compares against the stored hash. Appended-digest images (header
// byte 23 == 1) carry their own SHA-256 in the last 32 bytes.
export async function espImageHash(image) {
  if (image.length < 24 || image[0] !== 0xE9) throw new Error('not an ESP application image');
  if (image[23] !== 1) return await sha256(image);
  const content = image.subarray(0, image.length - 32), appended = image.subarray(image.length - 32);
  const calc = await sha256(content);
  if (!calc.every((v, i) => v === appended[i])) throw new Error('ESP image has an invalid appended SHA-256');
  return appended;
}

// nRF52 DFU package: manifest.json → application {bin_file, dat_file}
export function nrfApplication(files) {
  const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json'] || new Uint8Array()) || '{}').manifest;
  if (!manifest || !manifest.application) throw new Error('DFU package has no application image');
  const bin = files[manifest.application.bin_file], dat = files[manifest.application.dat_file];
  if (!bin || !dat) throw new Error('DFU package is incomplete');
  // init packet: [dev_type u16, dev_rev u16, app_version u32, sd_count u16, sd_req u16...]
  const dv = new DataView(dat.buffer, dat.byteOffset, dat.byteLength);
  const sdCount = dat.length >= 10 ? dv.getUint16(8, true) : 0;
  const sdReq = []; for (let i = 0; i < sdCount && 10 + i * 2 + 1 < dat.length; i++) sdReq.push(dv.getUint16(10 + i * 2, true));
  return { bin, dat, sdReq };
}
