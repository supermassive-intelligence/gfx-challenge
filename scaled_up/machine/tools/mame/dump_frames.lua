--[[ dump_frames.lua -- dump VRAM+colorRAM at several frames in one run.
     Env: MAME_DUMP_FRAMES (comma list), MAME_DUMP_PREFIX (out path prefix; file = prefix..frame..".bin"). ]]
local frames_env = os.getenv("MAME_DUMP_FRAMES")
local prefix = os.getenv("MAME_DUMP_PREFIX")
local want = {}
local maxf = 0
for f in frames_env:gmatch("%d+") do local n = tonumber(f); want[n] = true; if n > maxf then maxf = n end end

local cpu = manager.machine.devices[":maincpu"]
local progspace = cpu.spaces["program"] or cpu.spaces[1]
local cur = 0
_G.DUMPS_SUB = emu.add_machine_frame_notifier(function()
    if want[cur] then
        local fout = io.open(prefix .. cur .. ".bin", "wb")
        for addr = 0x4000, 0x5fff do fout:write(string.char(progspace:read_u8(addr))) end
        for addr = 0x8000, 0x87ff do fout:write(string.char(progspace:read_u8(addr))) end
        fout:close()
        print("dump_frames: wrote frame " .. cur)
    end
    if cur >= maxf then print("dump_frames: done"); manager.machine:exit() end
    cur = cur + 1
end)
