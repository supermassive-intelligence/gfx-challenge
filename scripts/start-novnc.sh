#!/bin/bash
# Start Xvfb, x11vnc, noVNC, then run the emulator.
# The emulator's SDL window renders into the virtual framebuffer,
# which is forwarded to the browser via VNC over WebSocket.

set -e

# Virtual framebuffer: 768x672 matches 256x224 * 3x scale
Xvfb :99 -screen 0 768x672x24 &
sleep 0.5

export DISPLAY=:99

# VNC server on port 5900, no password, shared mode
x11vnc -display :99 -nopw -shared -forever -rfbport 5900 &
sleep 0.5

# noVNC WebSocket proxy: browser connects to port 6080
/usr/share/novnc/utils/novnc_proxy --vnc localhost:5900 --listen 6080 &
sleep 0.5

echo "noVNC ready at http://localhost:6080/vnc.html"

# Run the emulator (blocks until quit)
exec ./build/berzerk "$@"
