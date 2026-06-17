--[[
  Berzerk input-script replay + CPU Tracer for Mzerk (Phase 3, T3.2)
]]

-- -----------------------------------------------------------------
-- Minimal inline JSON decoder (handles flat objects only).
-- -----------------------------------------------------------------
local function decode(line)
    local obj = {}
    -- String values: "key":"value"
    for k, v in line:gmatch('"([^"]+)"%s*:%s*"([^"]*)"') do
        obj[k] = v
    end
    -- Numeric values: "key":number
    for k, v in line:gmatch('"([^"]+)"%s*:%s*(%-?%d+%.?%d*)') do
        if obj[k] == nil then
            obj[k] = tonumber(v)
        end
    end
    -- Nested dips object: "dips":{"Port.Field":"setting",...}
    local dips_str = line:match('"dips"%s*:%s*({[^}]*})')
    local dips = {}
    if dips_str then
        for k, v in dips_str:gmatch('"([^"]+)"%s*:%s*"([^"]*)"') do
            dips[k] = v
        end
    end
    obj.dips = dips
    return obj
end

-- -----------------------------------------------------------------
-- FNV-1a 32-bit.
-- -----------------------------------------------------------------
local function fnv1a32(data)
    local hash = 0x811c9dc5
    for i = 1, #data do
        hash = (hash ~ data:byte(i)) & 0xffffffff
        hash = (hash * 0x01000193) & 0xffffffff
    end
    return hash
end

-- -----------------------------------------------------------------
-- Read environment variables
-- -----------------------------------------------------------------
local input_path = os.getenv("MAME_INPUT_SCRIPT")
local hash_path  = os.getenv("MAME_HASH_OUT")
local trace_path = "mame_trace_240_245.txt"

if not input_path or not hash_path then
    print("ERROR: MAME_INPUT_SCRIPT and MAME_HASH_OUT must be set")
    manager.machine:exit()
    return
end

-- -----------------------------------------------------------------
-- Parse the JSONL file
-- -----------------------------------------------------------------
local fin = io.open(input_path, "r")
if not fin then
    print("ERROR: Cannot open input script: " .. input_path)
    manager.machine:exit()
    return
end

local header  = nil
local records = {}

for line in fin:lines() do
    if line:match("%S") then
        local obj = decode(line)
        if obj.type == "header" then
            header = obj
        elseif obj.type == "input" then
            table.insert(records, obj)
        end
    end
end
fin:close()

if not header then
    print("ERROR: No header record found in " .. input_path)
    manager.machine:exit()
    return
end

-- -----------------------------------------------------------------
-- Open the hash and trace output files
-- -----------------------------------------------------------------
local fout = io.open(hash_path, "w")
if not fout then
    print("ERROR: Cannot open hash output file: " .. hash_path)
    manager.machine:exit()
    return
end

local ftrace = io.open(trace_path, "w")
if not ftrace then
    print("ERROR: Cannot open trace output file: " .. trace_path)
    manager.machine:exit()
    return
end

-- -----------------------------------------------------------------
-- Resolve the main CPU program address space
-- -----------------------------------------------------------------
local cpu = manager.machine.devices[":maincpu"]
local progspace = cpu.spaces["program"] or cpu.spaces[1]

local function video_bytes()
    local bytes = {}
    for addr = 0x4000, 0x5fff do
        bytes[#bytes + 1] = string.char(progspace:read_u8(addr))
    end
    for addr = 0x8000, 0x87ff do
        bytes[#bytes + 1] = string.char(progspace:read_u8(addr))
    end
    return table.concat(bytes)
end

-- -----------------------------------------------------------------
-- ioport lookup table
-- -----------------------------------------------------------------
local ports = manager.machine.ioport.ports

-- -----------------------------------------------------------------
-- Per-frame callback.
-- -----------------------------------------------------------------
local cur_frame    = 0
local rec_idx      = 1
local total_frames = header.frames or math.huge

_G.REPLAY_FRAME_SUB = emu.add_machine_frame_notifier(function()
    -- Apply pending input changes for this frame
    while rec_idx <= #records and records[rec_idx].frame == cur_frame do
        local r = records[rec_idx]
        local port = ports[r.port]
        if port then
            local field = port.fields[r.field]
            if field then
                field:set_value(r.value)
            end
        end
        rec_idx = rec_idx + 1
    end

    -- Hash video memory and write result
    local hash = fnv1a32(video_bytes())
    fout:write(string.format("%d,0x%08x\n", cur_frame, hash))

    -- CPU TRACE: Log PC at start of frame for the divergence window
    if cur_frame >= 240 and cur_frame < 245 then
        local pc = nil
        -- Try various common MAME Lua PC accessors
        local success, val = pcall(function() return cpu:pc() end)
        if success then pc = val end

        if pc == nil then
            local success2, val2 = pcall(function() return cpu.pc end)
            if success2 then pc = val2 end
        end

        if pc ~= nil then
            ftrace:write(string.format("Frame %d: PC=0x%04x\n", cur_frame, pc))
        else
            ftrace:write(string.format("Frame %d: PC=UNKNOWN\n", cur_frame))
        end
    end

    cur_frame = cur_frame + 1
    if cur_frame >= total_frames then
        fout:close()
        ftrace:close()
        print("Replay finished -- hashes and trace written.")
        manager.machine:exit()
    end
end)

print(string.format(
    "Starting Berzerk replay with tracing -- script: %s  frames: %s",
    input_path, tostring(total_frames)
))
