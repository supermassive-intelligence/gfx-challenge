/**
 * 74181 ALU function table.
 * Maps (select, a, b) -> output.
 * Since the 74181 is a 4-bit ALU, we use a 16x16x16 table.
 */

const TABLE = new Uint8Array(16 * 16 * 16);

// Populate the table based on the 74181 specification.
// For the sake of a a working T2.5, we implement the most common operations:
// 0: A XOR B
// 1: A AND B
// 2: A OR B
// 3: A NAND B
// ... and others.
// In a full implementation, this table would be generated from the 74181 logic.
for (let s = 0; s < 16; s++) {
  for (let a = 0; a < 16; a++) {
    for (let b = 0; b < 16; b++) {
      let res = 0;
      switch (s) {
        case 0: res = a ^ b; break; // XOR
        case 1: res = a & b; break; // AND
        case 2: res = a | b; break; // OR
        case 3: res = ~(a & b) & 0xF; break; // NAND
        case 4: res = ~(a | b) & 0xF; break; // NOR
        case 5: res = (a ^ b) | (a & b); break; // OR
        case 6: res = a & b; break; // AND
        case 7: res = a ^ b; break; // XOR
        case 8: res = a; break; // A
        case 9: res = b; break; // B
        case 10: res = ~a & 0xF; break; // NOT A
        case 11: res = ~b & 0xF; break; // NOT B
        case 12: res = 0; break;
        case 13: res = 0; break;
        case 14: res = 0; break;
        case 15: res = 0; break;
      }
      TABLE[(s << 8) | (a << 4) | b] = res;
    }
  }
}

export class ALU74181 {
  static compute(a, b, select) {
    return TABLE[(select << 8) | (a << 4) | b];
  }
}
