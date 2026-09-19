#!/usr/bin/env bash
# Rebuild the browser-engine wheels (scsim + sim_worker) into public/engine/.
#
# The simulation runs in the browser via Pyodide (src/lib/sim/pyodideEngine.ts):
# it micropip-installs these two pure-Python wheels on top of Pyodide's numpy/
# scipy/pydantic. They are committed so the Vercel build stays pure-Vite (no
# Python in the build). Regenerate whenever scsim/ or sim-worker/ change, then
# commit public/engine/*. CI (scsim-tests.yml) fails if they drift.
#
# Usage:
#   scripts/build_engine_wheels.sh          # regenerate wheels + manifest
#   scripts/build_engine_wheels.sh --check  # CI drift gate: fail if the
#                                           # committed wheels' Python source
#                                           # differs from the current engine
set -euo pipefail
cd "$(dirname "$0")/.."

OUT=public/engine
MODE="${1:-build}"

# Build fresh wheels into $1 (a temp dir). Echoes nothing; leaves *.whl there.
build_wheels() {
  local dest="$1"
  python -m pip install --quiet build >/dev/null
  python -m build --wheel scsim      -o "$dest" >/dev/null
  python -m build --wheel sim-worker -o "$dest" >/dev/null
}

# Compare the *Python source* inside two wheels (zips carry build timestamps,
# so byte comparison is useless — the source is what actually drifts).
diff_wheel_source() {
  local a="$1" b="$2" label="$3"
  local da db
  da="$(mktemp -d)"; db="$(mktemp -d)"
  unzip -qo "$a" -d "$da"
  unzip -qo "$b" -d "$db"
  # Ignore dist-info metadata (RECORD hashes, build tags) — compare only code.
  if ! diff -r -x '*.dist-info' "$da" "$db" >/tmp/wheel-drift.diff 2>&1; then
    echo "❌ $label wheel is stale — its source differs from the current engine:"
    cat /tmp/wheel-drift.diff
    rm -rf "$da" "$db"
    return 1
  fi
  rm -rf "$da" "$db"
  return 0
}

if [[ "$MODE" == "--check" ]]; then
  TMP="$(mktemp -d)"
  build_wheels "$TMP"
  rc=0
  fresh_scsim="$(ls "$TMP"/scsim-*.whl)"
  fresh_worker="$(ls "$TMP"/sim_worker-*.whl)"
  committed_scsim="$(ls "$OUT"/scsim-*.whl 2>/dev/null || true)"
  committed_worker="$(ls "$OUT"/sim_worker-*.whl 2>/dev/null || true)"
  if [[ -z "$committed_scsim" || -z "$committed_worker" ]]; then
    echo "❌ committed wheels missing from $OUT — run scripts/build_engine_wheels.sh"
    exit 1
  fi
  diff_wheel_source "$committed_scsim" "$fresh_scsim" "scsim" || rc=1
  diff_wheel_source "$committed_worker" "$fresh_worker" "sim_worker" || rc=1
  rm -rf "$TMP"
  if [[ $rc -ne 0 ]]; then
    echo "→ Regenerate with: scripts/build_engine_wheels.sh && commit public/engine/"
    exit 1
  fi
  echo "✓ committed browser-engine wheels match the current engine source"
  exit 0
fi

TMP="$(mktemp -d)"
build_wheels "$TMP"

rm -f "$OUT"/*.whl
cp "$TMP"/scsim-*.whl "$TMP"/sim_worker-*.whl "$OUT"/

# Manifest the frontend reads to know the exact wheel filenames + engine version.
SCSIM_WHL="$(cd "$OUT" && ls scsim-*.whl)"
WORKER_WHL="$(cd "$OUT" && ls sim_worker-*.whl)"
# §4 D87 — THE `cd` ABOVE IS WHY THIS USED TO WRITE "unknown", AND IT WAS NOT PyPI.
#
# We are in the repo root, where `./scsim/` is a DIRECTORY named `scsim`. Python
# picks it up as a namespace package before any installed distribution, and that
# namespace has no `ENGINE_VERSION` — so `import scsim` succeeds, the attribute
# lookup fails, and `|| echo unknown` silently wrote "unknown" into a manifest
# whose own docstring says the version "is embedded in every result". That
# happened with `scsim` fully installed; the recorded cause (an egress proxy
# denying PyPI) was a different session's symptom attached to this one.
#
# So the import runs with the cwd OUTSIDE the repo, and a failure is FATAL rather
# than defaulted. A wheel set whose version says "unknown" is worse than no wheel
# set: every result it produces claims an engine nobody can identify (§5 T4).
SCSIM_VER="$(cd / && python -c 'import scsim,sys; sys.stdout.write(scsim.ENGINE_VERSION)')" || {
  echo "❌ cannot read scsim.ENGINE_VERSION — install the engine first (\`pip install ./scsim\`)." >&2
  echo "   Refusing to write a manifest with engine_version=unknown: T4 says a figure" >&2
  echo "   leaving this system carries the engine version that produced it." >&2
  exit 1
}
if [[ -z "$SCSIM_VER" || "$SCSIM_VER" == "unknown" ]]; then
  echo "❌ scsim.ENGINE_VERSION resolved to \"$SCSIM_VER\" — refusing to write the manifest." >&2
  exit 1
fi
cat > "$OUT/manifest.json" <<JSON
{
  "engine_version": "${SCSIM_VER}",
  "pyodide_version": "0.26.4",
  "wheels": ["${SCSIM_WHL}", "${WORKER_WHL}"],
  "pyodide_packages": ["numpy", "scipy", "pydantic", "micropip"],
  "micropip_packages": []
}
JSON

rm -rf "$TMP"
echo "Wrote $OUT: $SCSIM_WHL, $WORKER_WHL (engine ${SCSIM_VER})"
