#!/usr/bin/env bash
# intuneatlas installer for Linux — downloads the latest standalone Linux
# binary and puts it on your PATH. No Node.js required, same as Windows.
#
# Usage:  curl -fsSL https://intuneatlas.com/install.sh | bash

set -euo pipefail

API_URL="https://api.github.com/repos/jgeselle/intuneatlas/releases/latest"
INSTALL_DIR="$HOME/.local/share/intuneatlas"
BIN_DIR="$HOME/.local/bin"

if ! command -v tar >/dev/null 2>&1; then
  echo "tar is required but wasn't found on PATH." >&2
  exit 1
fi

echo "Fetching the latest release..."
RELEASE_JSON="$(curl -fsSL "$API_URL")"
ASSET_URL="$(printf '%s' "$RELEASE_JSON" | grep -o '"browser_download_url": *"[^"]*intuneatlas-linux\.tar\.gz"' | head -n1 | cut -d'"' -f4)"
TAG_NAME="$(printf '%s' "$RELEASE_JSON" | grep -o '"tag_name": *"[^"]*"' | head -n1 | cut -d'"' -f4)"
if [ -z "$ASSET_URL" ]; then
  echo "Couldn't find intuneatlas-linux.tar.gz in the latest release ($TAG_NAME)." >&2
  exit 1
fi

echo "Downloading $TAG_NAME..."
rm -rf "$INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
# --strip-components drops the top-level "intuneatlas/" wrapper directory
# the release tarball is packaged with, so the binary and its web/dist +
# baselines siblings land directly in $INSTALL_DIR.
curl -fsSL "$ASSET_URL" | tar -xz -C "$INSTALL_DIR" --strip-components=1
chmod +x "$INSTALL_DIR/intuneatlas"

mkdir -p "$BIN_DIR"
# A symlink, not a copy or wrapper script — the binary looks for its
# web/dist and baselines siblings next to wherever process.execPath
# resolves to, and confirmed for real (this repo's dev sandbox is Linux)
# that Node resolves execPath through a symlink to the real target, so
# this still finds them correctly in $INSTALL_DIR even when run via the
# symlink in $BIN_DIR.
ln -sf "$INSTALL_DIR/intuneatlas" "$BIN_DIR/intuneatlas"

VERSION="$("$BIN_DIR/intuneatlas" --version)"

# Plain white/grey, no ANSI here — this is piped through `bash`, not run
# interactively, so there's no guarantee stdout is even a real terminal.
echo ""
echo "  IntuneAtlas  v$VERSION"
echo "  --------------------------------"
echo "  Installed to $INSTALL_DIR"
echo ""
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *)
    echo "  $BIN_DIR isn't on your PATH yet. Add this to your shell profile"
    echo "  (~/.bashrc, ~/.zshrc, ...) and open a new shell:"
    echo "    export PATH=\"\$PATH:$BIN_DIR\""
    echo ""
    ;;
esac
echo "  Next:"
echo "    intuneatlas ui --tenant <your-tenant>.onmicrosoft.com"
echo ""
echo "  Shared instance that survives reboots (needs root):"
echo "    sudo $BIN_DIR/intuneatlas ui --persist --host 0.0.0.0 --tenant <your-tenant>.onmicrosoft.com"
echo "    sudo $BIN_DIR/intuneatlas ui --stop   (to remove it)"
echo "  (sudo often doesn't inherit your PATH, so the full path above matters for --persist specifically)"
echo ""
