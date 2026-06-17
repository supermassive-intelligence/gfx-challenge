--[[
  sync_capture.lua -- MAME-side register-state capture at the per-frame IRQ sync point.

  Method (Sudnya's sync-point decision): cold reset, no input. Capture the full
  Z80 register state at every entry to PC=0x26D9 (BOTTOM_OF_SCREEN_INTERRUPT, the
  once-per-frame end-of-frame IRQ handler) by installing a READ tap on program
  space at 0x26D9 -- the tap fires on the opcode fetch of the instruction there,
  i.e. before it executes, so registers are the IRQ-entry foreground state. This
  is the MAME oracle counterpart to cosim_capture_js.js; output format matches.

  Debugger-free: uses a memory read tap (same pattern as speechlog.lua), not the
  -debug instruction hook, so no pause-on-launch.

  Env:
    MAME_SYNC_OUT     output JSONL path (required)
    MAME_SYNC_FRAMES  number of video frames to run before exit (default 1200)
]]

local out_path = os.getenv("MAME_SYNC_OUT")
local total_frames = tonumber(os.getenv("MAME_SYNC_FRAMES") or "1200")

if not out_path then
    print("ERROR: MAME_SYNC_OUT must be set")
    manager.machine:exit()
    return
end

local fout = io.open(out_path, "w")
if not fout then
    print("ERROR: cannot open output file: " .. out_path)
    manager.machine:exit()
    return
end

local cpu = manager.machine.devices[":maincpu"]
local progspace = cpu.spaces["program"] or cpu.spaces[1]

-- Resolve a CPU debug-state value by symbol, returning nil if absent.
local function reg(sym)
    local item = cpu.state[sym]
    if item == nil then return nil end
    return item.value
end

-- Discover the actual state-symbol spelling once (MAME spells the shadow set
-- "AF2"/"AF'" depending on version). Probe both and pin the winners.
local SH = { af = nil, bc = nil, de = nil, hl = nil }
for _, cand in ipairs({ "AF2", "AF'" }) do if cpu.state[cand] then SH.af = cand break end end
for _, cand in ipairs({ "BC2", "BC'" }) do if cpu.state[cand] then SH.bc = cand break end end
for _, cand in ipairs({ "DE2", "DE'" }) do if cpu.state[cand] then SH.de = cand break end end
for _, cand in ipairs({ "HL2", "HL'" }) do if cpu.state[cand] then SH.hl = cand break end end

local function hex(v) return v or -1 end

-- Frame counter, advanced by the machine frame notifier.
local cur_frame = 0
_G.SYNC_FRAME_SUB = emu.add_machine_frame_notifier(function()
    cur_frame = cur_frame + 1
    if cur_frame >= total_frames then
        fout:close()
        print("sync_capture: done -- wrote register snapshots to " .. out_path)
        manager.machine:exit()
    end
end)

-- Read tap at the IRQ handler entry. Fires on the opcode fetch at 0x26D9.
local n = 0
_G.SYNC_TAP = progspace:install_read_tap(0x26d9, 0x26d9, "synccap", function(offset, data, mask)
    local sp = reg("SP") or 0
    local ret = progspace:read_u16(sp)  -- foreground PC pushed by the IRQ ack
    local rec = string.format(
        '{"af":%d,"bc":%d,"de":%d,"hl":%d,"ix":%d,"iy":%d,"sp":%d,' ..
        '"af_":%d,"bc_":%d,"de_":%d,"hl_":%d,"i":%d,"r":%d,"ret":%d,"n":%d,"frame":%d}\n',
        hex(reg("AF")), hex(reg("BC")), hex(reg("DE")), hex(reg("HL")),
        hex(reg("IX")), hex(reg("IY")), hex(reg("SP")),
        hex(SH.af and reg(SH.af)), hex(SH.bc and reg(SH.bc)),
        hex(SH.de and reg(SH.de)), hex(SH.hl and reg(SH.hl)),
        hex(reg("I")), hex(reg("R")), ret, n, cur_frame)
    fout:write(rec)
    n = n + 1
    -- read tap: do not return a value (leave the fetched byte unchanged)
end)

print(string.format("sync_capture: tap on 0x26D9 installed; running %d frames; shadow=%s/%s/%s/%s",
    total_frames, tostring(SH.af), tostring(SH.bc), tostring(SH.de), tostring(SH.hl)))
