#!/usr/bin/env python3
"""Regenerate build_id_map.ipynb from build_id_map.py, so the two never differ.

    python scripts/deidentify/make_notebook.py
"""
import json
import re
from pathlib import Path

HERE = Path(__file__).parent
src = (HERE / "build_id_map.py").read_text(encoding="utf-8").split("\n", 1)[1]   # drop the shebang
doc_m = re.match(r'"""(.*?)"""\n', src, re.S)
doc, body = doc_m.group(1), src[doc_m.end():]
body = body.split('\nif __name__ == "__main__":')[0].rstrip() + "\n"
head, *sections = re.split(r"\n(?=# ── )", body)


def md(text):
    return {"cell_type": "markdown", "metadata": {}, "source": text.splitlines(True)}


def code(text):
    return {"cell_type": "code", "metadata": {}, "execution_count": None, "outputs": [],
            "source": text.rstrip("\n").splitlines(True)}


cells = [md("""# De-identify a project's data — build ONE ID map

Generated from `build_id_map.py` by `make_notebook.py` (same code, split into cells). Standard library only; `openpyxl` adds `.xlsx` input, `pandas` only makes the preview prettier.

**How to use:** put this notebook in the folder with the CSVs (or point `INPUTS` at it), check the settings cell, then *Run All*. The run cell prints every check and stops if any fails.

**Item names keep their meaning** — `E539.15280.000.10-SA` → `ASM-F1.010.000.10-SA`: role (PRD / ASM / MAT), family (`E539` → `F1`), base number (`15280` → `010`, shared by every variant of that part) and the variant tail. The node list and the deep-tier files are skipped (out of scope).

**Input** — the CSVs the project data viewer's *Download CSV* writes (`bom_data.csv`, `inbound_data.csv`, `outbound_data.csv`; `node list_data.csv` and the `deep …` files are skipped), the CSVs you upload on /project-manager, an `.xlsx` with one table per sheet, or a dataset version saved as JSON. Tables are recognised by their **headers**, not their file names.

**Output** (`OUT` folder):
- `private/id_map.csv` — original → alias (+ original name, where seen). **Keep private: it reverses the de-identification.**
- `private/secret.txt` — the key fixing the alias order (only when this run generated it).
- `private/report.md` — what was done per file and column, and every check.
- `shareable/` — the de-identified tables, named by table type.
"""),
         md("## Settings"),
         code('''# ── edit these ──────────────────────────────────────────────────────────────
INPUTS = ["."]                      # files and/or folders (.csv / .json / .xlsx); "." = this notebook's folder
OUT = "./aa_ver3_deid"              # NOT inside a git repo (the private map must never be committed)
SECRET = None                       # None = generate one and save it to private/secret.txt
EXISTING_MAP = None                 # e.g. "./aa_ver2_deid/private/id_map.csv" to keep its aliases
NAMING = "structured"               # "structured": ASM-F1.010.000.10-SA · "simple": ASM-001
PLAIN_TAILS = False                 # True also replaces short tails like .000.10 / -SA with V1, V2 ...
INCLUDE_NETWORK = False             # False skips the node list and the deep-tier files (out of scope)
KEEP_COORDINATES = False            # True keeps latitude / longitude (only with INCLUDE_NETWORK)
KEEP_FIRM_SIZE = False              # True keeps a deep-tier firm's revenue / headcount (only with INCLUDE_NETWORK)
ALSO_HIDE = ["Project AA"]          # extra text the output must not contain (project / company names)
ALLOW_IN_GIT = False
'''),
         md("## How it works\n\n```text\n" + doc.strip() + "\n```\n"),
         code(head)]
for s in sections:
    title = re.match(r"# ── (.*?) ─", s).group(1).strip()
    cells += [md(f"## Code · {title}"), code(s)]
cells += [
    md("## Run"),
    code('''args = [*INPUTS, "--out", OUT]
if SECRET: args += ["--secret", SECRET]
if EXISTING_MAP: args += ["--existing-map", EXISTING_MAP]
args += ["--naming", NAMING]
if PLAIN_TAILS: args.append("--plain-tails")
if INCLUDE_NETWORK: args.append("--include-network")
if KEEP_COORDINATES: args.append("--keep-coordinates")
if KEEP_FIRM_SIZE: args.append("--keep-firm-size")
for term in ALSO_HIDE: args += ["--also-hide", term]
if ALLOW_IN_GIT: args.append("--allow-in-git")

exit_code = main(args)
print("\\nALL CHECKS PASSED" if exit_code == 0 else f"\\nSTOPPED — exit code {exit_code}: read private/report.md")
'''),
    md("## Preview — the map and the de-identified tables"),
    code('''out_dir = Path(OUT)
try:
    import pandas as pd
    from IPython.display import display
    display(pd.read_csv(out_dir / "private" / "id_map.csv", dtype=str, keep_default_na=False))
    for f in sorted((out_dir / "shareable").glob("*.csv")):
        print(f"\\n{f.name}")
        display(pd.read_csv(f, dtype=str, keep_default_na=False).head(10))
except ImportError:
    for f in [out_dir / "private" / "id_map.csv", *sorted((out_dir / "shareable").glob("*.csv"))]:
        print(f"\\n== {f.name}")
        print("".join(f.open(encoding="utf-8").readlines()[:11]))
'''),
]
for i, c in enumerate(cells):
    c["id"] = f"c{i:02d}"
nb = {"cells": cells, "nbformat": 4, "nbformat_minor": 5,
      "metadata": {"kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
                   "language_info": {"name": "python"}}}
(HERE / "build_id_map.ipynb").write_text(json.dumps(nb, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
print(f"wrote build_id_map.ipynb ({len(cells)} cells)")
