--[[
  replay_hash_visible.lua -- per-frame hash of VISIBLE VRAM rows only + colorRAM.
  Visible VRAM = rows 0-223 = 0x4000-0x5BFF (7168 bytes); off-screen scratch
  (0x5C00-0x5FFF, rows 224-255) is excluded. colorRAM = 0x8000-0x87FF.
  Matches tools/replay_hash_visible.js. FNV-1a 32-bit. Cold reset, no input.
  Env: MAME_INPUT_SCRIPT (for header.frames), MAME_HASH_OUT.
]]
local input_path = os.getenv("MAME_INPUT_SCRIPT")
local hash_path  = os.getenv("MAME_HASH_OUT")
if not input_path or not hash_path then
    print("ERROR: MAME_INPUT_SCRIPT and MAME_HASH_OUT must be set")
    manager.machine:exit(); return
end

-- read frame count from the header line
local total_frames = math.huge
local fin = io.open(input_path, "r")
for line in fin:lines() do
    local fr = line:match('"frames"%s*:%s*(%d+)')
    if fr then total_frames = tonumber(fr); break end
end
fin:close()

local function fnv1a32(data)
    local hash = 0x811c9dc5
    for i = 1, #data do
        hash = (hash ~ data:byte(i)) & 0xffffffff
        hash = (hash * 0x01000193) & 0xffffffff
    end
    return hash
end

local cpu = manager.machine.devices[":maincpu"]
local progspace = cpu.spaces["program"] or cpu.spaces[1]

local function visible_bytes()
    local b = {}
    for addr = 0x4000, 0x5bff do b[#b + 1] = string.char(progspace:read_u8(addr)) end
    for addr = 0x8000, 0x87ff do b[#b + 1] = string.char(progspace:read_u8(addr)) end
    return table.concat(b)
end

local fout = io.open(hash_path, "w")
local cur_frame = 0
_G.VISHASH_SUB = emu.add_machine_frame_notifier(function()
    fout:write(string.format("%d,0x%08x\n", cur_frame, fnv1a32(visible_bytes())))
    cur_frame = cur_frame + 1
    if cur_frame >= total_frames then
        fout:close(); print("replay_hash_visible: done"); manager.machine:exit()
    end
end)
print(string.format("replay_hash_visible: %d frames -> %s", total_frames, hash_path))
