#!/bin/sh
# Full verification before a commit/push: Rust tests, WASM build, UI type-check and build.
set -e
cd "$(dirname "$0")/.."
cargo test -p obd-core --quiet
sh scripts/build-wasm.sh >/dev/null
npm --prefix ui run check --silent >/dev/null
# Every tutorial step must highlight a part that exists in the 3D models.
AUDIT="$(mktemp -d)/audit-highlights.mjs"
ui/node_modules/.bin/esbuild ui/scripts/audit-highlights.ts --bundle --platform=node --format=esm --outfile="$AUDIT" --log-level=error
node "$AUDIT" data/maintenance.fr.json
npm --prefix ui run build --silent >/dev/null
echo "CHECK OK"
