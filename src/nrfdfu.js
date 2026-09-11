// nRF52 serial DFU over WebSerial — the legacy Adafruit/Nordic SDK 11 HCI/SLIP
// protocol, mirroring adafruit-nrfutil's dfu_transport_serial.py: every packet
// is acknowledged by the bootloader and we wait for that ack before sending the
// next one, so we always know where the bootloader is. SLIP/HCI framing after
// liamcottle/rnode-flasher (MIT).
const FLASH_PAGE_SIZE = 4096, FLASH_PAGE_ERASE_TIME = 0.0897, FLASH_PAGE_WRITE_TIME = (FLASH_PAGE_SIZE / 4) * 0.0001;
const DFU_INIT_PACKET = 1, DFU_START_PACKET = 3, DFU_DATA_PACKET = 4, DFU_STOP_DATA_PACKET = 5;
const HEX_TYPE_APPLICATION = 4, DFU_PACKET_MAX_SIZE = 512, ACK_TIMEOUT_MS = 1000;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export async function dfuTouch(port) {
  await port.open({ baudRate: 1200 }); await sleep(100); await port.close();
}

export class DfuSerial {
  constructor(port, log = () => {}) { this.port = port; this.log = log; this.seq = 0; this.rx = []; this.waiters = []; this.lost = false; this.totalSize = 0; }

  async open() {
    await this.port.open({ baudRate: 115200, bufferSize: 8192 });
    this._readLoop();
    await sleep(100);
  }
  async _readLoop() {
    this.loopDone = new Promise(r => { this._loopDone = r; });
    try {
      while (this.port.readable && !this.closing) {
        const reader = this.port.readable.getReader(); this.reader = reader;
        try { for (;;) { const { value, done } = await reader.read(); if (done) break; if (value) { for (const b of value) this.rx.push(b); this._wake(); } } }
        catch (_) { break; } finally { reader.releaseLock(); }
      }
    } finally { this.lost = true; this._wake(); this._loopDone(); }
  }
  _wake() { const ws = this.waiters; this.waiters = []; ws.forEach(w => w()); }
  async close() {
    this.closing = true;
    try { if (this.reader) await this.reader.cancel(); } catch (_) {}
    await Promise.race([this.loopDone, sleep(2000)]);      // let the read loop release the port
    try { await this.port.close(); } catch (_) {}
  }

  // Wait for one SLIP frame (C0 … C0) and return its ack number, or null on timeout.
  async readAck(timeoutMs = ACK_TIMEOUT_MS) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const a = this.rx.indexOf(0xC0);
      if (a >= 0) { const b = this.rx.indexOf(0xC0, a + 1); if (b > a) { const frame = this.rx.slice(a + 1, b); this.rx = this.rx.slice(b + 1); const d = []; for (let i = 0; i < frame.length; i++) { if (frame[i] === 0xDB && i + 1 < frame.length) { d.push(frame[i + 1] === 0xDC ? 0xC0 : 0xDB); i++; } else d.push(frame[i]); } if (!d.length) continue; return (d[0] >> 3) & 0x07; } }
      if (this.lost) throw new Error('device lost');
      const left = deadline - Date.now(); if (left <= 0) return null;
      await Promise.race([sleep(Math.min(left, 200)), new Promise(r => this.waiters.push(r))]);
    }
  }
  async write(bytes) { const w = this.port.writable.getWriter(); try { await w.write(new Uint8Array(bytes)); } finally { w.releaseLock(); } }
  async sendPacket(frame) {
    const pkt = this._hci(frame);
    for (let attempt = 1; attempt <= 3; attempt++) {
      await this.write(pkt);
      const ack = await this.readAck();
      if (ack !== null) return ack;
      this.log(`DFU: no ack for packet ${this.seq} (attempt ${attempt})`, 'wn');
    }
    throw new Error('the bootloader stopped acknowledging packets');
  }
  _hci(frame) {
    this.seq = (this.seq + 1) % 8;
    const h = [0, 0, 0, 0];
    h[0] = this.seq | (((this.seq + 1) % 8) << 3) | (1 << 6) | (1 << 7);    // dip, reliable
    h[1] = 14 | ((frame.length & 0x000F) << 4);                              // HCI packet type 14
    h[2] = (frame.length & 0x0FF0) >> 4;
    h[3] = (~(h[0] + h[1] + h[2]) + 1) & 0xFF;
    const data = [...h, ...frame];
    let crc = 0xFFFF; for (const b of data) { crc = ((crc >> 8) & 0xFF) | ((crc << 8) & 0xFF00); crc ^= b; crc ^= (crc & 0xFF) >> 4; crc ^= (crc << 8) << 4; crc ^= ((crc & 0xFF) << 4) << 1; crc &= 0xFFFF; }
    data.push(crc & 0xFF, (crc >> 8) & 0xFF);
    const out = [0xC0]; for (const b of data) { if (b === 0xC0) out.push(0xDB, 0xDC); else if (b === 0xDB) out.push(0xDB, 0xDD); else out.push(b); } out.push(0xC0);
    return out;
  }
  static u32(n) { return [n & 0xFF, (n >> 8) & 0xFF, (n >> 16) & 0xFF, (n >>> 24) & 0xFF]; }

  // Flash an application image. Resolves { complete: true } once the stop
  // packet is acked (the bootloader then activates and resets itself).
  async flashApplication(bin, initPacket, progress) {
    const total = bin.length; this.totalSize = total;
    await this.sendPacket([...DfuSerial.u32(DFU_START_PACKET), ...DfuSerial.u32(HEX_TYPE_APPLICATION), ...DfuSerial.u32(0), ...DfuSerial.u32(0), ...DfuSerial.u32(total)]);
    const eraseWait = Math.max(0.5, (Math.floor(total / FLASH_PAGE_SIZE) + 1) * FLASH_PAGE_ERASE_TIME);
    this.log(`DFU: start packet acked, waiting ${eraseWait.toFixed(1)} s for erase`); await sleep(eraseWait * 1000);
    await this.sendPacket([...DfuSerial.u32(DFU_INIT_PACKET), ...initPacket, 0, 0]);
    this.log('DFU: init packet acked (SoftDevice requirement satisfied)', 'ok');
    const frames = Math.ceil(total / DFU_PACKET_MAX_SIZE); let sent = 0;
    try {
      for (let i = 0; i < total; i += DFU_PACKET_MAX_SIZE) {
        await this.sendPacket([...DfuSerial.u32(DFU_DATA_PACKET), ...bin.subarray(i, i + DFU_PACKET_MAX_SIZE)]);
        sent++; progress(Math.floor(sent / frames * 100), `Writing application… ${Math.min(i + DFU_PACKET_MAX_SIZE, total).toLocaleString()} / ${total.toLocaleString()} B`);
        if (sent % 8 === 0) await sleep(FLASH_PAGE_WRITE_TIME * 1000);
      }
      await sleep(FLASH_PAGE_WRITE_TIME * 1000);
      await this.sendPacket(DfuSerial.u32(DFU_STOP_DATA_PACKET));
      this.log('DFU: stop packet acked — bootloader is activating the image', 'ok');
    } catch (e) {
      // The bootloader resets itself once everything is written; losing the
      // device at that point is success, not failure.
      if (sent >= frames && /lost|device/i.test(e.message)) { this.log('DFU: device reset after the last packet — treating as complete', 'ok'); return { complete: true }; }
      throw new Error(`${e.message} after ${sent} of ${frames} packets (${Math.floor(sent / frames * 100)}%). Unplug the board, double‑tap reset and try again.`);
    }
    return { complete: true };
  }
}
