--[[
  dump_frame.lua -- dump MAME VRAM+colorRAM raw bytes at a target frame.
  Env: MAME_DUMP_FRAME (target frame), MAME_DUMP_OUT (output .bin path).
  Layout matches dump_frame_js.js: 8192 bytes VRAM (0x4000-0x5FFF) then
  2048 bytes colorRAM (0x8000-0x87FF). Cold reset, no input.
  The frame counter advances in the machine frame notifier (start of frame),
  so dumping when cur_frame == target captures the same boundary as the JS
  side's per-frame hash (after runFrame for that frame).
]]
local target = tonumber(os.getenv("MAME_DUMP_FRAME"))
local out_path = os.getenv("MAME_DUMP_OUT")
if not target or not out_path then
    print("ERROR: MAME_DUMP_FRAME and MAME_DUMP_OUT must be set")
    manager.machine:exit()
    return
end

local cpu = manager.machine.devices[":maincpu"]
local progspace = cpu.spaces["program"] or cpu.spaces[1]

local cur_frame = 0
_G.DUMP_SUB = emu.add_machine_frame_notifier(function()
    if cur_frame == target then
        local fout = io.open(out_path, "wb")
        for addr = 0x4000, 0x5fff do fout:write(string.char(progspace:read_u8(addr))) end
        for addr = 0x8000, 0x87ff do fout:write(string.char(progspace:read_u8(addr))) end
        fout:close()
        print(string.format("dump_frame: wrote frame %d -> %s", target, out_path))
        manager.machine:exit()
    end
    cur_frame = cur_frame + 1
end)
