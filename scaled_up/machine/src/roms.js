/**
 * Berzerk RC31 program-ROM layout (CPU address space). Voice ROMs
 * (berzerk_r_vo_*) live on the sound board, not the Z80 bus, so they are not
 * loaded here. File->address mapping per cdoc/architecture.md ROM table.
 *
 * Environment-agnostic: assembleRoms(readFile) takes a function that returns a
 * Uint8Array for a given filename (Node fs in tests, fetch in the browser), and
 * returns { ROM0, ROM_MAIN } ready for Machine.loadRoms.
 */

// In load order (ascending address). ROM0 -> 0x0000; ROM_MAIN -> 0x1000-0x37FF.
export const ROM_LAYOUT = {
  ROM0: ['berzerk_rc31_1c.rom0.1c'],
  ROM_MAIN: [
    'berzerk_rc31_1d.rom1.1d',  // 0x1000
    'berzerk_rc31_3d.rom2.3d',  // 0x1800
    'berzerk_rc31_5d.rom3.5d',  // 0x2000
    'berzerk_rc31_6d.rom4.6d',  // 0x2800
    'berzerk_rc31a_5c.rom5.5c', // 0x3000
  ],
};

export const ROM_FILES = [...ROM_LAYOUT.ROM0, ...ROM_LAYOUT.ROM_MAIN];

function concat(parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

/** readFile(name) -> Uint8Array. Returns { ROM0, ROM_MAIN }. */
export function assembleRoms(readFile) {
  return {
    ROM0: concat(ROM_LAYOUT.ROM0.map(readFile)),
    ROM_MAIN: concat(ROM_LAYOUT.ROM_MAIN.map(readFile)),
  };
}
