#!/bin/sh
# Builds the WebAssembly version of obd-core used by the browser build (and as offline fallback).
set -e
cd "$(dirname "$0")/.."
cargo build -p obd-wasm --target wasm32-unknown-unknown --release
wasm-bindgen --target web --out-dir ui/public/wasm --no-typescript \
  target/wasm32-unknown-unknown/release/obd_wasm.wasm
echo "WASM -> ui/public/wasm"
