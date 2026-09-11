// The two flashing paths. Both take an already-authorised SerialPort that is
// NOT open, and return once the image is written and the device reset.
import { ESPLoader, Transport } from '../lib/esptool-js-0.4.5.js';
import { md5hex } from './md5.js';
import { sleep } from './serial.js';
import { DfuSerial, dfuTouch } from './nrfdfu.js';

export async function flashEsp32({ port, board, files, log, progress }) {
  const fileArray = [];
  for (const [addr, name] of Object.entries(board.esp.files)) {
    const data = files[name];
    if (!data) throw new Error(`${name} is missing from the firmware package`);
    fileArray.push({ address: Number(addr), data: binaryString(data), name });
  }
  fileArray.sort((a, b) => a.address - b.address);
  const transport = new Transport(port, false);
  const loader = new ESPLoader({
    transport, baudrate: 921600, romBaudrate: 115200, debugLogging: false, enableTracing: false,
    terminal: { clean() {}, writeLine: (s) => log('esptool: ' + s, 'dim'), write: (s) => {} },
  });
  try {
    const chip = await loader.main();
    log(`esptool: connected — ${chip}`, 'ok');
    let cur = 0;
    await loader.writeFlash({
      fileArray, flashSize: board.esp.flashSize, flashMode: 'dio', flashFreq: '80m', eraseAll: false, compress: true,
      calculateMD5Hash: (image) => md5hex(latin1(image)),
      reportProgress: (idx, written, total) => {
        if (idx !== cur) { cur = idx; }
        const per = 100 / fileArray.length;
        progress(Math.floor(idx * per + (written / total) * per), `Writing ${fileArray[idx].name} @ 0x${fileArray[idx].address.toString(16)}`);
      },
    });
    log('esptool: all segments written and verified', 'ok');
  } finally {
    try { await transport.setDTR(false); await sleep(100); await transport.setDTR(true); } catch (_) {}
    try { await transport.disconnect(); } catch (_) {}
    try { await port.close(); } catch (_) {}
  }
}

export async function flashNrf52({ bootPort, app, log, progress }) {
  const dfu = new DfuSerial(bootPort, log);
  await dfu.open();
  try { await dfu.flashApplication(app.bin, app.dat, progress); }
  finally { await sleep(300); await Promise.race([dfu.close(), sleep(4000)]); log('DFU: bootloader port released', 'dim'); }
}

// Open+close at 1200 baud: the Adafruit bootloader treats it as "enter serial DFU".
export async function nrfTouch(port) { await dfuTouch(port); }

function binaryString(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return s; }
function latin1(s) { const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 0xFF; return u; }
