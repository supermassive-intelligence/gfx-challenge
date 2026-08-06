-- speechlog.lua — log Berzerk S14001A speech/sound port writes with timestamps,
-- so the address<->sound mapping for the T2.8 sample manifest falls out
-- mechanically: you hear a phrase, the log shows the word address at that moment.
--
-- Run:
--   mame berzerk -rompath ~/checkout/smi/gfx-challenge/rom \
--        -autoboot_script machine/tools/mame/speechlog.lua -window
-- (pair with audio: add -wavwrite berzerk_capture.wav to record sound too.)
--
-- Output: prints to stdout AND appends to speechlog.txt in the cwd.
-- Each speech word-load line is what you want for the manifest:
--   t=12.34  SPEECH word=0x12 (18)      <- you heard "intruder alert" here
--
-- Berzerk audio ports (io map L700): 0x40-0x47 = audio_r/audio_w.
-- The S14001A word/command port is 0x44 (per hardware-berzerk.md §7):
--   mode bits (top 2 of data) 0 = load+speak 6-bit word address (data & 0x3f),
--   1 = set volume/clock. We log every 0x40-0x47 write but call out 0x44 mode 0.

local PORT_LO, PORT_HI = 0x40, 0x47
local SPEECH_PORT = 0x44

local logfile = io.open("speechlog.txt", "w")
local function emit(s)
  print(s)
  if logfile then logfile:write(s .. "\n"); logfile:flush() end
end

emit("# Berzerk speech/sound port log")
emit(string.format("# MAME %s", emu.app_version and emu.app_version() or "?"))
emit("# columns: t=<seconds>  <KIND>  details")

local function now()
  -- machine time in seconds, for correlating with what you hear
  return manager.machine.time:as_double()
end

local cpu = manager.machine.devices[":maincpu"]
-- Z80 I/O address space. Name is "io" in modern MAME; fall back to index 2.
local iospace = cpu.spaces["io"] or cpu.spaces[2]

-- IMPORTANT: keep a GLOBAL reference to the returned pass-through handler.
-- If it is garbage-collected, MAME dereferences freed memory and segfaults.
-- Also: a WRITE tap must NOT return a value (returning one is undefined here).
_G.SPEECHLOG_TAP = iospace:install_write_tap(PORT_LO, PORT_HI, "speechlog",
  function(offset, data, mask)
    local port = offset
    if port == SPEECH_PORT then
      local mode = (data >> 6) & 0x03
      if mode == 0 then
        local word = data & 0x3f
        emit(string.format("t=%8.3f  SPEECH  word=0x%02x (%d)   <-- identify this sound",
                           now(), word, word))
      elseif mode == 1 then
        emit(string.format("t=%8.3f  CTRL    vol/clock data=0x%02x", now(), data))
      else
        emit(string.format("t=%8.3f  CTRL    mode=%d data=0x%02x (unused)", now(), mode, data))
      end
    else
      emit(string.format("t=%8.3f  SFX     port=0x%02x data=0x%02x", now(), port, data))
    end
    -- no return value for a write tap
  end)

emit("# tap installed on io 0x40-0x47 (ref held in _G to avoid GC).")
emit("# Play attract + a game; speech phrases log as SPEECH lines.")
