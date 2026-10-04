#!/usr/bin/env bash
# Re-run an archived engine build on its own frozen results — PLAN.md §25 · WP 15.3.
#
#   scripts/verify_engine_archive.sh <commit-or-tag>      # e.g. engine-v0.6.0
#
# Checks out <commit> in a throwaway worktree, DELETES its engine source
# (scsim/scsim and sim-worker/sim_worker) so nothing can import it, installs ONLY
# the wheels that commit published (public/engine/*.whl) into a clean virtualenv,
# and runs that commit's own frozen reference runs against them: the engine's
# golden digests and the worker's golden runs. Green means the archived build,
# installed the way `suresuite.install_engine(version=…)` installs it, reproduces
# the results it was released with — byte for byte.
#
# Needs: git history (a full clone), python3 -m venv, and network for numpy/scipy.
set -euo pipefail
REF="${1:?usage: verify_engine_archive.sh <commit-or-tag>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'git -C "$ROOT" worktree remove --force "$WORK/tree" >/dev/null 2>&1 || true; rm -rf "$WORK"' EXIT

git -C "$ROOT" worktree add -q "$WORK/tree" "$REF"
rm -rf "$WORK/tree/scsim/scsim" "$WORK/tree/sim-worker/sim_worker"
python3 -m venv "$WORK/venv"
"$WORK/venv/bin/pip" install -q numpy scipy pydantic pytest
"$WORK/venv/bin/pip" install -q "$WORK"/tree/public/engine/*.whl
ver="$("$WORK/venv/bin/python" -c 'import scsim; print(scsim.ENGINE_VERSION)')"
echo "archived engine $ver from $REF installed from its wheels alone"

rc=0
if [ -f "$WORK/tree/scsim/tests/test_golden_digests.py" ]; then
  (cd "$WORK/tree/scsim" && "$WORK/venv/bin/pytest" -q -p no:cacheprovider tests/test_golden_digests.py) || rc=1
fi
if [ -f "$WORK/tree/sim-worker/tests/test_golden_runs.py" ]; then
  (cd "$WORK/tree/sim-worker" && "$WORK/venv/bin/pytest" -q -p no:cacheprovider tests/test_golden_runs.py) || rc=1
fi
[ "$rc" -eq 0 ] && echo "✓ engine $ver reproduces its own frozen results from the archive" \
                || echo "✗ engine $ver does NOT reproduce its own frozen results from the archive"
exit "$rc"
