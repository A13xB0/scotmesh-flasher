// ScotMesh radio profiles. These are the community's real values and must
// stay in step with the wiki's RNode page. Both use 125 kHz and coding
// rate 4/5. txp is capped at the board's maximum by the UI.
export const PROFILES = [
  { id: 'sm868', name: 'ScotMesh 868', band: '868', freq: 869462500, bw: 125000, sf: 9, cr: 5, txp: 22,
    why: 'Default for the Scottish backbone and most nodes. Use this unless you know why not.' },
  { id: 'sm433', name: 'ScotMesh 433', band: '433', freq: 433775000, bw: 125000, sf: 8, cr: 5, txp: 7,
    why: 'Low-band profile. Long range at low power; 7 dBm keeps it within the licence limit.' },
  { id: 'custom', name: 'Custom', why: 'Any settings you like. Other ScotMesh nodes will not hear you unless they match.' },
];
export function profileFor(band) { return PROFILES.find(p => p.band === band) || PROFILES[0]; }
export function describe(rf) {
  return `${(rf.freq / 1e6).toFixed(3)} MHz · ${rf.bw / 1000} kHz · SF${rf.sf} · 4/${rf.cr} · ${rf.txp} dBm`;
}
