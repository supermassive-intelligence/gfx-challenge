--[[
  routine_trace.lua -- MAME-side per-routine I/O capture for the T4.2 fidelity
  spot-check. The MAME oracle counterpart to machine/tools/heavy_trace_capture.js.

  For each target routine entry PC (env MAME_RT_TARGETS, comma-separated decimal),
  log one JSONL record per invocation with the SAME fields the JS heavy-trace
  emits: regs_in at entry, ordered memory/IO reads (instruction fetches INCLUDED,
  same as the JS read_set), regs_out at return, and ordered writes.

  Invocation pairing mirrors the JS tool: an invocation OPENS on the opcode fetch
  at a target entry PC and CLOSES by SP depth (when SP rises above the entry SP,
  covering ret / ret cc / reti / retn). Leaf routines only -- if an interrupt or
  a nested call perturbs SP, that record simply will not state-match a clean JS
  record and is harmlessly dropped during pairing.

  Debugger-free: memory read/write taps (same pattern as sync_capture.lua), so no
  pause-on-launch. Cold reset, no input -- matches the attract-only JS run.

  Env:
    MAME_RT_OUT      output JSONL path (required)
    MAME_RT_TARGETS  comma-separated decimal entry PCs (required)
    MAME_RT_FRAMES   video frames to run before exit (default 3085)
]]

local out_path     = os.getenv("MAME_RT_OUT")
local targets_env  = os.getenv("MAME_RT_TARGETS")
local total_frames = tonumber(os.getenv("MAME_RT_FRAMES") or "3085")

if not out_path or not targets_env then
    print("ERROR: MAME_RT_OUT and MAME_RT_TARGETS must be set")
    manager.machine:exit()
    return
end

local TARGETS = {}
local tlist = ""
for tok in string.gmatch(targets_env, "[0-9]+") do
    TARGETS[tonumber(tok)] = true
    tlist = tlist .. tok .. " "
end

local fout = io.open(out_path, "w")
if not fout then
    print("ERROR: cannot open output file: " .. out_path)
    manager.machine:exit()
    return
end

local cpu  = manager.machine.devices[":maincpu"]
local prog = cpu.spaces["program"]
local iosp = cpu.spaces["io"]

local function reg(sym)
    local it = cpu.state[sym]
    if it == nil then return -1 end
    return it.value
end

-- Shadow state-symbol spelling differs by MAME version ("AF2" vs "AF'").
local SH = {}
for _, c in ipairs({ "AF2", "AF'" }) do if cpu.state[c] then SH.af = c break end end
for _, c in ipairs({ "BC2", "BC'" }) do if cpu.state[c] then SH.bc = c break end end
for _, c in ipairs({ "DE2", "DE'" }) do if cpu.state[c] then SH.de = c break end end
for _, c in ipairs({ "HL2", "HL'" }) do if cpu.state[c] then SH.hl = c break end end

local function snapshot()
    local af  = reg("AF") & 0xffff
    local bc  = reg("BC") & 0xffff
    local de  = reg("DE") & 0xffff
    local hl  = reg("HL") & 0xffff
    local af2 = (SH.af and reg(SH.af) or 0) & 0xffff
    local bc2 = (SH.bc and reg(SH.bc) or 0) & 0xffff
    local de2 = (SH.de and reg(SH.de) or 0) & 0xffff
    local hl2 = (SH.hl and reg(SH.hl) or 0) & 0xffff
    return string.format(
        '{"a":%d,"f":%d,"b":%d,"c":%d,"d":%d,"e":%d,"h":%d,"l":%d,' ..
        '"ix":%d,"iy":%d,"sp":%d,"i":%d,"r":%d,' ..
        '"a_p":%d,"f_p":%d,"b_p":%d,"c_p":%d,"d_p":%d,"e_p":%d,"h_p":%d,"l_p":%d}',
        (af >> 8) & 0xff, af & 0xff, (bc >> 8) & 0xff, bc & 0xff,
        (de >> 8) & 0xff, de & 0xff, (hl >> 8) & 0xff, hl & 0xff,
        reg("IX") & 0xffff, reg("IY") & 0xffff, reg("SP") & 0xffff,
        reg("I") & 0xff, reg("R") & 0xff,
        (af2 >> 8) & 0xff, af2 & 0xff, (bc2 >> 8) & 0xff, bc2 & 0xff,
        (de2 >> 8) & 0xff, de2 & 0xff, (hl2 >> 8) & 0xff, hl2 & 0xff)
end

local active = nil  -- { entryPC, entrySP, regs_in, reads={}, writes={} }
local n = 0

local function finalize()
    local rec = string.format(
        '{"entryPC":%d,"entrySP":%d,"regs_in":%s,"read_set":[%s],"regs_out":%s,"write_set":[%s]}\n',
        active.entryPC, active.entrySP, active.regs_in,
        table.concat(active.reads, ","), snapshot(),
        table.concat(active.writes, ","))
    fout:write(rec)
    active = nil
    n = n + 1
end

-- READ tap over the whole program space: fires on every fetch and data read.
_G.RT_R = prog:install_read_tap(0x0000, 0xffff, "rt_r", function(offset, data, mask)
    if active then
        if (reg("SP") & 0xffff) > active.entrySP then
            finalize()
            -- fall through: this read may itself open a new invocation
        else
            active.reads[#active.reads + 1] =
                string.format('{"addr":%d,"val":%d,"type":"mem"}', offset, data & 0xff)
            return
        end
    end
    -- Open ONLY on a genuine opcode fetch at a target (PC == fetch address);
    -- a data read that merely touches the address (e.g. the POST ROM checksum
    -- reading the routine's bytes) has PC != offset and must NOT open a frame.
    if (not active) and TARGETS[offset] and (reg("PC") & 0xffff) == offset then
        active = { entryPC = offset, entrySP = reg("SP") & 0xffff,
                   regs_in = snapshot(), reads = {}, writes = {} }
        active.reads[1] =
            string.format('{"addr":%d,"val":%d,"type":"mem"}', offset, data & 0xff)
    end
end)

-- WRITE tap over the whole program space: routine's own writes (incl. stack).
_G.RT_W = prog:install_write_tap(0x0000, 0xffff, "rt_w", function(offset, data, mask)
    if active and (reg("SP") & 0xffff) <= active.entrySP then
        active.writes[#active.writes + 1] =
            string.format('{"addr":%d,"val":%d,"type":"mem"}', offset, data & 0xff)
    end
end)

-- IO taps (tagged type:"io"); our targets do none, but capture so none is missed.
if iosp then
    _G.RT_IOR = iosp:install_read_tap(0x0000, 0x00ff, "rt_ior", function(offset, data, mask)
        if active and (reg("SP") & 0xffff) <= active.entrySP then
            active.reads[#active.reads + 1] =
                string.format('{"addr":%d,"val":%d,"type":"io"}', offset, data & 0xff)
        end
    end)
    _G.RT_IOW = iosp:install_write_tap(0x0000, 0x00ff, "rt_iow", function(offset, data, mask)
        if active and (reg("SP") & 0xffff) <= active.entrySP then
            active.writes[#active.writes + 1] =
                string.format('{"addr":%d,"val":%d,"type":"io"}', offset, data & 0xff)
        end
    end)
end

local cur_frame = 0
_G.RT_FRAME = emu.add_machine_frame_notifier(function()
    cur_frame = cur_frame + 1
    if cur_frame >= total_frames then
        if active then finalize() end
        fout:close()
        print(string.format("routine_trace: done -- %d invocations over %d frames -> %s",
            n, total_frames, out_path))
        manager.machine:exit()
    end
end)

print(string.format("routine_trace: targets=[ %s]; running %d frames; shadow=%s/%s/%s/%s",
    tlist, total_frames, tostring(SH.af), tostring(SH.bc), tostring(SH.de), tostring(SH.hl)))
