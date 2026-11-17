#!/bin/sh
# Full verification before a commit/push: Rust tests, WASM build, UI type-check and build.
set -e
cd "$(dirname "$0")/.."
cargo test -p obd-core --quiet
sh scripts/build-wasm.sh >/dev/null
npm --prefix ui run check --silent >/dev/null
npm --prefix ui run build --silent >/dev/null
echo "CHECK OK"
