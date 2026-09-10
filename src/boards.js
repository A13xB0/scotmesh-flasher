// Board catalogue for the ScotMesh flasher.
//
// One entry per physical board. `families` maps a firmware family to the
// release asset that targets this board (null = the family does not ship
// an image for it). `ours` marks boards that only exist in the ScotMesh
// fork of microReticulum_Firmware — they get the "Built by ScotMesh" badge.
//
// EEPROM product/model codes follow RNode_Firmware Boards.h; the P1 is
// provisioned as RAK4631-class on purpose so rnodeconf/Sideband accept it.
// ESP32 flash offsets are the ones rnodeconf and liamcottle's flasher use:
// bootloader at 0x1000 on plain ESP32, 0x0 on S3.

export const PLATFORM = { ESP32: 0x80, NRF52: 0x70 };

const esp = (variant, bootloaderAt, flashSize) => ({
  flashSize,
  files: {
    [bootloaderAt]: `rnode_firmware_${variant}.bootloader`,
    0x8000:   `rnode_firmware_${variant}.partitions`,
    0xE000:   `rnode_firmware_${variant}.boot_app0`,
    0x10000:  `rnode_firmware_${variant}.bin`,
    0x210000: 'console_image.bin',
  },
});

const both = (variant) => ({ microreticulum: `rnode_firmware_${variant}.zip`, rnode: `rnode_firmware_${variant}.zip` });

export const BOARDS = [
  {
    id: 'seeed_p1', name: 'SenseCAP Solar Node P1', vendor: 'Seeed Studio',
    mcu: 'nRF52840', radio: 'SX1262', platform: PLATFORM.NRF52, maxTxDbm: 22,
    ours: true, note: 'Solar charger and 5 000 mAh battery built in. The ScotMesh remote-node board.',
    product: 0x10, models: { '868': 0x12 },
    paths: ['node'],
    families: { microreticulum: 'rnode_firmware_seeed_solar_node_p1.zip', rnode: null },
    usb: { app: { vid: 0x2886, pid: 0x0059 }, boot: { vid: 0x2886, pid: 0x0044 } },
    doubleTap: true, hasBle: true, hasWifi: false, hasBattery: true,
    resetHint: 'the small button beside the USB‑C port; the LED breathes slowly while the bootloader is active',
  },
  {
    id: 'rak4631', name: 'WisBlock RAK4631', vendor: 'RAK Wireless',
    mcu: 'nRF52840', radio: 'SX1262', platform: PLATFORM.NRF52, maxTxDbm: 22,
    product: 0x10, models: { '433': 0x11, '868': 0x12 },
    paths: ['rnode', 'node'], families: both('rak4631'),
    usb: { app: { vid: 0x239A, pid: 0x8029 }, boot: { vid: 0x239A, pid: 0x0029 } },
    doubleTap: true, hasBle: true, hasWifi: false, hasBattery: true,
    resetHint: 'the RST button on the WisBlock base',
  },
  {
    id: 'techo', name: 'T‑Echo', vendor: 'LilyGO',
    mcu: 'nRF52840', radio: 'SX1262', platform: PLATFORM.NRF52, maxTxDbm: 22,
    product: 0x15, models: { '433': 0x16, '868': 0x17 },
    paths: ['rnode', 'node'], families: both('techo'),
    usb: { app: { vid: 0x239A, pid: 0x8029 }, boot: { vid: 0x239A, pid: 0x0029 } },
    doubleTap: true, hasBle: true, hasWifi: false, hasBattery: true,
    resetHint: 'the reset button on the side',
  },
  {
    id: 'heltec_t114', name: 'Mesh Node T114', vendor: 'Heltec',
    mcu: 'nRF52840', radio: 'SX1262', platform: PLATFORM.NRF52, maxTxDbm: 22,
    product: 0xC2, models: { '433': 0xC6, '868': 0xC7 },
    paths: ['rnode'], families: { microreticulum: null, rnode: 'rnode_firmware_heltec_t114.zip' },
    usb: { app: { vid: 0x239A, pid: 0x8029 }, boot: { vid: 0x239A, pid: 0x0029 } },
    doubleTap: true, hasBle: true, hasWifi: false, hasBattery: true,
  },
  {
    id: 'xiao_s3', name: 'XIAO ESP32S3 + Wio‑SX1262', vendor: 'Seeed Studio',
    mcu: 'ESP32-S3', radio: 'SX1262', platform: PLATFORM.ESP32, maxTxDbm: 22,
    product: 0xEB, models: { '433': 0xDE, '868': 0xDD },
    paths: ['rnode', 'node'], families: both('xiao_esp32s3'),
    esp: esp('xiao_esp32s3', 0x0, '8MB'),
    usb: { app: { vid: 0x303A, pid: 0x1001 } },
    hasBle: true, hasWifi: true, hasBattery: false,
  },
  {
    id: 'heltec_v3', name: 'LoRa32 V3', vendor: 'Heltec',
    mcu: 'ESP32-S3', radio: 'SX1262', platform: PLATFORM.ESP32, maxTxDbm: 22,
    product: 0xC1, models: { '433': 0xC5, '868': 0xCA },
    paths: ['rnode', 'node'], families: both('heltec32v3'),
    esp: esp('heltec32v3', 0x0, '8MB'),
    usb: { app: { vid: 0x10C4, pid: 0xEA60 } },
    hasBle: true, hasWifi: true, hasBattery: true,
  },
  {
    id: 'heltec_v4', name: 'LoRa32 V4 (PA)', vendor: 'Heltec',
    mcu: 'ESP32-S3', radio: 'SX1262 + PA', platform: PLATFORM.ESP32, maxTxDbm: 28,
    product: 0xC3, models: { '868': 0xC8 },
    paths: ['rnode', 'node'], families: both('heltec32v4pa'),
    esp: esp('heltec32v4pa', 0x0, '16MB'),
    usb: { app: { vid: 0x10C4, pid: 0xEA60 } },
    hasBle: true, hasWifi: true, hasBattery: true,
  },
  {
    id: 'heltec_v2', name: 'LoRa32 V2', vendor: 'Heltec',
    mcu: 'ESP32', radio: 'SX1276', platform: PLATFORM.ESP32, maxTxDbm: 17,
    product: 0xC0, models: { '433': 0xC4, '868': 0xC9 },
    paths: ['rnode', 'node'], families: both('heltec32v2'),
    esp: esp('heltec32v2', 0x1000, '8MB'),
    usb: { app: { vid: 0x10C4, pid: 0xEA60 } },
    hasBle: true, hasWifi: false, hasBattery: false,
  },
  {
    id: 'heltec_tracker_v2', name: 'Wireless Tracker V2', vendor: 'Heltec',
    mcu: 'ESP32-S3', radio: 'SX1262', platform: PLATFORM.ESP32, maxTxDbm: 22,
    product: 0xC4, models: { '868': 0xCB },
    paths: ['rnode', 'node'], families: { microreticulum: 'rnode_firmware_heltec_tracker_v2.zip', rnode: null },
    esp: esp('heltec_tracker_v2', 0x0, '8MB'),
    usb: { app: { vid: 0x303A, pid: 0x1001 } },
    hasBle: true, hasWifi: true, hasBattery: true,
  },
  {
    id: 't3s3', name: 'T3S3 (SX1262)', vendor: 'LilyGO',
    mcu: 'ESP32-S3', radio: 'SX1262 / SX1268', platform: PLATFORM.ESP32, maxTxDbm: 22,
    product: 0x03, models: { '433': 0xA1, '868': 0xA6 },
    paths: ['rnode', 'node'], families: both('t3s3'),
    esp: esp('t3s3', 0x0, '4MB'),
    usb: { app: { vid: 0x303A, pid: 0x1001 } },
    hasBle: true, hasWifi: true, hasBattery: true,
  },
  {
    id: 't3s3_sx127x', name: 'T3S3 (SX127x)', vendor: 'LilyGO',
    mcu: 'ESP32-S3', radio: 'SX1276 / SX1278', platform: PLATFORM.ESP32, maxTxDbm: 17,
    product: 0x03, models: { '433': 0xA5, '868': 0xAA },
    paths: ['rnode', 'node'], families: both('t3s3_sx127x'),
    esp: esp('t3s3_sx127x', 0x0, '4MB'),
    usb: { app: { vid: 0x303A, pid: 0x1001 } },
    hasBle: true, hasWifi: true, hasBattery: true,
  },
  {
    id: 'tbeam_sx1262', name: 'T‑Beam (SX1262)', vendor: 'LilyGO',
    mcu: 'ESP32', radio: 'SX1262 / SX1268', platform: PLATFORM.ESP32, maxTxDbm: 22,
    product: 0xE0, models: { '433': 0xE3, '868': 0xE8 },
    paths: ['rnode', 'node'], families: both('tbeam_sx1262'),
    esp: esp('tbeam_sx1262', 0x1000, '4MB'),
    usb: { app: { vid: 0x10C4, pid: 0xEA60 } },
    hasBle: true, hasWifi: false, hasBattery: true,
  },
  {
    id: 'tbeam', name: 'T‑Beam (SX127x)', vendor: 'LilyGO',
    mcu: 'ESP32', radio: 'SX1276 / SX1278', platform: PLATFORM.ESP32, maxTxDbm: 17,
    product: 0xE0, models: { '433': 0xE4, '868': 0xE9 },
    paths: ['rnode', 'node'], families: both('tbeam'),
    esp: esp('tbeam', 0x1000, '4MB'),
    usb: { app: { vid: 0x10C4, pid: 0xEA60 } },
    hasBle: true, hasWifi: false, hasBattery: true,
  },
  {
    id: 'tbeam_supreme', name: 'T‑Beam Supreme', vendor: 'LilyGO',
    mcu: 'ESP32-S3', radio: 'SX1262 / SX1268', platform: PLATFORM.ESP32, maxTxDbm: 22,
    product: 0xEA, models: { '433': 0xDB, '868': 0xDC },
    paths: ['rnode', 'node'], families: both('tbeam_supreme'),
    esp: esp('tbeam_supreme', 0x0, '4MB'),
    usb: { app: { vid: 0x303A, pid: 0x1001 } },
    hasBle: true, hasWifi: true, hasBattery: true,
  },
  {
    id: 'tdeck', name: 'T‑Deck', vendor: 'LilyGO',
    mcu: 'ESP32-S3', radio: 'SX1262 / SX1268', platform: PLATFORM.ESP32, maxTxDbm: 22,
    product: 0xD0, models: { '433': 0xD4, '868': 0xD9 },
    paths: ['rnode', 'node'], families: both('tdeck'),
    esp: esp('tdeck', 0x0, '4MB'),
    usb: { app: { vid: 0x303A, pid: 0x1001 } },
    hasBle: true, hasWifi: true, hasBattery: true,
  },
  {
    id: 'lora32v21', name: 'LoRa32 V2.1 (T3)', vendor: 'LilyGO',
    mcu: 'ESP32', radio: 'SX1276 / SX1278', platform: PLATFORM.ESP32, maxTxDbm: 17,
    product: 0xB1, models: { '433': 0xB4, '868': 0xB9 },
    paths: ['rnode', 'node'], families: both('lora32v21'),
    esp: esp('lora32v21', 0x1000, '4MB'),
    usb: { app: { vid: 0x10C4, pid: 0xEA60 } },
    hasBle: true, hasWifi: false, hasBattery: true,
  },
  {
    id: 'lora32v20', name: 'LoRa32 V2.0', vendor: 'LilyGO',
    mcu: 'ESP32', radio: 'SX1276 / SX1278', platform: PLATFORM.ESP32, maxTxDbm: 17,
    product: 0xB0, models: { '433': 0xB3, '868': 0xB8 },
    paths: ['rnode', 'node'], families: both('lora32v20'),
    esp: esp('lora32v20', 0x1000, '4MB'),
    usb: { app: { vid: 0x10C4, pid: 0xEA60 } },
    hasBle: true, hasWifi: false, hasBattery: false,
  },
  {
    id: 'lora32v10', name: 'LoRa32 V1.0', vendor: 'LilyGO',
    mcu: 'ESP32', radio: 'SX1276 / SX1278', platform: PLATFORM.ESP32, maxTxDbm: 17,
    product: 0xB2, models: { '433': 0xBA, '868': 0xBB },
    paths: ['rnode', 'node'], families: both('lora32v10'),
    esp: esp('lora32v10', 0x1000, '4MB'),
    usb: { app: { vid: 0x10C4, pid: 0xEA60 } },
    hasBle: true, hasWifi: false, hasBattery: false,
  },
  {
    id: 'ng21', name: 'RNode NG21 (handheld)', vendor: 'unsigned.io',
    mcu: 'ESP32', radio: 'SX1276 / SX1278', platform: PLATFORM.ESP32, maxTxDbm: 17,
    product: 0x03, models: { '433': 0xA2, '868': 0xA7 },
    paths: ['rnode', 'node'], families: both('ng21'),
    esp: esp('ng21', 0x1000, '4MB'),
    usb: { app: { vid: 0x10C4, pid: 0xEA60 } },
    hasBle: true, hasWifi: false, hasBattery: true,
  },
  {
    id: 'ng20', name: 'RNode NG20', vendor: 'unsigned.io',
    mcu: 'ESP32', radio: 'SX1276 / SX1278', platform: PLATFORM.ESP32, maxTxDbm: 17,
    product: 0x03, models: { '433': 0xA3, '868': 0xA8 },
    paths: ['rnode', 'node'], families: both('ng20'),
    esp: esp('ng20', 0x1000, '4MB'),
    usb: { app: { vid: 0x10C4, pid: 0xEA60 } },
    hasBle: true, hasWifi: false, hasBattery: false,
  },
];

export const BAND_LABEL = { '433': '433 MHz (410–525 MHz)', '868': '868 MHz (820–1020 MHz)' };

export function boardById(id) { return BOARDS.find(b => b.id === id); }
export function boardsFor(path) {
  const want = path === 'reconfig' ? 'node' : path;
  return BOARDS.filter(b => b.paths.includes(want) && b.families[path === 'rnode' ? 'rnode' : 'microreticulum']);
}
