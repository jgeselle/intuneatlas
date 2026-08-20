#!/usr/bin/env bash
# intuneatlas installer for Linux — clones the latest release and builds it
# from source, then puts a wrapper on your PATH.
#
# Usage:  curl -fsSL https://intuneatlas.com/install.sh | bash
#
# Unlike Windows, no packaged binary here: a Linux server already having
# Node.js is a reasonable assumption, and building from source avoids
# needing a whole separate SEA packaging pipeline (Windows only, for now)
# just for this.

set -euo pipefail

REPO_URL="https://github.com/jgeselle/intuneatlas.git"
INSTALL_DIR="$HOME/.local/share/intuneatlas"
BIN_DIR="$HOME/.local/bin"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22+ is required but wasn't found on PATH." >&2
  echo "Install it first (nvm, your package manager, or nodejs.org), then re-run this." >&2
  exit 1
fi

if ! command -v git >/dev/null 2>&1; then
  echo "git is required but wasn't found on PATH." >&2
  exit 1
fi

echo "Cloning..."
rm -rf "$INSTALL_DIR"
git clone --quiet "$REPO_URL" "$INSTALL_DIR"

cd "$INSTALL_DIR"
# Build whatever the latest tagged release actually is, not whatever's
# newest on main (which can be ahead of it — landing page changes, etc.,
# land on main without a release).
LATEST_TAG="$(git tag --list 'v*' --sort=-v:refname | head -n1)"
if [ -n "$LATEST_TAG" ]; then
  git checkout --quiet "$LATEST_TAG"
fi

echo "Installing dependencies and building (this can take a minute)..."
npm install --no-audit --no-fund --silent
npm run build --silent

mkdir -p "$BIN_DIR"
cat > "$BIN_DIR/intuneatlas" <<WRAPPER
#!/usr/bin/env bash
exec node "$INSTALL_DIR/dist/cli.js" "\$@"
WRAPPER
chmod +x "$BIN_DIR/intuneatlas"

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
