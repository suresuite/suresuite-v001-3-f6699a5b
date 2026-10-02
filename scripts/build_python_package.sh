#!/usr/bin/env bash
# Build the `suresuite` Python package (python/) into public/python/ — Phase 12 · WP 12.5.
#
# The app serves the wheel as a static file, so `pip install <app>/python/<wheel>`
# installs the client a user's notebook or script imports. Like the engine wheels
# (scripts/build_engine_wheels.sh) it is committed, and --check fails when the
# committed wheel's Python source differs from python/suresuite/.
#
# Usage:
#   scripts/build_python_package.sh          # rebuild public/python/
#   scripts/build_python_package.sh --check  # CI drift gate
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=public/python
MODE="${1:-build}"

build() { python -m pip install --quiet build >/dev/null; python -m build --wheel python -o "$1" >/dev/null 2>&1; }

if [[ "$MODE" == "--check" ]]; then
  TMP="$(mktemp -d)"; build "$TMP"
  fresh="$(ls "$TMP"/suresuite-*.whl)"; committed="$(ls "$OUT"/suresuite-*.whl 2>/dev/null || true)"
  if [[ -z "$committed" ]]; then echo "❌ no committed wheel in $OUT — run scripts/build_python_package.sh"; exit 1; fi
  a="$(mktemp -d)"; b="$(mktemp -d)"; unzip -qo "$committed" -d "$a"; unzip -qo "$fresh" -d "$b"
  if ! diff -r -x '*.dist-info' "$a" "$b"; then
    echo "❌ public/python wheel is stale — run scripts/build_python_package.sh and commit public/python/"; exit 1
  fi
  echo "✓ committed suresuite wheel matches python/suresuite"
  exit 0
fi

TMP="$(mktemp -d)"; build "$TMP"
mkdir -p "$OUT"; rm -f "$OUT"/suresuite-*.whl; cp "$TMP"/suresuite-*.whl "$OUT"/
echo "Wrote $OUT: $(cd "$OUT" && ls suresuite-*.whl)"
