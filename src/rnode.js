// KISS framing + the RNode command set + microReticulum Provisioning ops,
// over any transport with send()/onBytes. Modelled on rnodeconf, the RNode
// Console's LegacyClient/ProvisioningClient and the Python client that was
// used to provision the first P1 by hand.
import { pack, unpack } from './msgpack.js';
import { sleep } from './serial.js';

const FEND = 0xC0, FESC = 0xDB, TFEND = 0xDC, TFESC = 0xDD;
export const CMD = {
  FREQUENCY: 0x01, BANDWIDTH: 0x02, TXPOWER: 0x03, SF: 0x04, CR: 0x05, RADIO_STATE: 0x06, DETECT: 0x08,
  STAT_BAT: 0x27, BT_CTRL: 0x46, BOARD: 0x47, PLATFORM: 0x48, MCU: 0x49, FW_VERSION: 0x50, ROM_READ: 0x51,
  ROM_WRITE: 0x52, CONF_SAVE: 0x53, CONF_DELETE: 0x54, RESET: 0x55, FW_HASH: 0x58, UNLOCK_ROM: 0x59,
  HASHES: 0x60, BT_PIN: 0x62, WIFI_MODE: 0x6A, WIFI_SSID: 0x6B, WIFI_PSK: 0x6C, BT_UNPAIR: 0x70,
  LOG: 0x80, PROVISION_REQ: 0x86, PROVISION_RSP: 0x87, ERROR: 0x90,
};
export const ROM = { PRODUCT: 0x00, MODEL: 0x01, HW_REV: 0x02, SERIAL: 0x03, MADE: 0x07, CHKSUM: 0x0B, SIGNATURE: 0x1B, INFO_LOCK: 0x9B, INFO_LOCK_BYTE: 0x73, CONF_OK: 0x9C, CONF_OK_BYTE: 0x73 };
export const OP = { GetSchema: 1, GetInfo: 2, GetCapabilities: 3, GetState: 4, SetState: 5, Commit: 6, Discard: 7, FactoryReset: 8, Reboot: 9, Error: 101 };
// Provisioning namespaces / fields used by the flasher.
export const NS = {
  RNS_GENERAL: 1,           // TransportEnabled 1, RemoteManagementEnabled 3, RemoteManagementAllowed 8 (BytesList)
  RNODE_GENERAL: 100,       // KissLog 1, LoRaMode 2, NomadNetEnabled 4, NomadNetName 5
  METRICS: 103,             // TransportIdentity 1, ProbeDest 2, MgmtDest 3, NomadDest 4
  IFACE_LORA: 105,          // freq 1, bw 2, sf 3, cr 4, txp 5 ...
  METRICS_DEV: 108,         // version 1, batV 2, batP 3, batS 4
};
export const F = { TRANSPORT: 1, RM_ENABLED: 3, RM_ALLOWED: 8, LORA_MODE: 2, NN_ENABLED: 4, NN_NAME: 5 };
export const LORA_MODE = { full: 0x01, ptp: 0x04, ap: 0x08, roaming: 0x10, boundary: 0x20, gateway: 0x40 };
const ERR_NAMES = { 1: 'malformed request', 2: 'unknown op', 3: 'unknown namespace', 4: 'unknown field', 5: 'invalid value', 6: 'constraint', 7: 'read-only', 8: 'storage error', 9: 'not initialised', 99: 'internal' };

export function kissEncode(cmd, payload) {
  const out = [FEND, cmd];
  for (const b of payload) { if (b === FEND) out.push(FESC, TFEND); else if (b === FESC) out.push(FESC, TFESC); else out.push(b); }
  out.push(FEND);
  return new Uint8Array(out);
}

class KissDecoder {
  constructor(onFrame, onRaw = () => {}) { this.onFrame = onFrame; this.onRaw = onRaw; this.buf = null; this.esc = false; this.raw = []; }
  feed(bytes) {
    for (const b of bytes) {
      if (b === FEND) { if (this.buf && this.buf.length) this.onFrame(this.buf[0], Uint8Array.from(this.buf.slice(1))); this.buf = []; this.esc = false; continue; }
      if (!this.buf) {                    // bytes between frames: the firmware's plain-text log
        if (b === 0x0A) { if (this.raw.length) this.onRaw(new TextDecoder().decode(Uint8Array.from(this.raw)).replace(/\r$/, '')); this.raw = []; }
        else if (b >= 0x20 || b === 0x09 || b === 0x0D) { this.raw.push(b); if (this.raw.length > 512) { this.onRaw(new TextDecoder().decode(Uint8Array.from(this.raw))); this.raw = []; } }
        continue;
      }
      if (this.esc) { this.buf.push(b === TFEND ? FEND : b === TFESC ? FESC : b); this.esc = false; }
      else if (b === FESC) this.esc = true;
      else this.buf.push(b);
      if (this.buf.length > 4096) this.buf = null;
    }
  }
}

export class RNode {
  constructor(transport, log = () => {}) {
    this.t = transport; this.log = log;
    this.pending = new Map(); this.listeners = new Map(); this.provWaiters = new Map(); this.seq = 1;
    this.onDeviceText = () => {};
    this.dec = new KissDecoder((c, p) => this._frame(c, p), (line) => this.onDeviceText(line));
    transport.onBytes = (b) => this.dec.feed(b);
  }
  _frame(cmd, payload) {
    if (cmd === CMD.PROVISION_RSP) { this._provResponse(payload); return; }
    if (cmd === CMD.LOG) { this.onDeviceText(new TextDecoder().decode(payload).replace(/\r?\n$/, '')); return; }
    const q = this.pending.get(cmd);
    if (q && q.length) { const w = q.shift(); clearTimeout(w.timer); w.resolve(payload); }
    const l = this.listeners.get(cmd); if (l) for (const fn of l) fn(payload);
  }
  on(cmd, fn) { if (!this.listeners.has(cmd)) this.listeners.set(cmd, new Set()); this.listeners.get(cmd).add(fn); return () => this.listeners.get(cmd).delete(fn); }
  async write(cmd, payload = []) {
    // The firmware's handlers for parameterless commands run per payload
    // byte, so a bare command never fires — always send at least one byte.
    const p = payload.length ? Uint8Array.from(payload) : new Uint8Array([0]);
    await this.t.send(kissEncode(cmd, p));
  }
  query(cmd, payload = [], timeout = 1500) {
    return new Promise((resolve, reject) => {
      const w = { resolve, reject };
      w.timer = setTimeout(() => { const q = this.pending.get(cmd) || []; const i = q.indexOf(w); if (i >= 0) q.splice(i, 1); reject(new Error(`no reply to command 0x${cmd.toString(16)}`)); }, timeout);
      if (!this.pending.has(cmd)) this.pending.set(cmd, []);
      this.pending.get(cmd).push(w);
      this.write(cmd, payload).catch(e => { clearTimeout(w.timer); reject(e); });
    });
  }

  // ---- identity ----
  async detect() { try { const r = await this.query(CMD.DETECT, [0x73], 1500); return r[0] === 0x46; } catch { return false; } }
  async firmwareVersion() { const r = await this.query(CMD.FW_VERSION); return `${r[0]}.${String(r[1]).padStart(2, '0')}`; }
  async board() { return (await this.query(CMD.BOARD, [0]))[0]; }
  async platform() { return (await this.query(CMD.PLATFORM, [0]))[0]; }
  async readRom() { return await this.query(CMD.ROM_READ, [0], 3000); }
  async writeRom(addr, val) { await this.write(CMD.ROM_WRITE, [addr & 0xFF, val & 0xFF]); await sleep(60); }
  async hashes(type) { const r = await this.query(CMD.HASHES, [type], 2000); return r.length >= 33 ? r.slice(1, 33) : null; }
  async setFirmwareHash(hash32) { await this.write(CMD.FW_HASH, hash32); await sleep(150); }
  async reset() { try { await this.write(CMD.RESET, [0xF8]); } catch (_) {} }
  async battery() {
    // [state, percent]; state 0 = discharging/unknown, 1 = charging, 2 = charged
    try { const r = await this.query(CMD.STAT_BAT, [0], 1500); return { state: r[0], percent: r[1] }; } catch { return null; }
  }

  // ---- radio (standalone nodes only; an RNode radio's host owns these) ----
  async setRadio({ freq, bw, sf, cr, txp }) {
    const be32 = (n) => [(n >>> 24) & 0xFF, (n >>> 16) & 0xFF, (n >>> 8) & 0xFF, n & 0xFF];
    await this.write(CMD.FREQUENCY, be32(freq)); await sleep(30);
    await this.write(CMD.BANDWIDTH, be32(bw)); await sleep(30);
    await this.write(CMD.TXPOWER, [txp & 0xFF]); await sleep(30);
    await this.write(CMD.SF, [sf]); await sleep(30);
    await this.write(CMD.CR, [cr]); await sleep(30);
  }
  async radioOn() { await this.write(CMD.RADIO_STATE, [1]); await sleep(600); }
  async readFrequency() { const r = await this.query(CMD.FREQUENCY, [0, 0, 0, 0]); return r[0] * 0x1000000 + ((r[1] << 16) | (r[2] << 8) | r[3]); }
  async saveBootIntoTransport() { await this.write(CMD.CONF_SAVE, [0]); await sleep(400); }
  async clearBootIntoTransport() { await this.write(CMD.CONF_DELETE, [0]); await sleep(400); }

  // ---- bluetooth / wifi ----
  async bluetooth(mode) { await this.write(CMD.BT_CTRL, [mode]); await sleep(100); }      // 0 off, 1 on, 2 pairing
  async wifi({ mode, ssid, psk }) {
    const str = (s) => [...new TextEncoder().encode(String(s || '').slice(0, 32)), 0];
    await this.write(CMD.WIFI_MODE, [mode & 0xFF]); await sleep(60);
    if (mode) { await this.write(CMD.WIFI_SSID, str(ssid)); await sleep(60); await this.write(CMD.WIFI_PSK, str(psk)); await sleep(60); }
  }

  // ---- provisioning (msgpack envelope [op, seq, payload]) ----
  _provResponse(payload) {
    let env; try { env = unpack(payload); } catch (e) { this.log('provisioning: bad msgpack ' + e.message, 'err'); return; }
    if (!Array.isArray(env) || env.length < 2) return;
    const [op, seq] = env; const body = env.length > 2 ? env[2] : null;
    const w = this.provWaiters.get(seq); if (!w) return; this.provWaiters.delete(seq); clearTimeout(w.timer);
    if (op === OP.Error) { const code = body && body[1]; w.reject(new Error(`device refused: ${ERR_NAMES[code] || 'error ' + code}${body && body[2] ? ' — ' + body[2] : ''}`)); }
    else w.resolve(body);
  }
  prov(op, payload, timeout = 8000) {
    const seq = this.seq++;
    const env = payload === undefined ? [op, seq] : [op, seq, payload];
    return new Promise((resolve, reject) => {
      const w = { resolve, reject };
      w.timer = setTimeout(() => { this.provWaiters.delete(seq); reject(new Error('the node did not answer the settings request (is it running microReticulum in transport mode?)')); }, timeout);
      this.provWaiters.set(seq, w);
      this.t.send(kissEncode(CMD.PROVISION_REQ, pack(env))).catch(e => { clearTimeout(w.timer); this.provWaiters.delete(seq); reject(e); });
    });
  }
  async getState(nsIds) { const b = await this.prov(OP.GetState, { 1: nsIds }); return (b && b[1]) || {}; }          // {ns:{fid:val}}
  async setState(state) { const b = await this.prov(OP.SetState, { 3: state }); return { fieldErrors: b && b[3] }; }
  async commit(nsIds) { const b = await this.prov(OP.Commit, { 1: nsIds }, 12000); return { applied: b && b[1], needsReboot: !!(b && b[2]) }; }
  async rebootOp() { try { await this.prov(OP.Reboot, undefined, 1500); } catch (_) { /* it reboots before answering */ } }
  async getInfo(timeout = 4000) { return await this.prov(OP.GetInfo, undefined, timeout); }
}

export const hex = (u8) => Array.from(u8 || [], b => b.toString(16).padStart(2, '0')).join('');
export const fromHex = (s) => Uint8Array.from(s.match(/../g) || [], x => parseInt(x, 16));
export const bytesEqual = (a, b) => !!a && !!b && a.length === b.length && a.every((v, i) => v === b[i]);
