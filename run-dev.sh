#!/usr/bin/env bash
set -e

# If ELECTRON_EXEC_PATH is already configured, proceed directly
if [ -n "$ELECTRON_EXEC_PATH" ] && [ -x "$ELECTRON_EXEC_PATH" ]; then
  exec npm --prefix plexo run dev "$@"
fi

# If electron exists in PATH, use it
if command -v electron >/dev/null 2>&1; then
  export ELECTRON_EXEC_PATH="$(command -v electron)"
  exec npm --prefix plexo run dev "$@"
fi

# On NixOS systems, prebuilt npm Electron lacks glib/nss/nspr paths.
# Automatically delegate to nix-shell which provides the patched native binary.
if [ -f /run/current-system/nixos-version ] && command -v nix-shell >/dev/null 2>&1; then
  exec nix-shell --run "ELECTRON_EXEC_PATH=\$(which electron) npm --prefix plexo run dev $*"
fi

# Default fallback
exec npm --prefix plexo run dev "$@"
