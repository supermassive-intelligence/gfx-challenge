--[[ trace_byte.lua -- log one program-space byte per frame over a window.
     Env: MAME_TRACE_ADDR (hex/dec), MAME_TRACE_LO, MAME_TRACE_HI, MAME_TRACE_OUT ]]
local addr = tonumber(os.getenv("MAME_TRACE_ADDR"))
local lo = tonumber(os.getenv("MAME_TRACE_LO"))
local hi = tonumber(os.getenv("MAME_TRACE_HI"))
local out = os.getenv("MAME_TRACE_OUT")
local cpu = manager.machine.devices[":maincpu"]
local progspace = cpu.spaces["program"] or cpu.spaces[1]
local fout = io.open(out, "w")
local cur = 0
_G.TRACE_SUB = emu.add_machine_frame_notifier(function()
    if cur >= lo and cur <= hi then
        fout:write(string.format("%d:0x%02x\n", cur, progspace:read_u8(addr)))
    end
    if cur > hi then fout:close(); print("trace_byte: done"); manager.machine:exit() end
    cur = cur + 1
end)
