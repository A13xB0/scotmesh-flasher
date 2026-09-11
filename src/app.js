// ScotMesh Flasher — the wizard. State lives in S; each step is a render
// function; device work happens in the action functions below.
import { BOARDS, BAND_LABEL, PLATFORM, boardById, boardsFor } from './boards.js';
import { PROFILES, profileFor, describe } from './profiles.js';
import { SerialTransport, requestPort, waitForPort, portInfo, infoLabel, sleep } from './serial.js';
import { RNode, ROM, NS, F, LORA_MODE, hex, fromHex, bytesEqual } from './rnode.js';
import { BLETransport } from './ble.js';
import { loadIndex, download, sha256hex, sha256, unzip, espImageHash, nrfApplication } from './firmware.js';
import { flashEsp32, flashNrf52, nrfTouch } from './flash.js';
import { md5bytes } from './md5.js';

const STEPS = ['Start', 'Hardware', 'Firmware', 'Connect', 'Flash', 'Provision', 'Configure', 'Done'];
const FAMILY_FOR = { rnode: 'rnode', node: 'microreticulum', reconfig: 'microreticulum' };

const S = {
  step: 0, path: null, board: null, band: null, filter: 'all',
  index: null, indexError: null, fw: null,          // fw = { tag, asset, size, sha256 }
  pkg: null,                                        // { bytes, files, hash (Uint8Array), hashKind }
  busy: false, error: null, progress: { pct: 0, text: '' }, checklist: [],
  transport: null, rnode: null, portLabel: null, portObj: null, needsPicker: null,
  flashed: false, provisioned: false, provInfo: null,
  cfg: { profile: 'sm868', custom: { freq: 867.5, bw: 125, sf: 9, cr: 5, txp: 22 }, name: '', mode: 'full', transport: true, ids: [], ble: true, wifi: false, ssid: '', psk: '' },
  result: null, btPin: null,
};
try { const saved = JSON.parse(localStorage.getItem('scotmesh.flasher.v1') || 'null'); if (saved && saved.cfg) { Object.assign(S.cfg, saved.cfg); } } catch (_) {}
function persist() { try { localStorage.setItem('scotmesh.flasher.v1', JSON.stringify({ cfg: S.cfg })); } catch (_) {} }

// ---------- helpers ----------
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const board = () => boardById(S.board);
const family = () => FAMILY_FOR[S.path];
const nodeish = () => S.path !== 'rnode';
const fmtKB = (n) => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB';
export function log(msg, cls = '') {
  const t = new Date().toTimeString().slice(0, 8);
  const pre = $('#log');
  pre.insertAdjacentHTML('beforeend', `<span class="t">${t}</span> <span class="${cls}">${esc(msg)}</span>\n`);
  pre.scrollTop = pre.scrollHeight;
  $('#loglast').textContent = msg;
  if (cls === 'err') console.error(msg); else console.log(msg);
}
window.toggleDrawer = () => { const d = $('#drawer'); d.classList.toggle('open'); $('#logtoggle').textContent = d.classList.contains('open') ? '▼ hide' : '▲ show'; };
function go(n) { S.step = n; S.error = null; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
function fail(e) { S.busy = false; S.error = (e && e.message) || String(e); log(S.error, 'err'); render(); }
function setProgress(pct, text) { S.progress = { pct, text }; const bar = $('#pbar'), pt = $('#ptext'), pp = $('#ppct'); if (bar) bar.style.width = pct + '%'; if (pt) pt.textContent = text || ''; if (pp) pp.textContent = Math.round(pct) + '%'; }
function check(i, state, detail) { if (S.checklist[i]) { S.checklist[i].state = state; if (detail != null) S.checklist[i].detail = detail; } const li = document.querySelectorAll('#checklist li')[i]; if (!li) return; li.className = state; li.querySelector('.st').textContent = state === 'ok' ? '✓' : state === 'err' ? '!' : ''; if (detail != null) li.querySelector('.det').textContent = detail; }
const skipped = (i) => S.path === 'reconfig' && [1, 2, 4, 5].includes(i);
const copyTxt = (txt, btn) => { try { navigator.clipboard.writeText(txt); } catch (_) {} const o = btn.textContent; btn.textContent = 'Copied'; setTimeout(() => btn.textContent = o, 1200); };
window.copyTxt = copyTxt;

// ---------- rail ----------
function renderRail() {
  const ol = $('#rail'); ol.innerHTML = '';
  STEPS.forEach((name, i) => {
    const li = document.createElement('li');
    li.className = i === S.step ? 'cur' : i < S.step ? 'done' : '';
    if (skipped(i)) li.classList.add('skip');
    li.innerHTML = `<span class="n">${i < S.step && !skipped(i) ? '✓' : i + 1}</span>${name}`;
    if (i < S.step && !skipped(i) && !S.busy && i <= 3) { li.style.cursor = 'pointer'; li.onclick = () => go(i); }
    ol.appendChild(li);
  });
  const f = $('#railfoot');
  if (!S.path) { f.textContent = 'Nothing chosen yet.'; return; }
  const b = board();
  f.innerHTML = `<b>${S.path === 'rnode' ? 'RNode radio' : S.path === 'node' ? 'Standalone node' : 'Reconfigure'}</b>
    <div class="kv"><span>Board</span><span>${b ? esc(b.name) : '—'}</span><span>Band</span><span>${S.band ? S.band + ' MHz' : '—'}</span><span>Firmware</span><span>${S.fw ? esc(S.fw.tag) : '—'}</span><span>Port</span><span>${S.portLabel ? esc(S.portLabel) : '—'}</span></div>`;
}

function glyph(b) {
  const nrf = b.platform === PLATFORM.NRF52;
  return `<svg viewBox="0 0 120 72" fill="none" aria-hidden="true"><rect x="8" y="10" width="86" height="52" rx="6" fill="${nrf ? '#1d4ed8' : '#334155'}"/><rect x="18" y="20" width="30" height="22" rx="3" fill="#0f172a" opacity=".85"/><text x="33" y="34" font-size="7" fill="#d1d5db" text-anchor="middle" font-family="ui-monospace,monospace">${nrf ? 'nRF52' : 'ESP32'}</text><rect x="56" y="20" width="26" height="16" rx="2" fill="#0f172a" opacity=".6"/><text x="69" y="31" font-size="6" fill="#d1d5db" text-anchor="middle" font-family="ui-monospace,monospace">${esc(b.radio.split(' ')[0])}</text><rect x="18" y="48" width="64" height="6" rx="2" fill="#0f172a" opacity=".35"/><rect x="94" y="30" width="20" height="4" rx="2" fill="#9ca3af"/><rect x="110" y="12" width="4" height="40" rx="2" fill="#9ca3af"/>${b.ours ? '<rect x="8" y="2" width="86" height="6" rx="2" fill="#f59e0b" opacity=".8"/>' : ''}</svg>`;
}
function hood(items) { return `<details class="hood"><summary>Under the hood</summary><ul>${items.map(i => `<li>${i}</li>`).join('')}</ul></details>`; }
function errorBox() { return S.error ? `<div class="errbox"><b>Something went wrong.</b> ${esc(S.error)} <span class="small">The log at the bottom has the details.</span></div>` : ''; }
function progressBox(title) {
  return `<div class="fwrow" style="grid-template-columns:1fr"><div><div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap"><div class="name">${title}</div><span class="spacer"></span><span id="ppill">${S.busy ? '<span class="pill info live"><span class="dot"></span>Working</span>' : ''}</span></div>
    <div class="prog" id="pwrap"><i id="pbar" style="width:${S.progress.pct}%"></i></div><div class="progtxt"><span id="ptext">${esc(S.progress.text)}</span><span id="ppct">${S.progress.pct ? Math.round(S.progress.pct) + '%' : ''}</span></div>
    <ul class="checklist" id="checklist">${S.checklist.map(c => `<li class="${c.state}"><span class="st">${c.state === 'ok' ? '✓' : c.state === 'err' ? '!' : ''}</span><span>${esc(c.text)}</span><span class="det">${esc(c.detail || '')}</span></li>`).join('')}</ul></div></div>`;
}
const supported = () => !!navigator.serial;

// ---------- steps ----------
const V = {};
V[0] = () => `
  <section class="card">
    <div class="eyebrow">Step 1 · What are you building?</div>
    <h1>Flash and set up a Reticulum radio in your browser.</h1>
    <p class="lead">Pick what you want the device to do. We fetch the right firmware, flash it, provision it and walk you through the handful of settings that matter. No command line.</p>
    ${supported() ? '' : `<div class="errbox"><b>This browser cannot talk to USB devices.</b> Use Chrome or Edge on a desktop or laptop — Firefox, Safari and phones do not support WebSerial.</div>`}
    <div class="choices">
      <button class="choice" onclick="app.choose('rnode')"><span class="ico">📻</span><h3>RNode radio</h3><p>A LoRa radio you plug into a computer or pair with a phone. Sideband, MeshChatX and NomadNet talk to it over USB or Bluetooth and set its radio parameters.</p><span class="who">For laptops, phones, desktops</span></button>
      <button class="choice" onclick="app.choose('node')"><span class="ico">📡</span><h3>Standalone node</h3><p>A self-contained Reticulum transport node with its own identity — solar boxes, hilltop relays, a spare board on a windowsill. Runs microReticulum, no Raspberry Pi needed.</p><span class="who">For relays and remote sites</span></button>
      <button class="choice thin" onclick="app.choose('reconfig')"><span class="ico">✏️</span><span><h3>Reconfigure an existing node</h3><p>Skip flashing. Connect over USB or Bluetooth to change settings, add a remote-management identity, or check the battery.</p></span></button>
    </div>
    <div class="reqs"><span>🖥 Desktop Chrome or Edge</span><span>🔌 USB data cable</span><span>⏱ About four minutes</span></div>
    ${hood(['Nothing talks to the device yet. The choice sets the firmware family (<code>rnode</code> → markqvist releases, <code>node</code> → the ScotMesh microReticulum build) and which boards and settings appear later.', 'Firmware is served from this site’s <code>/firmware/</code> mirror because GitHub release downloads have no CORS headers.'])}
  </section>`;

V[1] = () => {
  const list = boardsFor(S.path).filter(b => S.filter === 'all' || (S.filter === 'nrf' ? b.platform === PLATFORM.NRF52 : b.platform === PLATFORM.ESP32));
  const b = board();
  return `
  <section class="card">
    <div class="eyebrow">Step 2 · Your hardware</div>
    <h2>Which board is on your desk?</h2>
    <p class="lead">${S.path === 'rnode' ? 'Boards supported by the RNode firmware.' : 'Boards that can run microReticulum as a standalone node.'} Boards marked <b>double‑tap</b> may need the reset button pressed twice if the automatic bootloader trick fails.</p>
    <div class="filters">${['all', 'esp', 'nrf'].map(f => `<button class="chip ${S.filter === f ? 'on' : ''}" onclick="app.set('filter','${f}')">${{ all: 'All boards', esp: 'ESP32', nrf: 'nRF52840' }[f]}</button>`).join('')}</div>
    <div class="boards">${list.map(x => `
      <button class="board ${S.board === x.id ? 'sel' : ''}" onclick="app.pickBoard('${x.id}')">
        <span class="pic">${glyph(x)}${x.doubleTap ? '<span class="tag tap">double‑tap</span>' : ''}${x.ours ? '<span class="tag ours">🏴󠁧󠁢󠁳󠁣󠁴󠁿 Built by ScotMesh</span>' : ''}</span>
        <h3>${esc(x.name)}</h3><span class="vendor">${esc(x.vendor)}${x.note ? ' · ' + esc(x.note) : ''}</span>
        <span class="meta"><span>${esc(x.mcu)}</span><span>${esc(x.radio)}</span>${Object.keys(x.models).map(k => `<span class="band">${k}</span>`).join('')}</span>
      </button>`).join('')}</div>
    ${b && Object.keys(b.models).length > 1 ? `<div class="section"><h3>Which radio band is it?</h3><p class="hint">The model code written to the board tells software which frequencies are allowed. Check the module’s label if unsure.</p>
      <div class="profiles" style="max-width:520px">${Object.keys(b.models).map(k => `<button class="profile ${S.band === k ? 'sel' : ''}" onclick="app.set('band','${k}')"><b>${BAND_LABEL[k]}</b><span class="rf">model 0x${b.models[k].toString(16).toUpperCase()}</span></button>`).join('')}</div></div>` : ''}
    ${hood(['The catalogue is <code>src/boards.js</code>: MCU, USB IDs, EEPROM product/model codes per band, ESP32 flash offsets, max TX power and the release asset name per firmware family.', 'Nothing is written yet.'])}
    <div class="actions"><button class="btn" onclick="app.go(0)">Back</button><span class="spacer"></span><button class="btn primary big" ${S.board && S.band ? '' : 'disabled'} onclick="app.go(2)">Continue</button></div>
  </section>`;
};

V[2] = () => {
  const b = board(); const fam = S.index && S.index.families[family()];
  const versions = fam ? Object.entries(fam.versions).filter(([, v]) => v.assets[b.families[family()]]).sort((x, y) => (y[1].date || '').localeCompare(x[1].date || '')) : [];
  const cur = S.fw && versions.find(([t]) => t === S.fw.tag);
  const asset = b.families[family()];
  return `
  <section class="card">
    <div class="eyebrow">Step 3 · Firmware</div>
    <h2>Latest firmware, fetched for you.</h2>
    <p class="lead">${fam ? esc(fam.label) + ' — built on GitHub from <code>' + esc(fam.repo) + '</code> and mirrored here, so the download works straight from the browser. The checksum is verified before anything is flashed.' : 'Loading the firmware index…'}</p>
    ${b.ours ? `<div class="ours-note"><span class="lbl">🏴󠁧󠁢󠁳󠁣󠁴󠁿 Built by ScotMesh</span><span>The ${esc(b.name)} is not in the official microReticulum firmware. This build is maintained by ScotMesh (<a href="https://github.com/A13xB0/microReticulum_Firmware" target="_blank" rel="noopener">A13xB0/microReticulum_Firmware</a>) — report problems to us, not upstream.</span></div>` : ''}
    ${S.indexError ? `<div class="errbox"><b>The firmware index could not be loaded.</b> ${esc(S.indexError)}</div>` : ''}
    ${!versions.length && fam ? `<div class="errbox"><b>No ${esc(fam.label)} image for the ${esc(b.name)} has been published yet.</b> The mirror checks GitHub every hour.</div>` : ''}
    <div class="fwrow"><div>
      <div class="name">${fam ? esc(fam.label) : ''}${b.ours ? ' <span class="pill info" style="vertical-align:middle">ScotMesh variant</span>' : ''}</div>
      <div class="sub">${esc(b.name)} · <span class="mono">${esc(asset)}</span></div>
      <dl class="kvs">
        <dt>Version</dt><dd><select style="max-width:340px" onchange="app.pickVersion(this.value)" ${S.busy ? 'disabled' : ''}>${versions.map(([t, v]) => `<option value="${esc(t)}" ${S.fw && S.fw.tag === t ? 'selected' : ''}>${esc(t)}${t === fam.latest ? '  ·  latest' : ''}${v.prerelease ? '  ·  pre-release' : ''}  —  ${(v.date || '').slice(0, 10)}</option>`).join('')}</select></dd>
        <dt>Size</dt><dd class="mono">${S.fw ? fmtKB(S.fw.size) : '—'}</dd>
        <dt>SHA‑256</dt><dd class="mono" style="color:var(--muted)">${S.fw ? S.fw.sha256.slice(0, 16) + '…' : '—'}</dd>
        <dt>Requires</dt><dd>${b.platform === PLATFORM.NRF52 ? 'the board’s bootloader (SoftDevice is checked before writing)' : 'esptool over WebSerial'}</dd>
      </dl></div>
      <div style="min-width:230px">
        ${S.pkg ? `<span class="pill good"><span class="dot"></span>Downloaded &amp; verified</span>` : `<button class="btn primary" onclick="app.downloadFw()" ${S.fw && !S.busy ? '' : 'disabled'}>Download to browser</button>`}
        <div class="prog ${S.pkg ? 'good' : ''}"><i id="pbar" style="width:${S.progress.pct}%"></i></div>
        <div class="progtxt"><span id="ptext">${esc(S.progress.text || (S.pkg ? 'sha256 OK' : 'Not downloaded'))}</span><span id="ppct"></span></div>
        <p class="small" style="margin-top:10px">${cur ? `<a href="${esc(cur[1].url)}" target="_blank" rel="noopener">Release notes</a> · ` : ''}${S.fw ? `<a href="firmware/${family()}/${encodeURIComponent(S.fw.tag)}/${esc(asset)}" download>Download the zip instead</a>` : ''}</p>
      </div></div>
    ${errorBox()}
    ${hood([`<code>GET /firmware/index.json</code> lists families, versions and per-asset size + sha256 (written hourly by the mirror on this server).`, `<code>GET /firmware/${family()}/&lt;tag&gt;/${esc(asset)}</code> streams the zip with progress; it is hashed with WebCrypto and compared to the index, then unpacked in memory (zip.js).`, b.platform === PLATFORM.NRF52 ? 'The DFU package’s <code>manifest.json</code> and init packet are parsed now, so a SoftDevice mismatch is reported before anything is written.' : 'The zip’s bootloader, partition table, boot_app0, application and <code>console_image.bin</code> are mapped to the board’s flash offsets.'])}
    <div class="actions"><button class="btn" onclick="app.go(1)" ${S.busy ? 'disabled' : ''}>Back</button><span class="spacer"></span><button class="btn primary big" ${S.pkg ? '' : 'disabled'} onclick="app.go(3)">Continue</button></div>
  </section>`;
};

V[3] = () => {
  const b = board(); const nrf = !!b && b.platform === PLATFORM.NRF52; const rc = S.path === 'reconfig';
  return `
  <section class="card">
    <div class="eyebrow">Step 4 · Connect</div>
    <h2>${rc ? 'Connect to the node.' : 'Plug the board in.'}</h2>
    <p class="lead">${rc ? 'Over USB, or over Bluetooth if the node is already boxed up outside.' : 'Use a cable that carries data. When you press the button the browser asks which port to use — pick the one that appears when you plug the board in.'}</p>
    ${rc ? '' : `<div class="steps-inline">
      <div class="stepbox"><div class="n">1</div><h3>Plug in over USB</h3><p>Any port on this computer. Unplug other serial devices if you are unsure which is which.</p></div>
      <div class="stepbox"><div class="n">2</div><h3>Choose the port</h3><p>${nrf ? 'Look for <b>' + esc(b.name) + '</b> or a “USB Serial Device”.' : 'Look for “USB JTAG/serial debug unit” or “CP210x”.'}</p></div>
      <div class="stepbox"><div class="n">3</div><h3>${nrf ? 'We enter the bootloader for you' : 'We reset it into download mode'}</h3><p>${nrf ? 'The board disconnects and reappears as its bootloader. It is a different USB device, so the first time the browser asks you to pick it once more (remembered after that). Shortcut: double‑tap reset first and pick the bootloader device straight away.' : 'Hold BOOT while plugging in if it does not respond.'}</p></div></div>`}
    <div id="connbox">
      ${S.portLabel ? `<div class="devline"><span class="ico">✓</span><span><b>${esc(S.portLabel)}</b><small>${esc(S.portSub || '')}</small></span><span class="spacer"></span><span class="pill good"><span class="dot"></span>Connected</span></div>`
        : S.needsPicker ? `<div class="devline"><span class="ico">…</span><span><b>${esc(S.needsPicker.title)}</b><small>${esc(S.needsPicker.text)}</small></span><span class="spacer"></span><button class="btn primary" onclick="app.pickAgain()">${esc(S.needsPicker.button)}</button></div>`
        : `<div class="actions" style="border:0;padding-top:0;margin-top:22px"><button class="btn primary big" onclick="app.connect(false)" ${S.busy || !supported() ? 'disabled' : ''}>${rc ? 'Connect over USB' : 'Choose port and connect'}</button>${rc ? `<button class="btn big" onclick="app.connect(true)" ${S.busy || !BLETransport.available() ? 'disabled' : ''}>Connect over Bluetooth</button>` : ''}<span id="connstat" class="small">${S.busy ? '<span class="spin"></span>&nbsp; ' + esc(S.progress.text) : ''}</span></div>`}
    </div>
    ${nrf && !rc ? `<div class="fallback"><b>Board didn’t reappear?</b> Press the reset button twice quickly${b.resetHint ? ' — ' + esc(b.resetHint) : ''}. Then press the button above again and pick the bootloader device.</div>` : ''}
    ${errorBox()}
    ${hood(rc ? ['<code>navigator.serial.requestPort()</code> or <code>navigator.bluetooth.requestDevice</code> (Nordic UART service).', 'A KISS <code>CMD_DETECT</code> / <code>CMD_FW_VERSION</code> / <code>CMD_BOARD</code> handshake confirms it is an RNode-family device.']
      : nrf ? [`<code>navigator.serial.requestPort()</code> filtered to vendor <code>${infoLabel(b.usb.app).slice(0, 4)}</code>.`, 'The port is opened at <b>1200 baud</b> and closed — the Adafruit bootloader treats that as “enter serial DFU” and re-enumerates as the bootloader device.', 'If the bootloader was authorised before, it is picked up automatically; otherwise you are asked to select it (browser permission is per USB device).']
      : ['<code>navigator.serial.requestPort()</code>; esptool-js toggles DTR/RTS to reset into the ROM download mode and reads the chip ID and flash size.'])}
    <div class="actions"><button class="btn" onclick="app.go(${rc ? 0 : 2})" ${S.busy ? 'disabled' : ''}>Back</button><span class="spacer"></span><button class="btn primary big" ${S.portLabel && !S.busy ? '' : 'disabled'} onclick="app.go(${rc ? 6 : 4})">Continue</button></div>
  </section>`;
};

V[4] = () => {
  const b = board();
  return `
  <section class="card">
    <div class="eyebrow">Step 5 · Flash</div>
    <h2>${S.flashed ? 'Firmware written.' : 'Ready to write the firmware.'}</h2>
    <p class="lead">Leave the cable in and don’t touch the board until this finishes. ${b.platform === PLATFORM.NRF52 ? 'About a minute.' : 'About a minute and a half.'}</p>
    ${progressBox(esc(S.fw.asset) + ' · ' + esc(S.fw.tag))}
    ${errorBox()}
    ${hood(b.platform === PLATFORM.NRF52 ? ['Uses <code>nrf52_dfu_flasher.js</code> (liamcottle) — a WebSerial port of <code>adafruit-nrfutil dfu serial</code>: SLIP-framed HCI packets, the init packet from the zip, 512-byte data packets.', 'The bootloader activates the image and resets; the page then waits for the application USB device and sends <code>CMD_FW_VERSION</code>.'] : ['<code>esptool-js 0.4.5</code>: connect → detect chip → <code>writeFlash</code> for each segment at the catalogue offset, MD5-verified, then a DTR reset.', 'Then the same <code>CMD_FW_VERSION</code> handshake as nRF52.'])}
    <div class="actions"><button class="btn" onclick="app.go(3)" ${S.busy || S.flashed ? 'disabled' : ''}>Back</button><span class="spacer"></span>${S.flashed ? `<button class="btn primary big" onclick="app.go(5)">Continue</button>` : `<button class="btn primary big" onclick="app.flash()" ${S.busy ? 'disabled' : ''}>${S.error ? 'Try again' : 'Flash now'}</button>`}</div>
  </section>`;
};

V[5] = () => `
  <section class="card">
    <div class="eyebrow">Step 6 · Provision</div>
    <h2>${S.provisioned ? 'Provisioned and verified.' : 'Making the board an RNode.'}</h2>
    <p class="lead">The firmware only trusts itself once the board carries a valid identity block and a matching firmware hash. This is what <code>rnodeconf --autoinstall</code> does, without the terminal.</p>
    ${progressBox('EEPROM identity + firmware hash')}
    ${errorBox()}
    ${S.error && S.provFallback ? `<div class="fallback"><b>Hash mismatch.</b> The image hash we computed differs from what the device reports. You can store the device-reported hash instead — the node will boot, but the “firmware verified” guarantee is only as good as the device’s own reading. <button class="btn" onclick="app.provision(true)">Use the device’s hash</button></div>` : ''}
    ${hood(['<code>CMD_ROM_READ</code>; if the info-lock byte isn’t <code>0x73</code> we write product, model, hw rev 1, a random serial, today’s date, the MD5 checksum of those 11 bytes, a 128-byte RSA‑PSS signature from a throwaway key (cosmetic — the firmware only checks the checksum) and <code>INFO_LOCK</code> via <code>CMD_ROM_WRITE</code>.', 'Firmware hash: nRF52 = SHA‑256 of the DFU package’s <code>.bin</code>; ESP32 = the ESP image digest. Written with <code>CMD_FW_HASH</code>, then <code>CMD_HASHES</code> 0x01/0x02 must agree.'])}
    <div class="actions"><button class="btn" onclick="app.go(4)" disabled>Back</button><span class="spacer"></span>${S.provisioned ? `<button class="btn primary big" onclick="app.go(6)">Continue</button>` : `<button class="btn primary big" onclick="app.provision(false)" ${S.busy ? 'disabled' : ''}>${S.error ? 'Try again' : 'Provision'}</button>`}</div>
  </section>`;

V[6] = () => {
  const b = board(); const c = S.cfg; const n = nodeish();
  const p = PROFILES.find(x => x.id === c.profile) || PROFILES[0];
  const bandMismatch = p.band && S.band && p.band !== S.band;
  return `
  <section class="card">
    <div class="eyebrow">Step 7 · Configure</div>
    <h2>${n ? 'Set up the node.' : 'Set up the radio.'}</h2>
    <p class="lead">${n ? 'Only the things you actually have to decide. Everything else keeps sensible defaults and can be changed later in the Console.' : 'There is very little to do here. An RNode radio has no frequency, bandwidth or power of its own — the app you plug it into sets those every time it connects.'}</p>
    ${n ? '' : `<div class="ours-note" style="background:var(--surface2)"><span class="lbl" style="background:var(--muted)">Not here</span><span><b>Frequency, bandwidth, spreading factor and TX power</b> are chosen in Sideband, MeshChatX or your Reticulum config when you add the RNode interface. The ScotMesh values to enter are shown on the next screen.</span></div>`}
    ${n ? `
    <div class="section"><h3>Radio profile</h3><p class="hint">Every ScotMesh node on the same band must use the same profile or they cannot hear each other.</p>
      <div class="profiles">${PROFILES.map(x => `<button class="profile ${c.profile === x.id ? 'sel' : ''}" onclick="app.cfg('profile','${x.id}')"><b>${x.name}</b><span class="rf">${x.id === 'custom' ? 'you choose' : describe({ ...x, txp: Math.min(x.txp, b.maxTxDbm) })}</span><span class="why">${x.why}</span></button>`).join('')}</div>
      ${c.profile === 'custom' ? `<div class="grid2" style="margin-top:12px">${[['freq', 'Frequency (MHz)'], ['bw', 'Bandwidth (kHz)'], ['sf', 'Spreading factor (7–12)'], ['cr', 'Coding rate (4/5 … 4/8 → 5–8)'], ['txp', 'TX power (dBm, max ' + b.maxTxDbm + ')']].map(([k, l]) => `<div class="field"><label>${l}</label><input type="text" inputmode="decimal" value="${esc(c.custom[k])}" oninput="app.cfgCustom('${k}',this.value)"></div>`).join('')}</div>` : ''}
      ${bandMismatch ? `<p class="err" style="margin-top:10px">This is a ${S.band} MHz board — the ${p.name} profile is outside its range. Pick the other profile or Custom.</p>` : ''}
    </div>
    <div class="section"><h3>Node</h3>
      <div class="field"><label>Node name</label><input type="text" maxlength="32" value="${esc(c.name)}" oninput="app.cfg('name',this.value,true)" style="max-width:420px" placeholder="e.g. Ben Lomond relay"><p class="help">Shown as the NomadNet page title and in announces. Up to 32 characters.</p></div>
    </div>
    <div class="section"><h3>What is this node for?</h3><p class="hint">This decides how other nodes route through it. Pick the one that matches where it will live — you can change it later.</p>
      <div class="roles">
        <button class="role ${c.transport && c.mode === 'full' ? 'sel' : ''}" onclick="app.role('full')"><b>Fixed relay <small>FULL</small></b><p>Forwards traffic between everyone it can hear and advertises paths through itself. The normal choice.</p><span class="use">hilltops, rooftops, solar boxes, a spare board on a windowsill</span></button>
        <button class="role ${c.transport && c.mode === 'ap' ? 'sel' : ''}" onclick="app.role('ap')"><b>Access point <small>ACCESS_POINT</small></b><p>Gives your own devices a way onto the mesh but will not carry traffic between other relays.</p><span class="use">a node whose only job is to connect your house or shed</span></button>
        <button class="role ${c.transport && c.mode === 'roaming' ? 'sel' : ''}" onclick="app.role('roaming')"><b>Mobile <small>ROAMING</small></b><p>Moves around. Others only route through it as a last resort, so paths don’t break when it leaves.</p><span class="use">vehicles, backpacks, event kits</span></button>
        <button class="role ${!c.transport ? 'sel' : ''}" onclick="app.role('leaf')"><b>End device only <small>TRANSPORT OFF</small></b><p>Talks to the mesh but never forwards anything for anyone else.</p><span class="use">a sensor node, or a board you are just testing with</span></button>
      </div>
    </div>
    <div class="section"><h3>Remote management <span class="pill info">recommended</span></h3>
      <p class="hint">Identities allowed to manage this node over the mesh with <code>rnstatus -R</code> / <code>rnpath -R</code>. Paste your identity hash from Sideband (Settings → Identity) or <code>rnid</code>.</p>
      <div class="idlist">${c.ids.map((id, i) => `<div class="idrow ok">${esc(id)}<button class="x" aria-label="Remove" onclick="app.removeId(${i})">×</button></div>`).join('')}${c.ids.length ? '' : '<p class="small" style="color:var(--warn)">Nobody can manage this node remotely yet.</p>'}</div>
      <div class="addrow"><input type="text" id="idin" placeholder="32 hex characters, e.g. 178c1f39…" oninput="this.nextElementSibling.disabled=!/^[0-9a-f]{32}$/i.test(this.value.trim())"><button class="btn" disabled onclick="app.addId()">Add</button></div>
    </div>` : ''}
    <div class="section"><h3>Connectivity</h3>
      ${b.hasBle ? `<div class="toggle"><span><b>Bluetooth</b><small>${n ? 'Lets you reconfigure the node from a phone or this page later.' : 'Pair with Sideband on a phone. The PIN appears below while the phone is pairing.'}</small></span><button class="sw ${c.ble ? 'on' : ''}" aria-label="Bluetooth" onclick="app.cfg('ble',${!c.ble})"></button></div>` : '<p class="small">This board has no Bluetooth.</p>'}
      ${b.hasBle && c.ble && !n && S.portLabel ? `<div class="pin" id="pin">${S.btPin != null ? String(S.btPin).padStart(6, '0').split('').join(' ') : '— — — — — —'}</div><p class="help small" style="margin-top:6px"><a href="#" onclick="app.pairing();return false">Start pairing now</a> — the PIN shows here when the phone asks for it.</p>` : ''}
      ${n && b.hasWifi ? `<div class="toggle"><span><b>Wi‑Fi</b><small>Join a network so the node can also reach the backbone over TCP (ESP32 boards).</small></span><button class="sw ${c.wifi ? 'on' : ''}" aria-label="WiFi" onclick="app.cfg('wifi',${!c.wifi})"></button></div>
        ${c.wifi ? `<div class="grid2"><div class="field"><label>Network name</label><input type="text" maxlength="32" value="${esc(c.ssid)}" oninput="app.cfg('ssid',this.value,true)"></div><div class="field"><label>Password</label><input type="password" maxlength="32" value="${esc(c.psk)}" oninput="app.cfg('psk',this.value,true)"></div></div>` : ''}` : ''}
    </div>
    ${S.busy ? progressBox('Applying') : ''}
    ${errorBox()}
    ${hood(n ? ['Radio: <code>CMD_FREQUENCY/BANDWIDTH/TXPOWER/SF/CR</code>, radio on, then <code>CMD_CONF_SAVE</code> — the node boots straight into transport mode from now on (rnodeconf calls this TNC mode).', 'After that reboot the node’s settings go through the Provisioning protocol (<code>CMD_PROVISION_REQ</code>, MsgPack): <code>SetState</code> on the RNS General namespace (transport, remote management, allow-list) and RNode General (NomadNet name, interface mode) → <code>Commit</code> → <code>Reboot</code>.', 'Bluetooth: <code>CMD_BT_CTRL</code>. Wi‑Fi: <code>CMD_WIFI_MODE/SSID/PSK</code> (write-only).'] : ['<code>CMD_BT_CTRL</code> 0x01 turns Bluetooth on (0x02 starts pairing; the device reports the PIN in a <code>CMD_BT_PIN</code> frame).', 'No radio parameters are written: for an RNode radio the connected app owns them.'])}
    <div class="actions"><button class="btn" onclick="app.go(${S.path === 'reconfig' ? 3 : 5})" ${S.busy ? 'disabled' : ''}>Back</button><span class="spacer"></span><button class="btn primary big" onclick="app.apply()" ${S.busy || bandMismatch ? 'disabled' : ''}>${n ? 'Apply and restart node' : 'Save'}</button></div>
  </section>`;
};

V[7] = () => {
  const b = board(); const n = nodeish(); const r = S.result || {};
  const row = (k, v, copy) => `<div class="row"><span class="k">${k}</span><span class="v">${v}</span>${copy ? `<button class="copy" onclick="copyTxt('${esc(copy)}',this)">Copy</button>` : '<span></span>'}</div>`;
  const bat = r.battery ? `<span class="bat"><span class="bar"><i style="width:${Math.max(0, Math.min(100, r.battery.percent))}%"></i></span>${r.battery.volts ? r.battery.volts.toFixed(2) + ' V · ' : ''}${r.battery.percent}% · ${{ 0: 'discharging', 1: 'charging', 2: 'charged' }[r.battery.state] || 'unknown'}</span>` : null;
  const profs = PROFILES.filter(x => x.id !== 'custom' && (!S.band || x.band === S.band));
  return `
  <section class="card">
    <div class="eyebrow">Step 8 · Done</div>
    <div class="hero-ok"><span class="big">✓</span><div><h2>${n ? 'Your node is on the mesh.' : 'Your RNode is ready.'}</h2><p class="lead" style="margin-top:2px">${n ? 'It is running in transport mode. Everything below was read back from the device just now.' : 'Plug it into Sideband, MeshChatX or NomadNet and add an RNode interface.'}</p></div></div>
    <div class="summary">
      ${row('Board', esc(b.name) + (S.band ? ' · ' + S.band + ' MHz' : ''))}
      ${row('Firmware', esc(r.fwVersion || (S.fw && S.fw.tag) || '') + ' · ' + (n ? (b.ours ? 'microReticulum · <b>ScotMesh variant</b>' : 'microReticulum') : 'RNode') + (r.hashOk ? ' · hash verified' : ''))}
      ${n && r.radio ? row('Radio', esc(describe(r.radio))) : ''}
      ${n ? row('Node name', esc(S.cfg.name || '(none)')) : ''}
      ${n ? row('Role', S.cfg.transport ? ({ full: 'Fixed relay (FULL)', ap: 'Access point (ACCESS_POINT)', roaming: 'Mobile (ROAMING)' }[S.cfg.mode]) : 'End device only (transport off)') : ''}
      ${n && r.transportId ? row('Transport identity', esc(r.transportId), r.transportId) : ''}
      ${n && r.mgmtDest ? row('Management destination', esc(r.mgmtDest), r.mgmtDest) : ''}
      ${n && r.nomadDest ? row('NomadNet page', esc(r.nomadDest), r.nomadDest) : ''}
      ${n ? row('Managed by', S.cfg.ids.length ? S.cfg.ids.map(esc).join('<br>') : '<span style="color:var(--warn)">nobody — add an identity in Configure</span>') : ''}
      ${bat ? `<div class="row"><span class="k">Battery</span><span class="v">${bat}</span><span></span></div>` : ''}
      ${b.hasBle ? row('Bluetooth', S.cfg.ble ? 'On' : 'Off') : ''}
    </div>
    ${n ? '' : `<div class="section"><h3>Enter these in your app</h3><p class="hint">The radio itself stores no RF settings. When you add the RNode interface in Sideband, MeshChatX or your Reticulum config, use the ScotMesh profile for its band.</p>
      <div class="profiles" style="max-width:560px">${profs.map(x => `<div class="profile sel"><b>${x.name}</b><span class="rf">${describe({ ...x, txp: Math.min(x.txp, b.maxTxDbm) })}</span><span class="why">frequency ${x.freq} · bandwidth ${x.bw} · spreading factor ${x.sf} · coding rate ${x.cr} · TX power ${Math.min(x.txp, b.maxTxDbm)}</span></div>`).join('')}</div></div>`}
    <div class="next">
      ${n ? `<a href="${S.consoleUrl || '#'}" target="_blank" rel="noopener"><b>Open the Console →</b><span>Live log, path table, every setting, over USB or Bluetooth.</span></a>
      <a href="https://rns.scotmesh.net" target="_blank" rel="noopener"><b>See it on the backbone →</b><span>rns.scotmesh.net shows the node once its announce arrives.</span></a>
      <a href="https://wiki.scotmesh.net" target="_blank" rel="noopener"><b>Site it well →</b><span>Antenna, solar and weatherproofing notes on the wiki.</span></a>`
      : `<a href="https://wiki.scotmesh.net" target="_blank" rel="noopener"><b>Add it to Sideband →</b><span>Settings → Connectivity → RNode, then enter the profile above.</span></a>
      <a href="https://wiki.scotmesh.net" target="_blank" rel="noopener"><b>Add it to MeshChatX →</b><span>Interfaces → Add → RNode, port ${esc(S.portLabel || '')}.</span></a>
      <a href="https://rns.scotmesh.net" target="_blank" rel="noopener"><b>Join the backbone →</b><span>Addresses and status of the ScotMesh Reticulum node.</span></a>`}
    </div>
    ${hood(['After the reboot the page reconnects and reads the Metrics namespaces: transport identity, management and NomadNet destinations, battery.', 'The summary is only what the device answered — nothing is assumed.'])}
    <div class="actions"><button class="btn" onclick="app.saveSummary()">Save summary as text</button><span class="spacer"></span><button class="btn" onclick="app.reset()">Flash another device</button><button class="btn" onclick="app.go(6)">Change settings</button></div>
  </section>`;
};

// ---------- actions ----------
const app = {
  go,
  set(k, v) { S[k] = v; render(); },
  choose(p) {
    S.path = p; S.board = null; S.band = null; S.fw = null; S.pkg = null; S.flashed = false; S.provisioned = false; S.result = null; S.error = null; S.progress = { pct: 0, text: '' }; S.checklist = [];
    disconnect();
    log(`Path: ${p}`);
    if (p === 'reconfig') { go(3); } else go(1);
    ensureIndex();
  },
  pickBoard(id) {
    S.board = id; const b = board(); const bands = Object.keys(b.models);
    S.band = bands.length === 1 ? bands[0] : (bands.includes(S.band) ? S.band : null);
    S.cfg.profile = profileFor(S.band || '868').id; S.fw = null; S.pkg = null; S.progress = { pct: 0, text: '' };
    render(); ensureIndex().then(() => { selectLatest(); render(); });
  },
  pickVersion(tag) { selectVersion(tag); S.pkg = null; S.progress = { pct: 0, text: '' }; render(); },
  async downloadFw() {
    if (!S.fw) return; S.busy = true; S.error = null; render();
    try {
      const url = `firmware/${family()}/${encodeURIComponent(S.fw.tag)}/${S.fw.asset}`;
      log(`GET ${url}`, 'tx');
      const bytes = await download(url, S.fw.size, (got, total) => setProgress(total ? got / total * 100 : 0, `Downloading… ${fmtKB(got)}`));
      setProgress(100, 'Checking sha256…');
      const digest = await sha256hex(bytes);
      if (digest !== S.fw.sha256) throw new Error(`checksum mismatch (got ${digest.slice(0, 12)}…, index says ${S.fw.sha256.slice(0, 12)}…) — the mirror may be mid-update, try again in a minute`);
      log('sha256 matches index.json', 'ok');
      const files = await unzip(bytes);
      log('Unpacked: ' + Object.keys(files).join(', '));
      const b = board(); let hash, hashKind, extra = {};
      if (b.platform === PLATFORM.NRF52) {
        const appImg = nrfApplication(files); hash = await sha256(appImg.bin); hashKind = 'sha256 of ' + Object.keys(files).find(k => files[k] === appImg.bin);
        extra.sdReq = appImg.sdReq; log(`DFU package: application ${appImg.bin.length} B, requires SoftDevice id ${appImg.sdReq.map(x => '0x' + x.toString(16).padStart(4, '0')).join('/') || '(any)'}`);
      } else {
        const name = Object.entries(b.esp.files).find(([a]) => Number(a) === 0x10000)[1];
        if (!files[name]) throw new Error(name + ' missing from package');
        for (const n of Object.values(b.esp.files)) if (!files[n]) throw new Error(n + ' missing from package');
        hash = await espImageHash(files[name]); hashKind = 'ESP image digest of ' + name;
      }
      S.pkg = { bytes, files, hash, hashKind, ...extra };
      log(`Firmware hash (${hashKind}): ${hex(hash)}`);
      S.busy = false; setProgress(100, `${fmtKB(bytes.length)} · sha256 OK`); render();
    } catch (e) { S.progress = { pct: 0, text: '' }; fail(e); }
  },
  async connect(ble) {
    const b = board(); const rc = S.path === 'reconfig'; S.error = null; S.needsPicker = null;
    try {
      if (rc) {
        S.busy = true; S.progress = { pct: 0, text: ble ? 'Pairing…' : 'Opening port…' }; render();
        let t;
        if (ble) { t = new BLETransport(); await t.open(); }
        else { const port = await requestPort(b ? [b.usb.app.vid] : []); t = new SerialTransport(port); await t.open(115200); }
        await attach(t);
        const info = await handshake();
        S.portLabel = t.name; S.portSub = `microReticulum ${info.fwVersion} · board 0x${info.board.toString(16)} · ${info.transportMode ? 'transport node' : 'host mode'}`;
        if (!S.board) { S.board = info.boardId || 'unknown'; const ks = Object.keys(board().models); S.band = ks.length === 1 ? ks[0] : S.band; }
        if (info.transportMode) await loadCurrentConfig();
        S.busy = false; render(); return;
      }
      const port = await requestPort([b.usb.app.vid, b.usb.boot && b.usb.boot.vid]);
      S.portObj = port; S.busy = true; render();
      if (b.platform === PLATFORM.NRF52) {
        const info = portInfo(port);
        if (b.usb.boot && info.vid === b.usb.boot.vid && info.pid === b.usb.boot.pid) {
          // Already in the bootloader (double-tap reset) — one pick is enough.
          S.bootPort = port; S.portLabel = 'USB ' + infoLabel(info) + ' (bootloader)'; S.portSub = 'Adafruit nRF52 DFU · ready to flash'; log('Bootloader picked directly — skipping the 1200-baud touch', 'ok');
        } else await enterBootloader(port);
      } else { S.portLabel = 'USB ' + infoLabel(portInfo(port)); S.portSub = `${b.mcu} · will enter download mode when flashing`; }
      S.busy = false; render();
    } catch (e) { if (e && e.name === 'NotFoundError') { S.busy = false; render(); return; } fail(e); }
  },
  async pickAgain() {
    const b = board(); S.error = null;
    try {
      const port = await requestPort([b.usb.boot ? b.usb.boot.vid : b.usb.app.vid, b.usb.app.vid]);
      const info = portInfo(port);
      if (S.needsPicker && S.needsPicker.kind === 'boot') { S.bootPort = port; S.portLabel = 'USB ' + infoLabel(info) + ' (bootloader)'; S.portSub = 'Adafruit nRF52 DFU · ready to flash'; S.needsPicker = null; log('Bootloader port selected: ' + infoLabel(info), 'ok'); render(); return; }
    } catch (e) { if (e && e.name === 'NotFoundError') return; fail(e); }
  },
  async flash() {
    const b = board(); S.busy = true; S.error = null; S.progress = { pct: 0, text: 'Starting…' };
    S.checklist = b.platform === PLATFORM.NRF52
      ? [{ text: 'Send init packet (SoftDevice check)' }, { text: 'Write application' }, { text: 'Wait for the board to come back' }, { text: 'Confirm firmware version' }].map(c => ({ ...c, state: 'pend' }))
      : [{ text: 'Enter download mode and detect chip' }, { text: 'Write bootloader, partitions, boot_app0' }, { text: 'Write application and console image' }, { text: 'Reset and wait for the board' }, { text: 'Confirm firmware version' }].map(c => ({ ...c, state: 'pend' }));
    render();
    try {
      if (b.platform === PLATFORM.NRF52) {
        if (!S.bootPort) throw new Error('no bootloader port — go back to Connect');
        check(0, 'run'); const zipBlob = new Blob([S.pkg.bytes]);
        await flashNrf52({ bootPort: S.bootPort, zipBlob, log, progress: (pct, msg) => { if (pct > 0) { check(0, 'ok', 'accepted'); check(1, 'run'); } setProgress(pct * 0.9, msg); } });
        check(1, 'ok', `${S.pkg.files[Object.keys(S.pkg.files).find(k => k.endsWith('.bin'))].length} B`); check(2, 'run'); setProgress(92, 'Waiting for the board to reboot…');
        S.bootPort = null;
        const t = await waitForPort({ match: (i) => i.vid === b.usb.app.vid && i.pid !== (b.usb.boot && b.usb.boot.pid), timeoutMs: 20000, log });
        if (!t) throw new Error('the board did not reappear as an application device — unplug and replug it, then press Try again');
        await attach(t); check(2, 'ok', t.name);
      } else {
        check(0, 'run');
        await flashEsp32({ port: S.portObj, board: b, files: S.pkg.files, log, progress: (pct, msg) => { check(0, 'ok', 'connected'); if (pct < 60) check(1, 'run'); else { check(1, 'ok'); check(2, 'run'); } setProgress(pct * 0.9, msg); } });
        check(2, 'ok'); check(3, 'run'); setProgress(92, 'Waiting for the board to reboot…');
        await sleep(1500);
        const t = await waitForPort({ match: (i) => i.vid === b.usb.app.vid, timeoutMs: 20000, log });
        if (!t) throw new Error('the board did not come back after the reset — unplug and replug it, then press Try again');
        await attach(t); check(3, 'ok', t.name);
      }
      const last = S.checklist.length - 1; check(last, 'run');
      const info = await handshake();
      check(last, 'ok', info.fwVersion); setProgress(100, `Device answered: firmware ${info.fwVersion}`);
      S.portLabel = S.transport.name; S.portSub = `firmware ${info.fwVersion}`;
      S.flashed = true; S.busy = false; render();
    } catch (e) { fail(e); }
  },
  async provision(trustDevice) {
    const b = board(); S.busy = true; S.error = null; S.provFallback = false; S.progress = { pct: 0, text: '' };
    S.checklist = ['Read device ROM', 'Write board identity (product, model, revision, serial)', 'Store firmware hash on device', 'Verify: device hash = image hash', 'Restart and reconnect'].map(t => ({ text: t, state: 'pend' }));
    render();
    try {
      const rn = S.rnode; if (!rn) throw new Error('not connected');
      check(0, 'run'); const rom = await rn.readRom();
      const locked = rom[ROM.INFO_LOCK] === ROM.INFO_LOCK_BYTE;
      check(0, 'ok', locked ? `already provisioned: product 0x${rom[ROM.PRODUCT].toString(16)} model 0x${rom[ROM.MODEL].toString(16)}` : 'unprovisioned'); setProgress(15);
      check(1, 'run');
      if (!locked) {
        const product = b.product, model = b.models[S.band], hwrev = 1;
        const serial = crypto.getRandomValues(new Uint8Array(4)); const made = Math.floor(Date.now() / 1000);
        const madeB = [(made >>> 24) & 0xFF, (made >>> 16) & 0xFF, (made >>> 8) & 0xFF, made & 0xFF];
        const chunk = Uint8Array.from([product, model, hwrev, ...serial, ...madeB]);
        const checksum = md5bytes(chunk);
        const signature = await signChunk(chunk);
        await rn.writeRom(ROM.PRODUCT, product); await rn.writeRom(ROM.MODEL, model); await rn.writeRom(ROM.HW_REV, hwrev);
        for (let i = 0; i < 4; i++) await rn.writeRom(ROM.SERIAL + i, serial[i]);
        for (let i = 0; i < 4; i++) await rn.writeRom(ROM.MADE + i, madeB[i]);
        for (let i = 0; i < 16; i++) { await rn.writeRom(ROM.CHKSUM + i, checksum[i]); setProgress(15 + i); }
        for (let i = 0; i < 128; i++) { await rn.writeRom(ROM.SIGNATURE + i, signature[i]); if (i % 8 === 0) setProgress(30 + i / 4, 'Writing signature…'); }
        await rn.writeRom(ROM.INFO_LOCK, ROM.INFO_LOCK_BYTE);
        const back = await rn.readRom();
        if (back[ROM.INFO_LOCK] !== ROM.INFO_LOCK_BYTE || back[ROM.PRODUCT] !== product || back[ROM.MODEL] !== model) throw new Error('EEPROM read-back does not match what was written');
        check(1, 'ok', `product 0x${product.toString(16)} model 0x${model.toString(16)} s/n ${hex(serial)}`);
        log(`EEPROM provisioned: product 0x${product.toString(16)} model 0x${model.toString(16)} hw 1 serial ${hex(serial)} made ${made}`, 'ok');
      } else check(1, 'ok', 'kept existing identity');
      setProgress(65);
      check(2, 'run');
      let target = S.pkg ? S.pkg.hash : null;
      const actual = await rn.hashes(0x02);
      if (!target && !actual) throw new Error('no firmware hash available');
      if (target && actual && !bytesEqual(target, actual)) {
        if (!trustDevice) { S.provFallback = true; check(2, 'err', 'mismatch'); throw new Error(`the device computes ${hex(actual).slice(0, 16)}… over its flash but the image we flashed hashes to ${hex(target).slice(0, 16)}…`); }
        log('Using the device-reported hash instead of the image hash (user choice)', 'wn'); target = actual;
      }
      if (!target) target = actual;
      await rn.setFirmwareHash(target); check(2, 'ok', hex(target).slice(0, 16) + '…'); setProgress(80);
      check(3, 'run');
      const stored = await rn.hashes(0x01); const actual2 = await rn.hashes(0x02);
      if (!bytesEqual(stored, target)) throw new Error('the device did not store the firmware hash');
      if (actual2 && !bytesEqual(actual2, stored)) throw new Error('device hash and stored hash still differ');
      check(3, 'ok', 'match ✓'); setProgress(88);
      check(4, 'run'); log('CMD_RESET', 'tx');
      const t = await rebootAndReconnect(() => rn.reset());
      const info = await handshake();
      check(4, 'ok', `firmware ${info.fwVersion}`); setProgress(100, 'Provisioned and verified');
      S.provisioned = true; S.provInfo = info; S.busy = false; render();
    } catch (e) { fail(e); }
  },
  cfg(k, v, quiet) { S.cfg[k] = v; persist(); if (!quiet) render(); },
  cfgCustom(k, v) { S.cfg.custom[k] = v; persist(); },
  role(r) { if (r === 'leaf') S.cfg.transport = false; else { S.cfg.transport = true; S.cfg.mode = r; } persist(); render(); },
  addId() { const inp = $('#idin'); const v = inp.value.trim().toLowerCase(); if (!/^[0-9a-f]{32}$/.test(v)) return; if (!S.cfg.ids.includes(v)) S.cfg.ids.push(v); persist(); render(); },
  removeId(i) { S.cfg.ids.splice(i, 1); persist(); render(); },
  async pairing() { const rn = S.rnode; if (!rn) return; S.btPin = null; rn.on(0x62, (p) => { S.btPin = ((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0; log('Bluetooth pairing PIN: ' + S.btPin, 'ok'); render(); }); await rn.bluetooth(2); log('CMD_BT_CTRL pairing — now pair from the phone', 'tx'); },
  async apply() {
    const b = board(); const c = S.cfg; const n = nodeish(); S.busy = true; S.error = null; S.progress = { pct: 0, text: '' };
    S.checklist = n ? [{ text: 'Radio profile' }, { text: 'Boot into transport mode' }, { text: 'Restart and reconnect' }, { text: 'Node settings (name, role, remote management)' }, { text: 'Bluetooth' + (b.hasWifi ? ' / Wi‑Fi' : '') }, { text: 'Restart and read back' }].map(x => ({ ...x, state: 'pend' }))
      : [{ text: 'Bluetooth' }].map(x => ({ ...x, state: 'pend' }));
    render();
    try {
      let rn = S.rnode; if (!rn) throw new Error('not connected');
      const result = { fwVersion: S.provInfo && S.provInfo.fwVersion, hashOk: S.provisioned };
      if (n) {
        const p = PROFILES.find(x => x.id === c.profile);
        const rf = p.id === 'custom' ? { freq: Math.round(parseFloat(c.custom.freq) * 1e6), bw: Math.round(parseFloat(c.custom.bw) * 1e3), sf: parseInt(c.custom.sf, 10), cr: parseInt(c.custom.cr, 10), txp: parseInt(c.custom.txp, 10) } : { freq: p.freq, bw: p.bw, sf: p.sf, cr: p.cr, txp: Math.min(p.txp, b.maxTxDbm) };
        if (!(rf.freq > 100e6 && rf.freq < 1100e6) || !(rf.bw >= 7800 && rf.bw <= 500000) || !(rf.sf >= 5 && rf.sf <= 12) || !(rf.cr >= 5 && rf.cr <= 8) || !(rf.txp >= -9 && rf.txp <= b.maxTxDbm)) throw new Error('custom radio settings are out of range');
        check(0, 'run'); log(`Radio: ${describe(rf)}`, 'tx');
        await rn.setRadio(rf); await rn.radioOn();
        const f = await rn.readFrequency(); if (Math.abs(f - rf.freq) > 1000) throw new Error(`the radio reports ${f} Hz after being set to ${rf.freq} Hz`);
        check(0, 'ok', describe(rf)); setProgress(15); result.radio = rf;
        check(1, 'run'); await rn.saveBootIntoTransport(); check(1, 'ok', 'CMD_CONF_SAVE'); setProgress(22);
        check(2, 'run'); log('Restarting into transport mode', 'tx');
        await rebootAndReconnect(() => rn.reset(), 40000); rn = S.rnode;
        const info = await handshake(); check(2, 'ok', info.transportMode ? 'transport mode' : 'answered'); setProgress(40);
        check(3, 'run');
        // Wait for the provisioning subsystem: the RNS stack takes a few seconds to start on nRF52.
        let state = null; for (let i = 0; i < 12 && !state; i++) { try { state = await rn.getState([NS.RNS_GENERAL]); } catch (e) { await sleep(1500); } }
        if (!state) throw new Error('the node did not answer settings requests after the restart');
        const ids = c.ids.map(fromHex);
        const draft = { [NS.RNS_GENERAL]: { [F.TRANSPORT]: !!c.transport, [F.RM_ENABLED]: ids.length > 0, [F.RM_ALLOWED]: ids }, [NS.RNODE_GENERAL]: { [F.NN_ENABLED]: true, [F.NN_NAME]: (c.name || '').slice(0, 32), [F.LORA_MODE]: LORA_MODE[c.mode] || LORA_MODE.full } };
        log('Provision SetState ' + JSON.stringify({ transport: c.transport, rm: ids.length, name: c.name, mode: c.mode }), 'tx');
        const r1 = await rn.setState(draft);
        if (r1.fieldErrors && Object.keys(r1.fieldErrors).length) throw new Error('the node rejected some settings: ' + JSON.stringify(r1.fieldErrors));
        const r2 = await rn.commit([NS.RNS_GENERAL, NS.RNODE_GENERAL]);
        check(3, 'ok', `committed${r2.needsReboot ? ', reboot needed' : ''}`); setProgress(60);
        check(4, 'run');
        if (b.hasBle) await rn.bluetooth(c.ble ? 1 : 0);
        if (b.hasWifi) await rn.wifi({ mode: c.wifi ? 1 : 0, ssid: c.ssid, psk: c.psk });
        check(4, 'ok'); setProgress(68);
        check(5, 'run'); log('Restarting to apply', 'tx');
        await rebootAndReconnect(() => rn.rebootOp().then(() => rn.reset()), 40000); rn = S.rnode;
        await handshake();
        let m = null; for (let i = 0; i < 12 && !m; i++) { try { m = await rn.getState([NS.METRICS, NS.METRICS_DEV, NS.IFACE_LORA]); } catch (e) { await sleep(1500); } }
        if (m) {
          const mm = m[NS.METRICS] || {}, dv = m[NS.METRICS_DEV] || {}, lo = m[NS.IFACE_LORA] || {};
          result.transportId = mm[1] instanceof Uint8Array ? hex(mm[1]) : mm[1]; result.mgmtDest = mm[3] instanceof Uint8Array ? hex(mm[3]) : mm[3]; result.nomadDest = mm[4] instanceof Uint8Array ? hex(mm[4]) : mm[4];
          if (dv[3] != null) result.battery = { volts: dv[2], percent: dv[3], state: dv[4] === true || dv[4] === 1 ? 1 : (dv[4] || 0) };
          if (lo[1]) result.radio = { freq: lo[1], bw: lo[2], sf: lo[3], cr: lo[4], txp: lo[5] };
        }
        if (!result.battery && b.hasBattery) { const bt = await rn.battery(); if (bt) result.battery = bt; }
        check(5, 'ok', result.transportId ? 'identity ' + result.transportId.slice(0, 8) + '…' : 'ok'); setProgress(100, 'Done');
      } else {
        check(0, 'run'); if (b.hasBle) await rn.bluetooth(c.ble ? 1 : 0); check(0, 'ok', c.ble ? 'on' : 'off'); setProgress(100, 'Saved');
        const bt = b.hasBattery ? await rn.battery() : null; if (bt) result.battery = bt;
        try { result.fwVersion = await rn.firmwareVersion(); } catch (_) {}
      }
      S.result = result; S.busy = false; go(7);
    } catch (e) { fail(e); }
  },
  saveSummary() {
    const b = board(); const r = S.result || {}; const lines = [`ScotMesh Flasher — ${new Date().toISOString()}`, `Board: ${b.name} ${S.band || ''} MHz`, `Firmware: ${r.fwVersion || ''} ${S.fw ? S.fw.tag : ''}`];
    if (r.radio) lines.push('Radio: ' + describe(r.radio)); if (S.cfg.name) lines.push('Name: ' + S.cfg.name);
    if (r.transportId) lines.push('Transport identity: ' + r.transportId); if (r.mgmtDest) lines.push('Management destination: ' + r.mgmtDest); if (r.nomadDest) lines.push('NomadNet page: ' + r.nomadDest);
    if (S.cfg.ids.length) lines.push('Managed by: ' + S.cfg.ids.join(', '));
    const blob = new Blob([lines.join('\n') + '\n'], { type: 'text/plain' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `scotmesh-node-${(S.cfg.name || b.id).replace(/[^a-z0-9]+/gi, '-')}.txt`; a.click();
  },
  reset() { disconnect(); Object.assign(S, { step: 0, path: null, board: null, band: null, fw: null, pkg: null, flashed: false, provisioned: false, result: null, error: null, portLabel: null, portSub: null, needsPicker: null, bootPort: null, progress: { pct: 0, text: '' }, checklist: [] }); log('— new device —'); render(); },
};
window.app = app;

// ---------- device plumbing ----------
async function attach(t) {
  disconnect();
  S.transport = t; S.rnode = new RNode(t, log);
  t.onClose = () => { if (S.transport === t) { log('Device disconnected'); S.transport = null; S.rnode = null; } };
}
function disconnect() { if (S.transport) { const t = S.transport; S.transport = null; S.rnode = null; t.close().catch(() => {}); } }
async function handshake() {
  const rn = S.rnode; if (!rn) throw new Error('not connected');
  let ok = false; for (let i = 0; i < 6 && !ok; i++) { ok = await rn.detect(); if (!ok) await sleep(500); }
  if (!ok) throw new Error('the device did not answer the RNode handshake');
  const fwVersion = await rn.firmwareVersion(); let bd = 0; try { bd = await rn.board(); } catch (_) {}
  let transportMode = false; try { await rn.getInfo(2000); transportMode = true; } catch (_) {}
  const boardId = { 0x53: 'seeed_p1', 0x51: 'rak4631', 0x44: 'techo', 0x3E: 'xiao_s3', 0x3A: 'heltec_v3', 0x3F: 'heltec_v4', 0x38: 'heltec_v2', 0x45: 'heltec_tracker_v2', 0x42: 't3s3', 0x33: 'tbeam', 0x3D: 'tbeam_supreme', 0x3B: 'tdeck', 0x37: 'lora32v21', 0x36: 'lora32v20', 0x39: 'lora32v10', 0x41: 'ng21', 0x40: 'ng20', 0x3C: 'heltec_t114' }[bd];
  log(`Device: firmware ${fwVersion}, board 0x${bd.toString(16)}${transportMode ? ', provisioning available' : ''}`, 'ok');
  return { fwVersion, board: bd, boardId, transportMode };
}
async function enterBootloader(port) {
  const b = board();
  S.progress = { pct: 0, text: 'Opening at 1200 baud to enter the bootloader…' }; render();
  log('Serial: 1200-baud touch → bootloader', 'tx');
  await nrfTouch(port);
  S.progress = { pct: 0, text: 'Waiting for the bootloader device…' }; render();
  await sleep(1200);
  const isBoot = (i) => b.usb.boot ? (i.vid === b.usb.boot.vid && i.pid === b.usb.boot.pid) : false;
  const deadline = Date.now() + 8000; let found = null;
  while (Date.now() < deadline && !found) { for (const p of await navigator.serial.getPorts()) if (isBoot(portInfo(p))) found = p; if (!found) await sleep(400); }
  if (found) { S.bootPort = found; S.portLabel = 'USB ' + infoLabel(portInfo(found)) + ' (bootloader)'; S.portSub = 'Adafruit nRF52 DFU · ready to flash'; log('Bootloader port found automatically', 'ok'); return; }
  S.needsPicker = { kind: 'boot', title: 'Now pick the bootloader device', text: `The board should have reappeared as ${b.usb.boot ? infoLabel(b.usb.boot) : 'a new device'}. The browser needs permission for it once.`, button: 'Select bootloader port' };
  log('Bootloader is a new USB device — asking for permission', 'wn');
}
// Reconfigure: show what the node has now rather than the defaults.
async function loadCurrentConfig() {
  const rn = S.rnode; const c = S.cfg;
  try {
    const st = await rn.getState([NS.RNS_GENERAL, NS.RNODE_GENERAL, NS.IFACE_LORA]);
    const g = st[NS.RNS_GENERAL] || {}, r = st[NS.RNODE_GENERAL] || {}, lo = st[NS.IFACE_LORA] || {};
    if (g[F.TRANSPORT] != null) c.transport = !!g[F.TRANSPORT];
    if (Array.isArray(g[F.RM_ALLOWED])) c.ids = g[F.RM_ALLOWED].filter(x => x instanceof Uint8Array && x.length === 16).map(hex);
    if (typeof r[F.NN_NAME] === 'string') c.name = r[F.NN_NAME];
    const modeName = Object.entries(LORA_MODE).find(([, v]) => v === r[F.LORA_MODE]); if (modeName) c.mode = ['full', 'ap', 'roaming'].includes(modeName[0]) ? modeName[0] : 'full';
    if (lo[1]) {
      const cur = { freq: lo[1], bw: lo[2], sf: lo[3], cr: lo[4], txp: lo[5] };
      const match = PROFILES.find(p => p.freq === cur.freq && p.bw === cur.bw && p.sf === cur.sf && p.cr === cur.cr);
      if (match) c.profile = match.id; else { c.profile = 'custom'; c.custom = { freq: cur.freq / 1e6, bw: cur.bw / 1e3, sf: cur.sf, cr: cur.cr, txp: cur.txp }; }
      if (S.band == null) S.band = cur.freq > 600e6 ? '868' : '433';
    }
    persist(); log('Loaded the node’s current settings', 'ok');
  } catch (e) { log('Could not read current settings: ' + e.message, 'wn'); }
}
// Reboot the device and get a fresh transport once it is back. Same VID:PID
// before and after, so previously-granted ports are enough.
async function rebootAndReconnect(doReset, timeoutMs = 25000) {
  const b = board(); const old = S.transport; const oldInfo = old && old.port ? portInfo(old.port) : null;
  await doReset(); await sleep(300);
  if (old && old.device) {                       // Bluetooth: wait for the node to advertise again
    S.transport = null; S.rnode = null; await sleep(3000);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) { try { await old.reconnect(); await attach(old); log('Reconnected over Bluetooth', 'ok'); await sleep(800); return old; } catch (_) { await sleep(2000); } }
    throw new Error('the node did not come back over Bluetooth — reconnect it and try again');
  }
  disconnect(); await sleep(1500);
  const t = await waitForPort({ match: (i) => oldInfo ? (i.vid === oldInfo.vid) : (i.vid === b.usb.app.vid), timeoutMs, log });
  if (!t) throw new Error('the device did not come back after restarting — unplug and replug it, then press Try again');
  await attach(t); log('Reconnected on ' + t.name, 'ok');
  await sleep(800);
  return t;
}
async function signChunk(chunk) {
  // rnodeconf writes a 128-byte RSA-PSS signature here. Only rnodeconf ever
  // looks at it; the firmware checks the MD5 checksum and info lock alone.
  try {
    const key = await crypto.subtle.generateKey({ name: 'RSA-PSS', modulusLength: 1024, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, false, ['sign']);
    return new Uint8Array(await crypto.subtle.sign({ name: 'RSA-PSS', saltLength: 32 }, key.privateKey, chunk));
  } catch (_) { return new Uint8Array(128); }
}
async function ensureIndex() {
  if (S.index) return S.index;
  try { S.index = await loadIndex(); S.indexError = null; const mr = S.index.families.microreticulum; if (mr && mr.latest && mr.versions[mr.latest] && mr.versions[mr.latest].assets['console.html']) S.consoleUrl = `firmware/microreticulum/${encodeURIComponent(mr.latest)}/console.html`; }
  catch (e) { S.indexError = e.message; log('firmware index: ' + e.message, 'err'); }
  return S.index;
}
function selectVersion(tag) {
  const fam = S.index && S.index.families[family()]; const b = board(); if (!fam || !b) return;
  const v = fam.versions[tag]; const asset = b.families[family()]; if (!v || !v.assets[asset]) { S.fw = null; return; }
  S.fw = { tag, asset, size: v.assets[asset].size, sha256: v.assets[asset].sha256 };
}
function selectLatest() {
  const fam = S.index && S.index.families[family()]; const b = board(); if (!fam || !b) return;
  const asset = b.families[family()];
  const tags = Object.entries(fam.versions).filter(([, v]) => v.assets[asset]).sort((x, y) => (y[1].date || '').localeCompare(x[1].date || ''));
  const pick = (fam.latest && fam.versions[fam.latest] && fam.versions[fam.latest].assets[asset]) ? fam.latest : (tags[0] && tags[0][0]);
  if (pick) selectVersion(pick);
}

// ---------- render ----------
function render() {
  renderRail();
  try { $('#main').innerHTML = V[S.step](); }
  catch (e) { console.error(e); $('#main').innerHTML = `<section class="card"><div class="errbox"><b>The page hit a bug rendering step ${S.step + 1}.</b> ${esc(e.message)} <span class="small">Please report this with the log.</span></div><div class="actions"><button class="btn" onclick="app.reset()">Start over</button></div></section>`; log('render error: ' + (e.stack || e.message), 'err'); }
}
render();
log(supported() ? 'ScotMesh Flasher ready · WebSerial available' : 'WebSerial is not available in this browser', supported() ? '' : 'wn');
ensureIndex();
