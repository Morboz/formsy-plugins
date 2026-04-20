#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN_PACKAGE_DIR="$ROOT_DIR/packages/plugin-opencode"
PLUGIN_DIST_ENTRY="$PLUGIN_PACKAGE_DIR/dist/index.js"
PLUGIN_NAME="formsy.js"

usage() {
  cat <<'USAGE'
Install or update the local Formsy OpenCode plugin.

Usage:
  scripts/install-opencode-local.sh [--global]
  scripts/install-opencode-local.sh --project /path/to/project
  scripts/install-opencode-local.sh --target-dir /path/to/plugins-dir

Options:
  --global       Install globally to ~/.config/opencode/plugins. This is the default.
  --project DIR  Install to DIR/.opencode/plugins.
  --target-dir DIR
                 Install directly to an OpenCode plugins directory.
  --no-build     Skip pnpm build and only rewrite the OpenCode wrapper.
  -h, --help     Show this help.

After installing, start OpenCode from the project you want to test:
  opencode
USAGE
}

TARGET_DIR="${HOME}/.config/opencode/plugins"
RUN_BUILD=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --global)
      TARGET_DIR="${HOME}/.config/opencode/plugins"
      shift
      ;;
    --project)
      if [[ $# -lt 2 ]]; then
        echo "error: --project requires a directory" >&2
        exit 2
      fi
      TARGET_DIR="$2/.opencode/plugins"
      shift 2
      ;;
    --target-dir)
      if [[ $# -lt 2 ]]; then
        echo "error: --target-dir requires a directory" >&2
        exit 2
      fi
      TARGET_DIR="$2"
      shift 2
      ;;
    --no-build)
      RUN_BUILD=0
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "error: unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if ! command -v pnpm >/dev/null 2>&1; then
  echo "error: pnpm is required. Install pnpm or enable it with corepack." >&2
  echo "hint: corepack enable && corepack prepare pnpm@10.33.0 --activate" >&2
  exit 1
fi

if [[ "$RUN_BUILD" -eq 1 ]]; then
  echo "Building @formsy/plugin-opencode..."
  (cd "$ROOT_DIR" && pnpm --filter @formsy/plugin-opencode build)
fi

if [[ ! -f "$PLUGIN_DIST_ENTRY" ]]; then
  echo "error: built plugin entry not found: $PLUGIN_DIST_ENTRY" >&2
  echo "hint: run pnpm --filter @formsy/plugin-opencode build" >&2
  exit 1
fi

mkdir -p "$TARGET_DIR"

cat > "$TARGET_DIR/$PLUGIN_NAME" <<EOF
export { FormsyOpenCodePlugin } from "$PLUGIN_DIST_ENTRY"
EOF

echo "Installed Formsy OpenCode plugin wrapper:"
echo "  $TARGET_DIR/$PLUGIN_NAME"
echo
echo "Wrapper points to:"
echo "  $PLUGIN_DIST_ENTRY"
echo
echo "Next steps:"
echo "  1. Ensure the gateway is running at http://localhost:3001 or set FORMSY_GATEWAY_URL."
echo "  2. Start OpenCode from that project: opencode"
echo "  3. Ask OpenCode to call the formsy_generate_patch tool."
