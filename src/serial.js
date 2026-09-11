// WebSerial helpers: a byte transport with a read loop, and "wait for the
// device to come back" logic for the reboots that flashing/provisioning cause.

export const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export function portInfo(port) {
  try { const i = port.getInfo(); return { vid: i.usbVendorId, pid: i.usbProductId }; } catch { return {}; }
}
export function infoLabel(info) {
  return info && info.vid != null ? `${info.vid.toString(16).padStart(4, '0')}:${(info.pid || 0).toString(16).padStart(4, '0')}` : 'serial';
}

export class SerialTransport {
  constructor(port) {
    this.port = port; this.onBytes = () => {}; this.onClose = () => {}; this.reader = null; this.open_ = false;
  }
  get name() { return 'USB ' + infoLabel(portInfo(this.port)); }
  async open(baudRate = 115200) {
    await this.port.open({ baudRate });
    this.open_ = true;
    this._loop();
  }
  async _loop() {
    try {
      while (this.port.readable && this.open_) {
        const reader = this.port.readable.getReader(); this.reader = reader;
        try {
          for (;;) { const { value, done } = await reader.read(); if (done) break; if (value && value.length) this.onBytes(value); }
        } catch (_) { break; } finally { reader.releaseLock(); }
      }
    } finally {
      this.open_ = false;
      try { await this.port.close(); } catch (_) {}
      this.onClose();
    }
  }
  async send(bytes) {
    if (!this.port.writable) throw new Error('port is not open');
    const w = this.port.writable.getWriter();
    try { await w.write(bytes); } finally { w.releaseLock(); }
  }
  async close() {
    this.open_ = false;
    try { if (this.reader) await this.reader.cancel(); } catch (_) {}
    await sleep(50);
  }
}

// Wait until a port we hold is actually gone (device reset/unplugged), via the
// navigator.serial 'disconnect' event or its absence from getPorts().
export async function waitForGone(port, timeoutMs = 8000) {
  if (!port) return true;
  const deadline = Date.now() + timeoutMs;
  let kick = null;
  const onDisc = (ev) => { if (ev.target === port && kick) kick(); };
  navigator.serial.addEventListener('disconnect', onDisc);
  try {
    while (Date.now() < deadline) {
      let ports = []; try { ports = await navigator.serial.getPorts(); } catch (_) {}
      if (!ports.includes(port)) return true;
      await Promise.race([sleep(250), new Promise(r => { kick = r; })]); kick = null;
    }
    return false;
  } finally { navigator.serial.removeEventListener('disconnect', onDisc); }
}

// Ask the user for a port. `vendors` narrows the browser's picker.
export async function requestPort(vendors) {
  const filters = (vendors || []).filter(v => v != null).map(v => ({ usbVendorId: v }));
  return navigator.serial.requestPort(filters.length ? { filters } : {});
}

// Wait for a previously-authorised port that matches `match(info, port)` and
// can be opened. Chrome hands out a fresh SerialPort object after a USB
// re-enumeration and open() can fail for a moment afterwards, so we poll
// getPorts() and retry open() until the deadline. Resolves with an *opened*
// SerialTransport, or null on timeout (the caller then offers the picker).
export async function waitForPort({ match, baudRate = 115200, timeoutMs = 12000, log = () => {} }) {
  const deadline = Date.now() + timeoutMs;
  let kick = null;
  const onConnect = () => { if (kick) kick(); };
  navigator.serial.addEventListener('connect', onConnect);
  try {
    while (Date.now() < deadline) {
      let ports = [];
      try { ports = await navigator.serial.getPorts(); } catch (_) {}
      for (const p of ports) {
        const info = portInfo(p);
        if (!match(info, p)) continue;
        const t = new SerialTransport(p);
        try { await t.open(baudRate); return t; }
        catch (e) { /* not ready yet */ }
      }
      await Promise.race([sleep(400), new Promise(r => { kick = r; })]);
      kick = null;
    }
    return null;
  } finally { navigator.serial.removeEventListener('connect', onConnect); }
}
