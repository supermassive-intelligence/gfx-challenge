#!/usr/bin/env python3
"""
Z80 ROM Disassembler and Verification Tool for Berzerk

Reads the flat ROM binary and Tunstall disassembly, cross-references them,
performs independent Z80 instruction decoding, and identifies subroutine
entry points and basic block boundaries.
"""

import re
import sys
import os
from collections import OrderedDict

# ---------------------------------------------------------------------------
# Z80 instruction tables
# ---------------------------------------------------------------------------

# Register names for 8-bit operands encoded in bits 5-3 or 2-0
REG8 = ["b", "c", "d", "e", "h", "l", "(hl)", "a"]

# Register pair names for bits 5-4 (qq)
REG16_QQ = ["bc", "de", "hl", "sp"]
REG16_QQ_PUSH = ["bc", "de", "hl", "af"]

# Condition codes for bits 5-3
CC = ["nz", "z", "nc", "c", "po", "pe", "p", "m"]

# ALU operation names
ALU_OPS = ["add", "adc", "sub", "sbc", "and", "xor", "or", "cp"]

# CB-prefix rotation/shift names
ROT_OPS = ["rlc", "rrc", "rl", "rr", "sla", "sra", "sll", "srl"]


def decode_unprefixed(rom, pc, max_addr):
    """Decode a single unprefixed Z80 instruction.
    Returns (mnemonic_str, byte_count) or None if invalid/unknown."""
    if pc >= max_addr:
        return None
    op = rom[pc]

    def byte_at(offset):
        a = pc + offset
        if a >= max_addr:
            return 0
        return rom[a]

    def word_at(offset):
        return byte_at(offset) | (byte_at(offset + 1) << 8)

    def signed8(v):
        return v - 256 if v >= 128 else v

    # NOP
    if op == 0x00:
        return ("nop", 1)
    # EX AF,AF'
    if op == 0x08:
        return ("ex   af,af'", 1)
    # DJNZ
    if op == 0x10:
        d = signed8(byte_at(1))
        target = (pc + 2 + d) & 0xFFFF
        return ("djnz $%04X" % target, 2)
    # JR
    if op == 0x18:
        d = signed8(byte_at(1))
        target = (pc + 2 + d) & 0xFFFF
        return ("jr   $%04X" % target, 2)
    # JR cc (opcodes 0x20=NZ, 0x28=Z, 0x30=NC, 0x38=C)
    if op in (0x20, 0x28, 0x30, 0x38):
        cc_idx = (op >> 3) & 3
        cc_name = ["nz", "z", "nc", "c"][cc_idx]
        d = signed8(byte_at(1))
        target = (pc + 2 + d) & 0xFFFF
        return ("jr   %s,$%04X" % (cc_name, target), 2)

    # LD rr,nn (16-bit immediate)
    if (op & 0xCF) == 0x01:
        rr = REG16_QQ[(op >> 4) & 3]
        nn = word_at(1)
        return ("ld   %s,$%04X" % (rr, nn), 3)

    # ADD HL,rr
    if (op & 0xCF) == 0x09:
        rr = REG16_QQ[(op >> 4) & 3]
        return ("add  hl,%s" % rr, 1)

    # LD (BC),A / LD (DE),A / LD A,(BC) / LD A,(DE)
    if op == 0x02:
        return ("ld   (bc),a", 1)
    if op == 0x12:
        return ("ld   (de),a", 1)
    if op == 0x0A:
        return ("ld   a,(bc)", 1)
    if op == 0x1A:
        return ("ld   a,(de)", 1)

    # LD (nn),HL / LD HL,(nn)
    if op == 0x22:
        nn = word_at(1)
        return ("ld   ($%04X),hl" % nn, 3)
    if op == 0x2A:
        nn = word_at(1)
        return ("ld   hl,($%04X)" % nn, 3)
    # LD (nn),A / LD A,(nn)
    if op == 0x32:
        nn = word_at(1)
        return ("ld   ($%04X),a" % nn, 3)
    if op == 0x3A:
        nn = word_at(1)
        return ("ld   a,($%04X)" % nn, 3)

    # INC rr / DEC rr
    if (op & 0xCF) == 0x03:
        rr = REG16_QQ[(op >> 4) & 3]
        return ("inc  %s" % rr, 1)
    if (op & 0xCF) == 0x0B:
        rr = REG16_QQ[(op >> 4) & 3]
        return ("dec  %s" % rr, 1)

    # INC r / DEC r
    if (op & 0xC7) == 0x04:
        r = REG8[(op >> 3) & 7]
        return ("inc  %s" % r, 1)
    if (op & 0xC7) == 0x05:
        r = REG8[(op >> 3) & 7]
        return ("dec  %s" % r, 1)

    # LD r,n (8-bit immediate)
    if (op & 0xC7) == 0x06:
        r = REG8[(op >> 3) & 7]
        n = byte_at(1)
        if r == "(hl)":
            return ("ld   (hl),$%02X" % n, 2)
        return ("ld   %s,$%02X" % (r, n), 2)

    # Rotates/misc: RLCA, RRCA, RLA, RRA, DAA, CPL, SCF, CCF
    rot_misc = {
        0x07: "rlca",
        0x0F: "rrca",
        0x17: "rla",
        0x1F: "rra",
        0x27: "daa",
        0x2F: "cpl",
        0x37: "scf",
        0x3F: "ccf",
    }
    if op in rot_misc:
        return (rot_misc[op], 1)

    # HALT
    if op == 0x76:
        return ("halt", 1)

    # LD r,r'
    if (op & 0xC0) == 0x40:
        dst = REG8[(op >> 3) & 7]
        src = REG8[op & 7]
        return ("ld   %s,%s" % (dst, src), 1)

    # ALU A,r
    if (op & 0xC0) == 0x80:
        alu = ALU_OPS[(op >> 3) & 7]
        r = REG8[op & 7]
        if alu == "add" or alu == "adc" or alu == "sbc":
            return ("%s  a,%s" % (alu, r), 1)
        return ("%-4s %s" % (alu, r), 1)

    # RET cc
    if (op & 0xC7) == 0xC0:
        cc = CC[(op >> 3) & 7]
        return ("ret  %s" % cc, 1)

    # POP
    if (op & 0xCF) == 0xC1:
        rr = REG16_QQ_PUSH[(op >> 4) & 3]
        return ("pop  %s" % rr, 1)

    # RET
    if op == 0xC9:
        return ("ret", 1)
    # EXX
    if op == 0xD9:
        return ("exx", 1)
    # JP (HL)
    if op == 0xE9:
        return ("jp   (hl)", 1)
    # LD SP,HL
    if op == 0xF9:
        return ("ld   sp,hl", 1)

    # JP cc,nn
    if (op & 0xC7) == 0xC2:
        cc = CC[(op >> 3) & 7]
        nn = word_at(1)
        return ("jp   %s,$%04X" % (cc, nn), 3)

    # JP nn
    if op == 0xC3:
        nn = word_at(1)
        return ("jp   $%04X" % nn, 3)

    # OUT (n),A
    if op == 0xD3:
        n = byte_at(1)
        return ("out  ($%02X),a" % n, 2)
    # IN A,(n)
    if op == 0xDB:
        n = byte_at(1)
        return ("in   a,($%02X)" % n, 2)

    # EX (SP),HL
    if op == 0xE3:
        return ("ex   (sp),hl", 1)
    # EX DE,HL
    if op == 0xEB:
        return ("ex   de,hl", 1)
    # DI
    if op == 0xF3:
        return ("di", 1)
    # EI
    if op == 0xFB:
        return ("ei", 1)

    # CALL cc,nn
    if (op & 0xC7) == 0xC4:
        cc = CC[(op >> 3) & 7]
        nn = word_at(1)
        return ("call %s,$%04X" % (cc, nn), 3)

    # PUSH
    if (op & 0xCF) == 0xC5:
        rr = REG16_QQ_PUSH[(op >> 4) & 3]
        return ("push %s" % rr, 1)

    # CALL nn
    if op == 0xCD:
        nn = word_at(1)
        return ("call $%04X" % nn, 3)

    # ALU A,n (immediate)
    alu_imm = {
        0xC6: "add",
        0xCE: "adc",
        0xD6: "sub",
        0xDE: "sbc",
        0xE6: "and",
        0xEE: "xor",
        0xF6: "or",
        0xFE: "cp",
    }
    if op in alu_imm:
        n = byte_at(1)
        name = alu_imm[op]
        if name in ("add", "adc", "sbc"):
            return ("%s  a,$%02X" % (name, n), 2)
        return ("%-4s $%02X" % (name, n), 2)

    # RST
    if (op & 0xC7) == 0xC7:
        target = op & 0x38
        return ("rst  $%02X" % target, 1)

    return None


def decode_cb(rom, pc, max_addr):
    """Decode CB-prefixed instructions."""
    if pc + 1 >= max_addr:
        return None
    op = rom[pc + 1]
    r = REG8[op & 7]
    bit = (op >> 3) & 7

    if op < 0x40:
        name = ROT_OPS[(op >> 3) & 7]
        return ("%s  %s" % (name, r), 2)
    elif op < 0x80:
        return ("bit  %d,%s" % (bit, r), 2)
    elif op < 0xC0:
        return ("res  %d,%s" % (bit, r), 2)
    else:
        return ("set  %d,%s" % (bit, r), 2)


def decode_ed(rom, pc, max_addr):
    """Decode ED-prefixed instructions."""
    if pc + 1 >= max_addr:
        return None
    op = rom[pc + 1]

    def byte_at(offset):
        a = pc + offset
        return rom[a] if a < max_addr else 0

    def word_at(offset):
        return byte_at(offset) | (byte_at(offset + 1) << 8)

    # IN r,(C) / OUT (C),r
    if (op & 0xC7) == 0x40 and ((op >> 3) & 7) != 6:
        r = REG8[(op >> 3) & 7]
        return ("in   %s,(c)" % r, 2)
    if (op & 0xC7) == 0x41 and ((op >> 3) & 7) != 6:
        r = REG8[(op >> 3) & 7]
        return ("out  (c),%s" % r, 2)

    # IN (C) -- flags only, op = 0x70
    if op == 0x70:
        return ("in   (c)", 2)
    # OUT (C),0 -- op = 0x71
    if op == 0x71:
        return ("out  (c),0", 2)

    # SBC HL,rr / ADC HL,rr
    if (op & 0xCF) == 0x42:
        rr = REG16_QQ[(op >> 4) & 3]
        return ("sbc  hl,%s" % rr, 2)
    if (op & 0xCF) == 0x4A:
        rr = REG16_QQ[(op >> 4) & 3]
        return ("adc  hl,%s" % rr, 2)

    # LD (nn),rr / LD rr,(nn)
    if (op & 0xCF) == 0x43:
        rr = REG16_QQ[(op >> 4) & 3]
        nn = word_at(2)
        return ("ld   ($%04X),%s" % (nn, rr), 4)
    if (op & 0xCF) == 0x4B:
        rr = REG16_QQ[(op >> 4) & 3]
        nn = word_at(2)
        return ("ld   %s,($%04X)" % (rr, nn), 4)

    # NEG
    if op == 0x44:
        return ("neg", 2)
    # RETN
    if op == 0x45:
        return ("retn", 2)
    # RETI
    if op == 0x4D:
        return ("reti", 2)

    # IM 0/1/2
    if op == 0x46:
        return ("im   0", 2)
    if op == 0x56:
        return ("im   1", 2)
    if op == 0x5E:
        return ("im   2", 2)

    # LD I,A / LD R,A / LD A,I / LD A,R
    if op == 0x47:
        return ("ld   i,a", 2)
    if op == 0x4F:
        return ("ld   r,a", 2)
    if op == 0x57:
        return ("ld   a,i", 2)
    if op == 0x5F:
        return ("ld   a,r", 2)

    # RRD / RLD
    if op == 0x67:
        return ("rrd", 2)
    if op == 0x6F:
        return ("rld", 2)

    # Block instructions
    block = {
        0xA0: "ldi",
        0xA1: "cpi",
        0xA2: "ini",
        0xA3: "outi",
        0xA8: "ldd",
        0xA9: "cpd",
        0xAA: "ind",
        0xAB: "outd",
        0xB0: "ldir",
        0xB1: "cpir",
        0xB2: "inir",
        0xB3: "otir",
        0xB8: "lddr",
        0xB9: "cpdr",
        0xBA: "indr",
        0xBB: "otdr",
    }
    if op in block:
        return (block[op], 2)

    return None


def decode_dd_fd(rom, pc, max_addr, prefix):
    """Decode DD (IX) or FD (IY) prefixed instructions."""
    if pc + 1 >= max_addr:
        return None
    ix_name = "ix" if prefix == 0xDD else "iy"
    op = rom[pc + 1]

    def byte_at(offset):
        a = pc + offset
        return rom[a] if a < max_addr else 0

    def word_at(offset):
        return byte_at(offset) | (byte_at(offset + 1) << 8)

    def signed8(v):
        return v - 256 if v >= 128 else v

    # Replace HL with IX/IY, H with IXH/IYH, L with IXL/IYL
    def ix_reg8(idx):
        if idx == 4:
            return "%sh" % ix_name
        if idx == 5:
            return "%sl" % ix_name
        if idx == 6:
            return None  # (ix+d) -- special
        return REG8[idx]

    # DD CB / FD CB prefix -- indexed bit operations
    if op == 0xCB:
        if pc + 3 >= max_addr:
            return None
        d = signed8(byte_at(2))
        op2 = byte_at(3)
        bit = (op2 >> 3) & 7
        r_idx = op2 & 7
        disp = "+$%02X" % d if d >= 0 else "-$%02X" % (-d)
        operand = "(%s%s)" % (ix_name, disp)

        if op2 < 0x40:
            name = ROT_OPS[(op2 >> 3) & 7]
            if r_idx == 6:
                return ("%s  %s" % (name, operand), 4)
            else:
                return ("%s  %s,%s" % (name, operand, REG8[r_idx]), 4)
        elif op2 < 0x80:
            return ("bit  %d,%s" % (bit, operand), 4)
        elif op2 < 0xC0:
            if r_idx == 6:
                return ("res  %d,%s" % (bit, operand), 4)
            else:
                return ("res  %d,%s,%s" % (bit, operand, REG8[r_idx]), 4)
        else:
            if r_idx == 6:
                return ("set  %d,%s" % (bit, operand), 4)
            else:
                return ("set  %d,%s,%s" % (bit, operand, REG8[r_idx]), 4)

    # LD IX,nn
    if op == 0x21:
        nn = word_at(2)
        return ("ld   %s,$%04X" % (ix_name, nn), 4)
    # LD (nn),IX
    if op == 0x22:
        nn = word_at(2)
        return ("ld   ($%04X),%s" % (nn, ix_name), 4)
    # INC IX
    if op == 0x23:
        return ("inc  %s" % ix_name, 2)
    # DEC IX
    if op == 0x2B:
        return ("dec  %s" % ix_name, 2)
    # LD IX,(nn)
    if op == 0x2A:
        nn = word_at(2)
        return ("ld   %s,($%04X)" % (ix_name, nn), 4)
    # ADD IX,rr
    if (op & 0xCF) == 0x09:
        rr_idx = (op >> 4) & 3
        rr_names = ["bc", "de", ix_name, "sp"]
        return ("add  %s,%s" % (ix_name, rr_names[rr_idx]), 2)

    # INC/DEC IXH/IXL
    if op == 0x24:
        return ("inc  %sh" % ix_name, 2)
    if op == 0x25:
        return ("dec  %sh" % ix_name, 2)
    if op == 0x2C:
        return ("inc  %sl" % ix_name, 2)
    if op == 0x2D:
        return ("dec  %sl" % ix_name, 2)

    # LD IXH,n / LD IXL,n
    if op == 0x26:
        n = byte_at(2)
        return ("ld   %sh,$%02X" % (ix_name, n), 3)
    if op == 0x2E:
        n = byte_at(2)
        return ("ld   %sl,$%02X" % (ix_name, n), 3)

    # INC/DEC (IX+d)
    if op == 0x34:
        d = signed8(byte_at(2))
        disp = "+$%02X" % d if d >= 0 else "-$%02X" % (-d)
        return ("inc  (%s%s)" % (ix_name, disp), 3)
    if op == 0x35:
        d = signed8(byte_at(2))
        disp = "+$%02X" % d if d >= 0 else "-$%02X" % (-d)
        return ("dec  (%s%s)" % (ix_name, disp), 3)

    # LD (IX+d),n
    if op == 0x36:
        d = signed8(byte_at(2))
        n = byte_at(3)
        disp = "+$%02X" % d if d >= 0 else "-$%02X" % (-d)
        return ("ld   (%s%s),$%02X" % (ix_name, disp, n), 4)

    # LD r,(IX+d) -- opcodes 0x46, 0x4E, 0x56, 0x5E, 0x66, 0x6E, 0x7E
    if (op & 0xC7) == 0x46 and (op & 0x40) == 0x40 and op != 0x76:
        r_idx = (op >> 3) & 7
        if r_idx != 6:
            d = signed8(byte_at(2))
            disp = "+$%02X" % d if d >= 0 else "-$%02X" % (-d)
            return ("ld   %s,(%s%s)" % (REG8[r_idx], ix_name, disp), 3)

    # LD (IX+d),r -- opcodes 0x70-0x77 (except 0x76 = halt)
    if (op & 0xF8) == 0x70 and op != 0x76:
        r_idx = op & 7
        d = signed8(byte_at(2))
        disp = "+$%02X" % d if d >= 0 else "-$%02X" % (-d)
        return ("ld   (%s%s),%s" % (ix_name, disp, REG8[r_idx]), 3)

    # ALU A,(IX+d)
    if (op & 0xC7) == 0x86:
        alu_idx = (op >> 3) & 7
        alu = ALU_OPS[alu_idx]
        d = signed8(byte_at(2))
        disp = "+$%02X" % d if d >= 0 else "-$%02X" % (-d)
        operand = "(%s%s)" % (ix_name, disp)
        if alu in ("add", "adc", "sbc"):
            return ("%s  a,%s" % (alu, operand), 3)
        return ("%-4s %s" % (alu, operand), 3)

    # POP IX / PUSH IX
    if op == 0xE1:
        return ("pop  %s" % ix_name, 2)
    if op == 0xE5:
        return ("push %s" % ix_name, 2)

    # JP (IX)
    if op == 0xE9:
        return ("jp   (%s)" % ix_name, 2)

    # EX (SP),IX
    if op == 0xE3:
        return ("ex   (sp),%s" % ix_name, 2)

    # LD SP,IX
    if op == 0xF9:
        return ("ld   sp,%s" % ix_name, 2)

    # LD between IXH/IXL and other regs
    if (op & 0xC0) == 0x40:
        dst_idx = (op >> 3) & 7
        src_idx = op & 7
        # If either is 6 (would be (HL)), it becomes (IX+d) handled above
        if dst_idx != 6 and src_idx != 6:
            dst = ix_reg8(dst_idx)
            src = ix_reg8(src_idx)
            if dst and src:
                return ("ld   %s,%s" % (dst, src), 2)

    return None


def decode_instruction(rom, pc, max_addr):
    """Decode a Z80 instruction at the given PC.
    Returns (mnemonic_str, byte_count) or None."""
    if pc >= max_addr:
        return None
    op = rom[pc]

    if op == 0xCB:
        return decode_cb(rom, pc, max_addr)
    elif op == 0xED:
        return decode_ed(rom, pc, max_addr)
    elif op in (0xDD, 0xFD):
        return decode_dd_fd(rom, pc, max_addr, op)
    else:
        return decode_unprefixed(rom, pc, max_addr)


# ---------------------------------------------------------------------------
# Tunstall disassembly parser
# ---------------------------------------------------------------------------

# Regex for instruction lines like: "0000: 00          nop"
# Captures: addr, hex_bytes, mnemonic+operands
INSTR_RE = re.compile(
    r"^([0-9A-Fa-f]{4}):\s+"  # address
    r"((?:[0-9A-Fa-f]{2}\s)+)"  # hex bytes (at least one)
    r"\s+"  # gap
    r"(\S+)"  # mnemonic
    r"(?:\s+(\S+(?:\s*,\s*\S+)*))?"  # optional operands
)

# Regex for data-only lines like: "0021:  43 6F 6E 67 ..."
DATA_LINE_RE = re.compile(r"^([0-9A-Fa-f]{4}):\s+" r"((?:[0-9A-Fa-f]{2}\s)+)")

# Regex for bare data lines (continuation of data, no address colon pattern with mnemonic)
BARE_DATA_RE = re.compile(r"^\s+([0-9A-Fa-f]{2}(?:\s+[0-9A-Fa-f]{2})*)\s*(?:;.*)?$")

# Label lines
LABEL_RE = re.compile(r"^([A-Za-z_][A-Za-z0-9_#.*]*):")


def normalize_mnemonic(mnemonic, operands):
    """Normalize mnemonic + operands for comparison."""
    m = mnemonic.lower().strip()
    if operands:
        ops = operands.lower().strip()
        # Remove comments (anything after ;)
        if ";" in ops:
            ops = ops[: ops.index(";")].strip()
        return m, ops
    return m, ""


def parse_tunstall(filepath):
    """Parse the Tunstall disassembly file.
    Returns a list of dicts with keys: addr, hex_bytes, mnemonic, operands, line_num, is_data, label
    Also returns a dict of labels: {addr: label_name}
    """
    instructions = []
    labels = {}
    current_label = None

    with open(filepath, "r") as f:
        lines = f.readlines()

    for line_num_0, line in enumerate(lines):
        line_num = line_num_0 + 1
        # Skip lines before line 529 (EQU definitions, etc)
        if line_num < 529:
            # But capture labels
            lm = LABEL_RE.match(line.strip())
            if lm:
                current_label = lm.group(1)
            continue

        stripped = line.rstrip()
        if not stripped:
            continue

        # Check for label
        lm = LABEL_RE.match(stripped)
        if lm:
            current_label = lm.group(1)
            continue

        # Check for comment-only or non-code lines
        if (
            stripped.startswith(";")
            or stripped.startswith("//")
            or stripped.startswith("/*")
            or stripped.startswith("*")
        ):
            continue

        # Check for data line with address first (before instruction matching).
        # Data lines typically have many hex bytes (>4) followed by ASCII rendering.
        # Pattern: "ADDR:  HH HH HH HH HH HH HH HH  ASCII text"
        dm = DATA_LINE_RE.match(stripped)
        if dm:
            addr = int(dm.group(1), 16)
            hex_str = dm.group(2).strip()
            hex_bytes_list = hex_str.split()
            rest = stripped[dm.end() :].strip()

            # Heuristic: if there are 5+ hex bytes, it is almost certainly data
            # (Z80 instructions are at most 4 bytes). Also treat as data if the
            # remaining text looks like ASCII rendering (printable chars).
            is_data_line = False
            if len(hex_bytes_list) >= 5:
                is_data_line = True
            elif not rest or rest[0] in (";", "/", "*"):
                # No mnemonic follows, or only a comment
                is_data_line = True

            if is_data_line:
                hex_bytes = [int(b, 16) for b in hex_bytes_list]
                entry = {
                    "addr": addr,
                    "hex_bytes": hex_bytes,
                    "mnemonic": ".data",
                    "operands": "",
                    "line_num": line_num,
                    "is_data": True,
                    "label": current_label,
                }
                instructions.append(entry)
                if current_label:
                    labels[addr] = current_label
                    current_label = None
                continue

        # Try matching instruction line
        m = INSTR_RE.match(stripped)
        if m:
            addr = int(m.group(1), 16)
            hex_str = m.group(2).strip()
            hex_bytes = [int(b, 16) for b in hex_str.split()]
            mnemonic = m.group(3)
            operands = m.group(4) if m.group(4) else ""

            # Clean operands: remove comments
            if ";" in operands:
                operands = operands[: operands.index(";")].strip()

            entry = {
                "addr": addr,
                "hex_bytes": hex_bytes,
                "mnemonic": mnemonic.lower(),
                "operands": operands.lower().strip(),
                "line_num": line_num,
                "is_data": False,
                "label": current_label,
            }
            instructions.append(entry)
            if current_label:
                labels[addr] = current_label
                current_label = None
            continue

        # Bare data lines (indented hex only)
        bm = BARE_DATA_RE.match(stripped)
        if bm:
            # These are continuation data, we skip since they don't have an address
            continue

    return instructions, labels


# ---------------------------------------------------------------------------
# ROM regions
# ---------------------------------------------------------------------------

ROM_REGIONS = [
    (0x0000, 0x0800, "ROM0"),
    # 0x0800-0x0FFF is RAM (gap)
    (0x1000, 0x1800, "ROM1"),
    (0x1800, 0x2000, "ROM2"),
    (0x2000, 0x2800, "ROM3"),
    (0x2800, 0x3000, "ROM4"),
    (0x3000, 0x3800, "ROM5"),
    # 0x3800-0x3FFF is unpopulated
]


def is_rom_address(addr):
    """Check if address falls within a ROM region."""
    for start, end, _ in ROM_REGIONS:
        if start <= addr < end:
            return True
    return False


def get_rom_region(addr):
    for start, end, name in ROM_REGIONS:
        if start <= addr < end:
            return name
    return None


# ---------------------------------------------------------------------------
# Main analysis
# ---------------------------------------------------------------------------


def main():
    rom_path = "/tmp/berzerk_flat.bin"
    asm_path = "/Users/sudnya/checkout/smi/gfx-challenge/cdoc/berzerk_tunstall.asm"
    output_path = (
        "/Users/sudnya/checkout/smi/gfx-challenge/cdoc/subroutine_entry_points.txt"
    )

    # Load ROM
    if not os.path.exists(rom_path):
        print("ERROR: ROM file not found: %s" % rom_path)
        sys.exit(1)
    with open(rom_path, "rb") as f:
        rom = f.read()
    rom_size = len(rom)
    print("ROM loaded: %d bytes (%d KB)" % (rom_size, rom_size // 1024))

    # Parse Tunstall disassembly
    if not os.path.exists(asm_path):
        print("ERROR: Disassembly file not found: %s" % asm_path)
        sys.exit(1)
    instructions, labels = parse_tunstall(asm_path)
    print(
        "Tunstall disassembly parsed: %d instruction/data entries, %d labels"
        % (len(instructions), len(labels))
    )

    # -----------------------------------------------------------------------
    # Step 1: Verify hex bytes against ROM
    # -----------------------------------------------------------------------
    total_checked = 0
    byte_matches = 0
    byte_mismatches = []
    skipped_ram = 0
    skipped_out_of_range = 0

    for entry in instructions:
        addr = entry["addr"]
        hex_bytes = entry["hex_bytes"]
        nbytes = len(hex_bytes)

        # Skip RAM gap and unpopulated regions
        if not is_rom_address(addr):
            skipped_ram += 1
            continue

        # Check if all bytes are within ROM range
        if addr + nbytes > rom_size:
            skipped_out_of_range += 1
            continue

        total_checked += 1
        rom_bytes = list(rom[addr : addr + nbytes])
        if rom_bytes == hex_bytes:
            byte_matches += 1
        else:
            byte_mismatches.append(
                {
                    "addr": addr,
                    "line": entry["line_num"],
                    "tunstall": hex_bytes,
                    "rom": rom_bytes,
                    "mnemonic": entry["mnemonic"],
                }
            )

    # -----------------------------------------------------------------------
    # Step 2: Independent instruction decode verification
    # -----------------------------------------------------------------------
    decode_checked = 0
    decode_matches = 0
    decode_mismatches = []
    decode_failures = []

    for entry in instructions:
        if entry["is_data"]:
            continue
        addr = entry["addr"]
        if not is_rom_address(addr):
            continue
        if addr >= rom_size:
            continue

        decode_checked += 1
        result = decode_instruction(rom, addr, min(rom_size, addr + 8))
        if result is None:
            decode_failures.append(
                {
                    "addr": addr,
                    "line": entry["line_num"],
                    "tunstall_mnemonic": entry["mnemonic"],
                    "tunstall_operands": entry["operands"],
                    "rom_byte": rom[addr] if addr < rom_size else None,
                }
            )
            continue

        decoded_str, decoded_len = result

        # Parse decoded string into mnemonic + operands
        parts = decoded_str.split(None, 1)
        dec_mnemonic = parts[0].strip().lower()
        dec_operands = parts[1].strip().lower() if len(parts) > 1 else ""

        # Normalize for comparison
        tun_m = entry["mnemonic"].strip()
        tun_o = entry["operands"].strip().rstrip(",")
        # Remove extra whitespace in operands
        dec_operands = re.sub(r"\s+", "", dec_operands)
        tun_o_norm = re.sub(r"\s+", "", tun_o)

        if dec_mnemonic == tun_m and dec_operands == tun_o_norm:
            decode_matches += 1
        else:
            decode_mismatches.append(
                {
                    "addr": addr,
                    "line": entry["line_num"],
                    "tunstall": "%s %s" % (tun_m, tun_o),
                    "decoded": "%s %s" % (dec_mnemonic, dec_operands),
                    "rom_bytes": list(rom[addr : addr + decoded_len]),
                }
            )

    # -----------------------------------------------------------------------
    # Step 3: Static analysis -- branch targets and subroutine entries
    # -----------------------------------------------------------------------
    branch_targets = set()
    call_targets = set()
    jp_targets = set()
    data_refs = set()

    # Known entry points
    known_entries = {
        0x0000: "RESET",
        0x0066: "NMI_HANDLER",
    }

    # Walk all instruction entries from Tunstall for branch/call targets
    for entry in instructions:
        if entry["is_data"]:
            continue
        m = entry["mnemonic"]
        o = entry["operands"]

        # Extract target address from operands
        target_match = re.search(r"\$([0-9a-fA-F]{4})", o)
        target = int(target_match.group(1), 16) if target_match else None

        if target is not None:
            if m == "call" or m.startswith("call"):
                call_targets.add(target)
                branch_targets.add(target)
            elif m == "jp" or m.startswith("jp"):
                jp_targets.add(target)
                branch_targets.add(target)
            elif m == "jr" or m.startswith("jr"):
                branch_targets.add(target)
            elif m == "djnz":
                branch_targets.add(target)

        if m == "rst":
            rst_match = re.search(r"\$([0-9a-fA-F]{2})", o)
            if rst_match:
                rst_target = int(rst_match.group(1), 16)
                call_targets.add(rst_target)
                branch_targets.add(rst_target)

    # Also do an independent scan of the ROM for CALL/JP/JR/RST instructions
    pc = 0
    while pc < rom_size:
        if not is_rom_address(pc):
            pc += 1
            continue
        result = decode_instruction(rom, pc, rom_size)
        if result is None:
            pc += 1
            continue
        decoded_str, decoded_len = result
        parts = decoded_str.split(None, 1)
        mnemonic = parts[0].lower()
        operands = parts[1].lower() if len(parts) > 1 else ""

        target_match = re.search(r"\$([0-9a-f]{4})", operands)
        target = int(target_match.group(1), 16) if target_match else None

        if target is not None:
            if "call" in mnemonic or mnemonic == "call":
                call_targets.add(target)
                branch_targets.add(target)
            elif "jp" in mnemonic or mnemonic == "jp":
                jp_targets.add(target)
                branch_targets.add(target)
            elif "jr" in mnemonic or mnemonic == "jr":
                branch_targets.add(target)
            elif "djnz" in mnemonic:
                branch_targets.add(target)

        if mnemonic == "rst":
            rst_match = re.search(r"\$([0-9a-f]{2})", operands)
            if rst_match:
                rst_target = int(rst_match.group(1), 16)
                call_targets.add(rst_target)
                branch_targets.add(rst_target)

        pc += decoded_len

    # Build subroutine entry points (known entries take priority over parsed labels)
    subroutine_entries = OrderedDict()
    for addr, name in sorted(known_entries.items()):
        subroutine_entries[addr] = name
    for addr in sorted(call_targets):
        if addr not in subroutine_entries:
            name = labels.get(addr, "")
            subroutine_entries[addr] = name

    # Override parsed labels with known entry names where applicable
    for addr, name in known_entries.items():
        if addr in labels and labels[addr] != name:
            labels[addr] = name

    # -----------------------------------------------------------------------
    # Step 4: Identify data regions
    # -----------------------------------------------------------------------
    data_regions = []
    for entry in instructions:
        if entry["is_data"]:
            data_regions.append(
                {
                    "addr": entry["addr"],
                    "size": len(entry["hex_bytes"]),
                    "line": entry["line_num"],
                    "label": entry["label"],
                }
            )

    # -----------------------------------------------------------------------
    # Output report
    # -----------------------------------------------------------------------
    print()
    print("=" * 72)
    print("VERIFICATION REPORT")
    print("=" * 72)

    print()
    print("--- Byte Verification (Tunstall hex vs ROM binary) ---")
    print("  Total entries checked:  %d" % total_checked)
    print("  Byte matches:           %d" % byte_matches)
    print("  Byte mismatches:        %d" % len(byte_mismatches))
    print("  Skipped (RAM gap):      %d" % skipped_ram)
    print("  Skipped (out of range): %d" % skipped_out_of_range)

    if byte_mismatches:
        print()
        print("  MISMATCHES:")
        for mm in byte_mismatches[:50]:
            tun_hex = " ".join("%02X" % b for b in mm["tunstall"])
            rom_hex = " ".join("%02X" % b for b in mm["rom"])
            print(
                "    0x%04X (line %d): Tunstall=[%s] ROM=[%s] (%s)"
                % (mm["addr"], mm["line"], tun_hex, rom_hex, mm["mnemonic"])
            )
        if len(byte_mismatches) > 50:
            print("    ... and %d more" % (len(byte_mismatches) - 50))

    print()
    print("--- Instruction Decode Verification ---")
    print("  Instructions decoded:   %d" % decode_checked)
    print("  Decode matches:         %d" % decode_matches)
    print("  Decode mismatches:      %d" % len(decode_mismatches))
    print("  Decode failures:        %d" % len(decode_failures))

    if decode_mismatches:
        print()
        print("  DECODE MISMATCHES (first 50):")
        for mm in decode_mismatches[:50]:
            rom_hex = " ".join("%02X" % b for b in mm["rom_bytes"])
            print(
                "    0x%04X (line %d): Tunstall=[%s] Decoded=[%s] ROM=[%s]"
                % (mm["addr"], mm["line"], mm["tunstall"], mm["decoded"], rom_hex)
            )
        if len(decode_mismatches) > 50:
            print("    ... and %d more" % (len(decode_mismatches) - 50))

    if decode_failures:
        print()
        print("  DECODE FAILURES (first 30):")
        for df in decode_failures[:30]:
            print(
                "    0x%04X (line %d): Tunstall=[%s %s] ROM byte=0x%02X"
                % (
                    df["addr"],
                    df["line"],
                    df["tunstall_mnemonic"],
                    df["tunstall_operands"],
                    df["rom_byte"] if df["rom_byte"] is not None else 0,
                )
            )
        if len(decode_failures) > 30:
            print("    ... and %d more" % (len(decode_failures) - 30))

    print()
    print("=" * 72)
    print("SUBROUTINE ENTRY POINTS (%d found)" % len(subroutine_entries))
    print("=" * 72)
    for addr, name in sorted(subroutine_entries.items()):
        label = labels.get(addr, name)
        if label:
            print("  0x%04X  %s" % (addr, label))
        else:
            print("  0x%04X" % addr)

    print()
    print("=" * 72)
    print("BRANCH TARGETS / BASIC BLOCK BOUNDARIES (%d found)" % len(branch_targets))
    print("=" * 72)
    sorted_targets = sorted(branch_targets)
    for i, addr in enumerate(sorted_targets):
        label = labels.get(addr, "")
        region = get_rom_region(addr)
        if region:
            loc = " [%s]" % region
        elif 0x0800 <= addr < 0x1000:
            loc = " [RAM]"
        elif addr >= 0x3800:
            loc = " [beyond ROM]"
        else:
            loc = ""

        kind = ""
        if addr in call_targets:
            kind = " (CALL target)"
        elif addr in jp_targets:
            kind = " (JP target)"
        else:
            kind = " (JR/DJNZ target)"

        if label:
            print("  0x%04X  %-40s%s%s" % (addr, label, kind, loc))
        else:
            print("  0x%04X%s%s" % (addr, kind, loc))

    print()
    print("=" * 72)
    print("DATA REGIONS IDENTIFIED (%d entries)" % len(data_regions))
    print("=" * 72)
    if data_regions:
        for dr in data_regions[:100]:
            label_str = ("  [%s]" % dr["label"]) if dr["label"] else ""
            print(
                "  0x%04X  %d bytes  (line %d)%s"
                % (dr["addr"], dr["size"], dr["line"], label_str)
            )
        if len(data_regions) > 100:
            print("  ... and %d more" % (len(data_regions) - 100))

    # -----------------------------------------------------------------------
    # Write subroutine entry points file
    # -----------------------------------------------------------------------
    with open(output_path, "w") as f:
        for addr, name in sorted(subroutine_entries.items()):
            label = labels.get(addr, name)
            if label:
                f.write("0x%04X %s\n" % (addr, label))
            else:
                f.write("0x%04X\n" % addr)

    print()
    print("Subroutine entry points written to: %s" % output_path)
    print("Done.")


if __name__ == "__main__":
    main()
