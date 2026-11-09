#!/usr/bin/env bash
# Runs a command under a private Xvfb so browser tests never touch the real display.
unset DBUS_SESSION_BUS_ADDRESS WAYLAND_DISPLAY
export GTK_USE_PORTAL=0
exec xvfb-run -a -s "-screen 0 1600x1000x24 +extension GLX" "$@"
