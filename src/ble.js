// Web Bluetooth transport over the Nordic UART Service, for reconfiguring
// a node that is already boxed up. Same interface as SerialTransport.
const NUS = '6e400001-b5a3-f393-e0a9-e50e24dcca9e', NUS_RX = '6e400002-b5a3-f393-e0a9-e50e24dcca9e', NUS_TX = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';

export class BLETransport {
  constructor() { this.onBytes = () => {}; this.onClose = () => {}; this.device = null; this.rx = null; this.name = 'Bluetooth'; }
  static available() { return !!navigator.bluetooth; }
  async open() {
    this.device = await navigator.bluetooth.requestDevice({ filters: [{ services: [NUS] }], optionalServices: [NUS] });
    this.name = 'Bluetooth · ' + (this.device.name || 'RNode');
    this.device.addEventListener('gattserverdisconnected', () => this.onClose());
    const server = await this.device.gatt.connect();
    const svc = await server.getPrimaryService(NUS);
    this.rx = await svc.getCharacteristic(NUS_RX);
    const tx = await svc.getCharacteristic(NUS_TX);
    tx.addEventListener('characteristicvaluechanged', (ev) => { const v = ev.target.value; this.onBytes(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)); });
    await tx.startNotifications();
  }
  async reconnect() {
    if (!this.device) throw new Error('no device');
    const server = await this.device.gatt.connect();
    const svc = await server.getPrimaryService(NUS);
    this.rx = await svc.getCharacteristic(NUS_RX);
    const tx = await svc.getCharacteristic(NUS_TX);
    tx.addEventListener('characteristicvaluechanged', (ev) => { const v = ev.target.value; this.onBytes(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)); });
    await tx.startNotifications();
  }
  async send(bytes) {
    for (let i = 0; i < bytes.length; i += 20) {      // 20-byte writes are safe on every stack
      const chunk = bytes.subarray(i, i + 20);
      if (this.rx.writeValueWithoutResponse) await this.rx.writeValueWithoutResponse(chunk); else await this.rx.writeValue(chunk);
    }
  }
  async close() { try { this.device && this.device.gatt.disconnect(); } catch (_) {} }
}
