#!/usr/bin/env python3
"""Build ONE ID map for a project's data and write a de-identified copy of it.

Standalone: Python 3.9+ and the standard library only (openpyxl, if installed,
adds .xlsx input). Runs the same from a terminal or a Jupyter cell:

    python build_id_map.py ./aa_ver3_export --out ./aa_ver3_deid
    %run build_id_map.py ./aa_ver3_export --out ./aa_ver3_deid      # Jupyter

INPUT is any mix of files or folders (a folder means every .csv / .json /
.xlsx directly inside it):

  * the CSVs uploaded on /project-manager (suppliers, materials, products,
    customers, inbound, outbound, BOM single- or multi-level, demand
    forecasts, tier-2 / tier-3 suppliers, multi-tier, node list), or the ones
    the project data viewer's "Download CSV" writes (bom_data.csv,
    inbound_data.csv, outbound_data.csv, "node list_data.csv",
    "deep nodes_data.csv", "deep edges_data.csv") — tables are recognised by
    their HEADERS, not their file names;
  * a dataset version as JSON (`GET /v1/projects/{id}/dataset-versions/latest`,
    or `ss.dataset(api, pid).snapshot` dumped with json.dump).

OUTPUT (--out DIR):

  private/id_map.csv      original -> alias, one row per original ID, plus
                          the original name where a master gave one.
                          KEEP PRIVATE: it reverses the de-identification.
  private/secret.txt      the key that fixed the alias ORDER (only if this run
                          generated it). With it and the same input, a re-run
                          reproduces the map exactly.
  private/report.md       what was done per file and column, and every check.
  shareable/...           the de-identified tables, same shape as the input,
                          named by table type (input file names can identify).

THE ONE MAP. Every ID column of every table is rewritten through a single map
per namespace, so a material keeps one alias in the masters, both BOM tables,
the inbound lanes and the node list, and every join still holds:

  supplier_id, upstream_supplier_id            -> SUP-001 ...
  customer_id                                  -> CUS-001 ...
  plant_name                                   -> PLANT-01 ...
  product_id, material_id,
  higher_level_component_id                    -> ONE item namespace:
        PRD-001  a product (product master, product_id, outbound)
        ASM-001  a sub-assembly (a BOM parent that is not a product)
        MAT-001  a purchased material (everything else)
  node_id, from_firm_id, to_firm_id,
  uid, src_uid, dst_uid (deep tier)            -> whichever of the above the
                                                  ID already is; else FIRM-001

Alias numbers are NOT in the originals' sort order, which would leak adjacent
part numbers. They are ordered by HMAC-SHA256(secret, namespace|id), so the
order is reproducible with the secret and meaningless without it.
--existing-map keeps every alias an earlier run gave and numbers only new IDs,
so ver1/ver2/ver3 of a project can share one map.

ALSO REMOVED: names become the row's alias; description / location text,
website, ticker and coordinates are blanked (--keep-coordinates keeps them); a
deep-tier firm's revenue and number_of_employees are blanked, because with its
country and industry they can name the company (--keep-firm-size); database
provenance (project_id, ingest_run_id, source_row_id, surrogate id,
timestamps, hashes, organisation, modeler) is dropped.

NOT CHANGED: every number (costs, prices, volumes, lead times, rates, demand),
levels, units and enums, so a simulation of the copy reproduces the original.
Numbers can be commercially sensitive on their own; decide before sharing.

CHECKS (the run exits 1 if any fails): one alias per original and one
original per alias in each namespace; every non-empty ID cell mapped; row
counts unchanged; ID columns round-trip back to the input through the map; no
original ID, name or plant name survives as text in any non-numeric cell of
the output.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import hmac
import io
import json
import re
import secrets
import subprocess
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path

# ── what each column is ──────────────────────────────────────────────────────

ID_COLUMNS = {
    "supplier_id": "supplier",
    "upstream_supplier_id": "supplier",
    "customer_id": "customer",
    "plant_name": "plant",
    "product_id": "item",
    "material_id": "item",
    "higher_level_component_id": "item",
    "node_id": "any",
    "from_firm_id": "any",
    "to_firm_id": "any",
    "uid": "any",            # deep-tier nodes (Deep Nodes export)
    "src_uid": "any",        # deep-tier edges (Deep Edges export)
    "dst_uid": "any",
}
ANY_COLUMNS = [c for c, role in ID_COLUMNS.items() if role == "any"]

# A row's own ID, in the order a master names it; its `name` becomes this alias.
PRIMARY_ID = ("supplier_id", "customer_id", "product_id", "material_id", "node_id", "uid")
NAME_COLUMNS = {"name", "supplier_name", "customer_name", "product_name", "material_name", "node_name"}
BLANK_COLUMNS = {"description_text", "description", "location_text", "notes", "comment", "comments",
                 "address", "city", "source_external_id", "plant_location_text", "website", "traded_as"}
# A deep-tier firm's size: with its country and industry it can name the company.
FIRM_SIZE_COLUMNS = {"revenue", "number_of_employees"}
COORD_COLUMNS = {"latitude", "longitude", "lat", "lon", "long", "lng", "plant_latitude", "plant_longitude"}
DROP_COLUMNS = {"id", "project_id", "ingest_run_id", "source_row_id", "created_at", "updated_at",
                "computed_from_hash", "computed_at", "organization", "organization_id",
                "modeler_id", "modeler_name", "project_name", "uploaded_by", "graph_hash",
                "hash_inputs", "hash_network", "hash_simulation", "label", "dataset_version_id"}

PREFIX = {"supplier": "SUP", "customer": "CUS", "plant": "PLANT", "firm": "FIRM",
          "product": "PRD", "assembly": "ASM", "material": "MAT"}
MIN_WIDTH = {"PLANT": 2}


def detect_kind(headers: set[str]) -> str:
    """The table type, from its headers (upload templates; dataset snapshot keys)."""
    h = headers
    if "higher_level_component_id" in h:
        return "bom_multi_level"
    if {"product_id", "material_id"} <= h:
        return "bom_single_level"
    if "upstream_supplier_id" in h:
        return "tier_suppliers"
    if {"src_uid", "dst_uid"} & h:
        return "deep_edges"
    if "uid" in h:
        return "deep_nodes"
    if {"from_firm_id", "to_firm_id"} & h:
        return "multi_tier_supply_chain"
    if "node_id" in h:
        return "node_list"
    if {"supplier_id", "material_id"} <= h:
        return "inbound_logistics"
    if {"customer_id", "product_id"} <= h:
        return "demand_forecasts" if "period_start" in h else "outbound_logistics"
    for key, kind in (("supplier_id", "suppliers"), ("customer_id", "customers"),
                      ("product_id", "products"), ("material_id", "materials")):
        if key in h:
            return kind
    return "table"


# ── reading ─────────────────────────────────────────────────────────────────

@dataclass
class Table:
    source: str                  # where it came from (file, sheet, JSON path)
    kind: str
    columns: list[str]
    rows: list[dict]
    json_path: tuple = ()        # set for tables inside a JSON document
    out_rows: list[dict] = field(default_factory=list)
    out_columns: list[str] = field(default_factory=list)


def _clean(v):
    return v.strip() if isinstance(v, str) else v


def read_csv(path: Path) -> list[Table]:
    text = path.read_bytes().decode("utf-8-sig")
    sample = text[:4096]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t")
    except csv.Error:
        dialect = csv.excel
    reader = csv.DictReader(io.StringIO(text), dialect=dialect)
    cols = [c.strip() for c in (reader.fieldnames or [])]
    rows = [{c.strip(): v for c, v in r.items() if c is not None} for r in reader]
    return [Table(str(path), detect_kind(set(cols)), cols, rows)]


def read_xlsx(path: Path) -> list[Table]:
    try:
        import openpyxl
    except ImportError:
        sys.exit(f"{path}: reading .xlsx needs openpyxl (pip install openpyxl), or save each sheet as CSV")
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    out = []
    for ws in wb.worksheets:
        it = ws.iter_rows(values_only=True)
        header = next(it, None)
        if not header:
            continue
        cols = [str(c).strip() if c is not None else f"col{i}" for i, c in enumerate(header)]
        rows = [dict(zip(cols, ("" if v is None else v for v in r))) for r in it
                if any(v not in (None, "") for v in r)]
        out.append(Table(f"{path}[{ws.title}]", detect_kind(set(cols)), cols, rows))
    return out


def _json_tables(node, path=()):
    """Every list of row-objects in a JSON document, with its path."""
    if isinstance(node, list) and node and all(isinstance(r, dict) for r in node):
        cols = list(dict.fromkeys(k for r in node for k in r))
        if set(cols) & (set(ID_COLUMNS) | NAME_COLUMNS):
            yield path, cols, node
            return
    if isinstance(node, dict):
        for k, v in node.items():
            yield from _json_tables(v, path + (k,))


def read_json(path: Path) -> tuple[list[Table], dict]:
    doc = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(doc, dict) and isinstance(doc.get("snapshot"), dict):
        doc = doc["snapshot"]            # a dataset-version wrapper: keep only the rows
    tables = [Table(f"{path}:{'/'.join(map(str, p))}", detect_kind(set(cols)), cols, rows, json_path=p)
              for p, cols, rows in _json_tables(doc)]
    return tables, doc


def collect_inputs(inputs: list[str]):
    files = []
    for raw in inputs:
        p = Path(raw)
        if p.is_dir():
            files += sorted(f for f in p.iterdir() if f.suffix.lower() in (".csv", ".json", ".xlsx"))
        elif p.is_file():
            files.append(p)
        else:
            sys.exit(f"no such file or folder: {raw}")
    if not files:
        sys.exit("no .csv / .json / .xlsx input found")
    tables, docs = [], []
    for f in files:
        suf = f.suffix.lower()
        if suf == ".csv":
            tables += read_csv(f)
        elif suf == ".xlsx":
            tables += read_xlsx(f)
        elif suf == ".json":
            t, doc = read_json(f)
            tables += t
            docs.append((f, doc, t))
    return tables, docs


# ── the map ─────────────────────────────────────────────────────────────────

class IdMap:
    def __init__(self, secret: bytes):
        self.secret = secret
        self.alias: dict[tuple[str, str], str] = {}   # (namespace, original) -> alias
        self.prefix_of: dict[tuple[str, str], str] = {}
        self.names: dict[tuple[str, str], str] = {}
        self.seen: dict[tuple[str, str], Counter] = defaultdict(Counter)
        self.kept: set[tuple[str, str]] = set()

    def load_existing(self, path: Path):
        with path.open(newline="", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                key = (r["namespace"], r["original_id"])
                self.alias[key] = r["alias"]
                self.prefix_of[key] = r["alias"].rsplit("-", 1)[0]
                if r.get("original_name"):
                    self.names[key] = r["original_name"]
                self.kept.add(key)

    def assign(self, keys_by_prefix: dict[str, set[tuple[str, str]]]):
        used = Counter()
        for key, a in self.alias.items():
            pre, num = a.rsplit("-", 1)
            used[pre] = max(used[pre], int(num))
        for pre, keys in keys_by_prefix.items():
            new = [k for k in keys if k not in self.alias]
            order = sorted(new, key=lambda k: hmac.new(self.secret, f"{k[0]}|{k[1]}".encode(),
                                                       hashlib.sha256).hexdigest())
            total = used[pre] + len(order)
            width = max(MIN_WIDTH.get(pre, 3), len(str(total)))
            for i, k in enumerate(order, start=used[pre] + 1):
                self.alias[k] = f"{pre}-{i:0{width}d}"
                self.prefix_of[k] = pre

    def resolve_any(self, value: str) -> tuple[str, str]:
        for ns in ("supplier", "customer", "plant", "item"):
            if (ns, value) in self.alias:
                return ns, value
        return "firm", value


def build_map(tables: list[Table], idmap: IdMap):
    """Pass 1: every original ID, its namespace and (for items) its kind."""
    ids = defaultdict(set)
    products, parents = set(), set()
    any_ids = set()
    for t in tables:
        for r in t.rows:
            for col, role in ID_COLUMNS.items():
                v = _clean(r.get(col))
                if v in (None, ""):
                    continue
                v = str(v)
                if role == "any":
                    any_ids.add(v)
                    continue
                ids[role].add(v)
                idmap.seen[(role, v)][f"{t.kind}.{col}"] += 1
                if col == "product_id":
                    products.add(v)
                elif col == "higher_level_component_id":
                    parents.add(v)

    by_prefix = defaultdict(set)
    for role in ("supplier", "customer", "plant"):
        for v in ids[role]:
            by_prefix[PREFIX[role]].add((role, v))
    for v in ids["item"]:
        key = ("item", v)
        if key in idmap.prefix_of:                   # an earlier run already named it
            continue
        kind = "product" if v in products else "assembly" if v in parents else "material"
        by_prefix[PREFIX[kind]].add(key)
    idmap.assign(by_prefix)

    # node_id / firm ids: whatever they already are, else a firm of their own.
    firms = set()
    for v in any_ids:
        ns, _ = idmap.resolve_any(v)
        if ns == "firm":
            firms.add(("firm", v))
    idmap.assign({PREFIX["firm"]: firms})
    for t in tables:
        for r in t.rows:
            for col in ANY_COLUMNS:
                v = _clean(r.get(col))
                if v not in (None, ""):
                    idmap.seen[idmap.resolve_any(str(v))][f"{t.kind}.{col}"] += 1


# ── rewriting ───────────────────────────────────────────────────────────────

def map_value(idmap: IdMap, col: str, v):
    v = _clean(v)
    if v in (None, ""):
        return v
    role = ID_COLUMNS[col]
    key = idmap.resolve_any(str(v)) if role == "any" else (role, str(v))
    return idmap.alias[key]


def rewrite(tables: list[Table], idmap: IdMap, keep_coords: bool, keep_firm_size: bool, actions: dict):
    for t in tables:
        out_cols = [c for c in t.columns if c not in DROP_COLUMNS]
        for c in t.columns:
            if c in DROP_COLUMNS:
                actions[t.source][c] = "dropped (database provenance)"
            elif c in ID_COLUMNS:
                actions[t.source][c] = f"ID -> {ID_COLUMNS[c]} map"
            elif c in NAME_COLUMNS:
                actions[t.source][c] = "name -> the row's alias"
            elif _blank(c, keep_coords, keep_firm_size):
                actions[t.source][c] = "blanked"
            else:
                actions[t.source][c] = "kept as is"
        t.out_columns = out_cols
        for r in t.rows:
            o = {}
            primary = next((c for c in PRIMARY_ID if _clean(r.get(c)) not in (None, "")), None)
            for c in out_cols:
                v = r.get(c)
                if c in ID_COLUMNS:
                    o[c] = map_value(idmap, c, v)
                elif c in NAME_COLUMNS:
                    if primary:
                        key = (idmap.resolve_any(str(_clean(r[primary])))
                               if ID_COLUMNS[primary] == "any" else (ID_COLUMNS[primary], str(_clean(r[primary]))))
                        if _clean(v) not in (None, ""):
                            idmap.names.setdefault(key, str(_clean(v)))
                        o[c] = idmap.alias[key]
                    else:
                        o[c] = "" if isinstance(v, str) or v is None else None
                elif _blank(c, keep_coords, keep_firm_size):
                    o[c] = "" if not isinstance(v, (int, float)) else None
                else:
                    o[c] = v
            t.out_rows.append(o)


def _blank(col: str, keep_coords: bool, keep_firm_size: bool) -> bool:
    return (col in BLANK_COLUMNS or (col in COORD_COLUMNS and not keep_coords)
            or (col in FIRM_SIZE_COLUMNS and not keep_firm_size))


# ── checks ──────────────────────────────────────────────────────────────────

def _is_number(v) -> bool:
    if isinstance(v, (int, float, bool)) or v is None:
        return True
    try:
        float(str(v).replace(",", ""))
        return True
    except ValueError:
        return False


def run_checks(tables: list[Table], idmap: IdMap, extra_leak_terms: list[str]):
    results = []

    # 1 · a bijection inside every prefix
    by_alias = defaultdict(list)
    for k, a in idmap.alias.items():
        by_alias[a].append(k)
    dup = {a: ks for a, ks in by_alias.items() if len(ks) > 1}
    results.append(("one original per alias", not dup, f"{len(dup)} aliases shared" if dup else
                    f"{len(by_alias)} aliases, each for exactly one original"))

    # 2 · row counts
    bad = [t.source for t in tables if len(t.rows) != len(t.out_rows)]
    results.append(("row counts unchanged", not bad, ", ".join(bad) or f"{sum(len(t.rows) for t in tables)} rows"))

    # 3 · round trip of every ID cell through the inverse map
    inverse = {a: k[1] for k, a in idmap.alias.items()}
    mism = 0
    for t in tables:
        for r, o in zip(t.rows, t.out_rows):
            for c in ID_COLUMNS:
                if c in o and o[c] not in (None, ""):
                    if inverse.get(o[c]) != str(_clean(r.get(c))):
                        mism += 1
    results.append(("ID columns round-trip to the input", mism == 0, f"{mism} cells differ" if mism else "every ID cell"))

    # 4 · no original survives as text
    aliases = set(idmap.alias.values())
    terms = {k[1] for k in idmap.alias} | set(idmap.names.values()) | set(extra_leak_terms)
    terms = sorted({t for t in terms if t and len(t) >= 3 and not _is_number(t)}, key=len, reverse=True)
    leaks = []
    if terms:
        pattern = re.compile("|".join(r"(?<![A-Za-z0-9])" + re.escape(t) + r"(?![A-Za-z0-9])" for t in terms),
                             re.IGNORECASE)
        for t in tables:
            for i, o in enumerate(t.out_rows):
                for c, v in o.items():
                    if v is None or _is_number(v) or v in aliases:
                        continue
                    m = pattern.search(str(v))
                    if m:
                        leaks.append((t.kind, i + 1, c, m.group(0)))
    results.append(("no original ID or name left in the output text", not leaks,
                    f"{len(leaks)} cells (see report)" if leaks else f"{len(terms)} originals searched for"))
    numeric_ids = sorted({k[1] for k in idmap.alias if _is_number(k[1])})
    return results, leaks, numeric_ids


# ── writing ─────────────────────────────────────────────────────────────────

def _inside_git_repo(p: Path) -> bool:
    try:
        r = subprocess.run(["git", "-C", str(p), "rev-parse", "--is-inside-work-tree"],
                           capture_output=True, text=True, timeout=10)
        return r.stdout.strip() == "true"
    except (OSError, subprocess.SubprocessError):
        return False


def write_outputs(out: Path, tables, docs, idmap: IdMap, secret_generated: bool, actions,
                  results, leaks, numeric_ids, ambiguous):
    priv, share = out / "private", out / "shareable"
    priv.mkdir(parents=True, exist_ok=True)
    share.mkdir(parents=True, exist_ok=True)

    # the map
    rows = []
    for key, alias in idmap.alias.items():
        ns, orig = key
        rows.append({"namespace": ns, "alias": alias, "original_id": orig,
                     "original_name": idmap.names.get(key, ""),
                     "seen_in": "; ".join(f"{w}×{n}" for w, n in sorted(idmap.seen[key].items())),
                     "from_existing_map": "yes" if key in idmap.kept else ""})
    rows.sort(key=lambda r: (r["alias"].rsplit("-", 1)[0], int(r["alias"].rsplit("-", 1)[1])))
    with (priv / "id_map.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]) if rows else ["namespace", "alias", "original_id"])
        w.writeheader()
        w.writerows(rows)
    if secret_generated:
        (priv / "secret.txt").write_text(idmap.secret.decode() + "\n", encoding="utf-8")

    # the tables (CSV / XLSX inputs -> CSV named by table type)
    names = Counter()
    written = {}
    for t in tables:
        if t.json_path:
            continue
        names[t.kind] += 1
        fname = f"{t.kind}.csv" if names[t.kind] == 1 else f"{t.kind}_{names[t.kind]}.csv"
        with (share / fname).open("w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=t.out_columns, extrasaction="ignore")
            w.writeheader()
            w.writerows(t.out_rows)
        written[t.source] = fname

    # JSON inputs keep their structure; only the row lists are replaced
    for n, (path, doc, jtables) in enumerate(docs, start=1):
        for t in jtables:
            node = doc
            for k in t.json_path[:-1]:
                node = node[k]
            node[t.json_path[-1]] = [{k: v for k, v in o.items()} for o in t.out_rows]
        doc = {k: v for k, v in doc.items() if k not in DROP_COLUMNS} if isinstance(doc, dict) else doc
        fname = "dataset_snapshot.json" if n == 1 else f"dataset_snapshot_{n}.json"
        (share / fname).write_text(json.dumps(doc, indent=1, ensure_ascii=False), encoding="utf-8")
        for t in jtables:
            written[t.source] = f"{fname} → {'/'.join(map(str, t.json_path))}"

    # the report
    counts = Counter(a.rsplit("-", 1)[0] for a in idmap.alias.values())
    L = ["# De-identification report", "",
         "PRIVATE — this file names the input files, which may identify the project.", "",
         "## Checks", "", "| Check | Result | Detail |", "|---|---|---|"]
    L += [f"| {name} | {'PASS' if ok else 'FAIL'} | {detail} |" for name, ok, detail in results]
    L += ["", "## The map", "", "| Prefix | IDs |", "|---|---|"]
    L += [f"| {p} | {n} |" for p, n in sorted(counts.items())]
    if idmap.kept:
        L += ["", f"{len(idmap.kept)} aliases were kept from --existing-map."]
    if ambiguous:
        L += ["", f"**{len(ambiguous)} IDs exist in more than one namespace** (each keeps a separate alias "
              "per namespace; node / firm IDs resolve supplier → customer → plant → item): "
              + ", ".join(sorted(ambiguous)[:20]) + (" …" if len(ambiguous) > 20 else "")]
    if numeric_ids:
        L += ["", f"{len(numeric_ids)} original IDs are purely numeric, so the leak scan cannot tell them from "
              "quantities and skips them; they are still mapped in every ID column."]
    L += ["", "## Files", ""]
    for t in tables:
        kept = [c for c, a in actions[t.source].items() if a == "kept as is"]
        L += [f"### {t.source}", "", f"- table type: `{t.kind}` · {len(t.rows)} rows · written to `{written.get(t.source)}`"]
        for c, a in actions[t.source].items():
            if a != "kept as is":
                L.append(f"- `{c}`: {a}")
        if kept:
            L.append(f"- kept as is: {', '.join(f'`{c}`' for c in kept)}")
        L.append("")
    if leaks:
        L += ["## Leaks — original text still in the output", "", "| Table | Row | Column | Found |", "|---|---|---|---|"]
        L += [f"| {k} | {i} | {c} | {m} |" for k, i, c, m in leaks[:500]]
    (priv / "report.md").write_text("\n".join(L) + "\n", encoding="utf-8")
    return counts


# ── entry point ─────────────────────────────────────────────────────────────

def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0],
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("inputs", nargs="+", help="files or folders: .csv / .json / .xlsx")
    ap.add_argument("--out", required=True, help="output folder (private/ and shareable/ are made inside)")
    ap.add_argument("--secret", help="key that fixes the alias order (default: generate one and save it)")
    ap.add_argument("--existing-map", help="an earlier private/id_map.csv whose aliases are kept")
    ap.add_argument("--keep-coordinates", action="store_true", help="keep latitude / longitude")
    ap.add_argument("--keep-firm-size", action="store_true",
                    help="keep a deep-tier firm's revenue and number_of_employees")
    ap.add_argument("--also-hide", action="append", default=[],
                    help="extra text the output must not contain, e.g. a project or company name (repeatable)")
    ap.add_argument("--allow-in-git", action="store_true", help="allow --out inside a git working tree")
    args = ap.parse_args(argv)

    out = Path(args.out).resolve()
    nearest = next(p for p in (out, *out.parents) if p.exists())
    if _inside_git_repo(nearest) and not args.allow_in_git:
        print(f"refusing: {out} is inside a git working tree, and private/id_map.csv would reverse the "
              "de-identification if committed. Choose another --out, or pass --allow-in-git.", file=sys.stderr)
        return 2
    out.mkdir(parents=True, exist_ok=True)

    tables, docs = collect_inputs(args.inputs)
    if not any(t.rows for t in tables):
        print("no rows with a recognised ID or name column were found", file=sys.stderr)
        return 2

    secret_generated = not args.secret
    idmap = IdMap((args.secret or secrets.token_hex(32)).encode())
    if args.existing_map:
        idmap.load_existing(Path(args.existing_map))

    build_map(tables, idmap)
    ambiguous = {v for v, n in Counter(k[1] for k in idmap.alias).items() if n > 1}
    actions = defaultdict(dict)
    rewrite(tables, idmap, args.keep_coordinates, args.keep_firm_size, actions)
    results, leaks, numeric_ids = run_checks(tables, idmap, args.also_hide)
    counts = write_outputs(out, tables, docs, idmap, secret_generated, actions, results, leaks,
                           numeric_ids, ambiguous)

    print(f"read {len(tables)} tables, {sum(len(t.rows) for t in tables)} rows")
    print("map: " + ", ".join(f"{p} {n}" for p, n in sorted(counts.items())))
    for name, ok, detail in results:
        print(f"  [{'PASS' if ok else 'FAIL'}] {name} — {detail}")
    print(f"private (keep it so): {out / 'private'}")
    print(f"shareable:            {out / 'shareable'}")
    return 0 if all(ok for _, ok, _ in results) else 1


if __name__ == "__main__":
    sys.exit(main())
