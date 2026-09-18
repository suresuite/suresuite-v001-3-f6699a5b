// A small, dependency-free PostgreSQL lexer: enough to split a migration into
// statements and to read identifiers without being fooled by the things that
// make naive `split(';')` wrong.
//
// It handles the four ways Postgres hides a semicolon from you:
//   · line comments     -- ...
//   · block comments    /* ... */  (nested, per the Postgres spec)
//   · string literals   '...'      ('' escapes a quote)
//   · dollar quoting    $$ ... $$  /  $function$ ... $function$
// and the one way it hides a keyword: "quoted identifiers", which may contain
// spaces, dots and reserved words (`risk_data."RISK CLASS"`).
//
// Nothing here understands SQL semantics. That is introspect.mjs's job.

/** Strip comments and split into statements on top-level semicolons. */
export function splitStatements(sql) {
  const out = [];
  let buf = "";
  let i = 0;
  const n = sql.length;

  while (i < n) {
    const c = sql[i];
    const two = sql.slice(i, i + 2);

    if (two === "--") {
      const nl = sql.indexOf("\n", i);
      i = nl === -1 ? n : nl; // keep the newline; it is whitespace
      continue;
    }
    if (two === "/*") {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (sql.slice(i, i + 2) === "/*") { depth++; i += 2; }
        else if (sql.slice(i, i + 2) === "*/") { depth--; i += 2; }
        else i++;
      }
      buf += " ";
      continue;
    }
    if (c === "'") {
      const end = scanSingleQuoted(sql, i);
      buf += sql.slice(i, end);
      i = end;
      continue;
    }
    if (c === '"') {
      const end = scanDoubleQuoted(sql, i);
      buf += sql.slice(i, end);
      i = end;
      continue;
    }
    const tag = dollarTagAt(sql, i);
    if (tag) {
      const close = sql.indexOf(tag, i + tag.length);
      const end = close === -1 ? n : close + tag.length;
      buf += sql.slice(i, end);
      i = end;
      continue;
    }
    if (c === ";") {
      if (buf.trim()) out.push(buf.trim());
      buf = "";
      i++;
      continue;
    }
    buf += c;
    i++;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

function scanSingleQuoted(s, i) {
  i++; // opening '
  while (i < s.length) {
    if (s[i] === "'") {
      if (s[i + 1] === "'") { i += 2; continue; } // '' — an escaped quote
      return i + 1;
    }
    if (s[i] === "\\") { i += 2; continue; } // E'' style; harmless otherwise
    i++;
  }
  return s.length;
}

function scanDoubleQuoted(s, i) {
  i++; // opening "
  while (i < s.length) {
    if (s[i] === '"') {
      if (s[i + 1] === '"') { i += 2; continue; }
      return i + 1;
    }
    i++;
  }
  return s.length;
}

/** `$$` or `$tag$` starting at i, else null. */
function dollarTagAt(s, i) {
  if (s[i] !== "$") return null;
  const m = /^\$[A-Za-z_][A-Za-z_0-9]*\$|^\$\$/.exec(s.slice(i));
  return m ? m[0] : null;
}

/**
 * Split a parenthesised body on its TOP-LEVEL commas.
 * `numeric(16,6)` and `CHECK (a IN ('x,y'))` must not split.
 */
export function splitTopLevel(body, sep = ",") {
  const parts = [];
  let buf = "";
  let depth = 0;
  let i = 0;
  while (i < body.length) {
    const c = body[i];
    if (c === "'") { const e = scanSingleQuoted(body, i); buf += body.slice(i, e); i = e; continue; }
    if (c === '"') { const e = scanDoubleQuoted(body, i); buf += body.slice(i, e); i = e; continue; }
    const tag = dollarTagAt(body, i);
    if (tag) {
      const close = body.indexOf(tag, i + tag.length);
      const e = close === -1 ? body.length : close + tag.length;
      buf += body.slice(i, e); i = e; continue;
    }
    if (c === "(") depth++;
    if (c === ")") depth--;
    if (c === sep && depth === 0) { parts.push(buf.trim()); buf = ""; i++; continue; }
    buf += c;
    i++;
  }
  if (buf.trim()) parts.push(buf.trim());
  return parts;
}

/**
 * The parenthesised body of the FIRST top-level `(...)` at or after `from`.
 * Returns { body, start, end } or null.
 */
export function parenBody(s, from = 0) {
  let i = s.indexOf("(", from);
  if (i === -1) return null;
  const start = i;
  let depth = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === "'") { i = scanSingleQuoted(s, i); continue; }
    if (c === '"') { i = scanDoubleQuoted(s, i); continue; }
    const tag = dollarTagAt(s, i);
    if (tag) {
      const close = s.indexOf(tag, i + tag.length);
      i = close === -1 ? s.length : close + tag.length;
      continue;
    }
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return { body: s.slice(start + 1, i), start, end: i };
    }
    i++;
  }
  return null;
}

/**
 * Read a (possibly schema-qualified, possibly quoted) identifier at `from`.
 * Returns { schema, name, raw, end } — `name` is the unquoted text, and
 * `quoted` says whether it needed quoting (a name with a space always does).
 */
export function readQualifiedName(s, from = 0) {
  let i = from;
  while (i < s.length && /\s/.test(s[i])) i++;
  const parts = [];
  for (;;) {
    if (s[i] === '"') {
      const e = scanDoubleQuoted(s, i);
      parts.push({ name: s.slice(i + 1, e - 1).replace(/""/g, '"'), quoted: true });
      i = e;
    } else {
      const m = /^[A-Za-z_][A-Za-z_0-9$]*/.exec(s.slice(i));
      if (!m) break;
      parts.push({ name: m[0].toLowerCase(), quoted: false });
      i += m[0].length;
    }
    if (s[i] === ".") { i++; continue; }
    break;
  }
  if (parts.length === 0) return null;
  const last = parts[parts.length - 1];
  return {
    schema: parts.length > 1 ? parts[parts.length - 2].name : null,
    name: last.name,
    quoted: last.quoted,
    raw: s.slice(from, i).trim(),
    end: i,
  };
}

/** Collapse whitespace so a definition can be compared or printed on one line. */
export const squash = (s) => s.replace(/\s+/g, " ").trim();

/**
 * Rewrite every occurrence of the identifier `from` as `to`, leaving string
 * literals, dollar-quoted bodies and function names alone.
 *
 * A column RENAME in Postgres follows the column by OID into every dependent
 * object — indexes, CHECK expressions, index predicates — without any of them
 * being restated. The artifact records those by NAME, so unless they are
 * rewritten here it describes objects the database cannot have. That is §4 D49
 * (three indexes on `supply_chain_data`/`supply_chain_data_multi_tier`) and the
 * same shape as D52, which followed a TABLE rename into foreign keys.
 *
 * Deliberately narrow: an identifier immediately followed by `(` is a function
 * call, not a column, and is left as it is.
 */
export function renameIdentifier(sql, from, to) {
  if (typeof sql !== "string" || !from || from === to) return sql;
  const lower = from.toLowerCase();
  const rendered = /^[a-z_][a-z0-9_]*$/.test(to) ? to : `"${to.replace(/"/g, '""')}"`;
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (c === "'") { const e = scanSingleQuoted(sql, i); out += sql.slice(i, e); i = e; continue; }
    if (c === '"') {
      const e = scanDoubleQuoted(sql, i);
      const inner = sql.slice(i + 1, e - 1).replace(/""/g, '"');
      out += inner === from ? rendered : sql.slice(i, e);
      i = e;
      continue;
    }
    const tag = dollarTagAt(sql, i);
    if (tag) {
      const close = sql.indexOf(tag, i + tag.length);
      const e = close === -1 ? sql.length : close + tag.length;
      out += sql.slice(i, e); i = e; continue;
    }
    const word = /^[A-Za-z_][A-Za-z_0-9$]*/.exec(sql.slice(i));
    if (word) {
      const after = sql.slice(i + word[0].length);
      const isCall = /^\s*\(/.test(after);
      out += !isCall && word[0].toLowerCase() === lower ? rendered : word[0];
      i += word[0].length;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** Index one past the closing `q` of the literal or quoted identifier at `i`. */
export function skipQuoted(s, i, q) {
  i++;
  while (i < s.length) {
    if (s[i] === q) { if (s[i + 1] === q) { i += 2; continue; } return i + 1; }
    if (q === "'" && s[i] === "\\") { i += 2; continue; }
    i++;
  }
  return s.length;
}

/**
 * The first input parameter with no default that FOLLOWS one with a default,
 * or null when the list is legal.
 *
 * `DEFAULT expr` and `= expr` are the two spellings, and this scans for either
 * ANYWHERE in the parameter's text.
 *
 * **Neither parenthesis depth nor string literals are tracked, and the first
 * two drafts tracked both.** Each was removed because a mutation deleting it
 * SURVIVED — byte-identical artifact, green suite — and the reason is
 * structural rather than accidental: in a parameter DECLARATION, a `DEFAULT`
 * or an `=` can only appear at the top level as the default marker, or inside
 * the default EXPRESSION that follows one. Either way the parameter carries a
 * default, which is the only thing this asks. A guard that cannot change an
 * answer is not defence; it is a line no test can justify.
 *
 * What DOES change the answer is the word boundary, and both halves of it have
 * a case in `introspectorRejectedStatements.test.ts`.
 *
 * OUT parameters are exempt from the rule in PostgreSQL. This repository has
 * none, and rather than guess at one it has never seen, an OUT or VARIADIC
 * parameter makes this decline to judge the whole list.
 */
export function firstNonDefaultAfterDefault(argList) {
  let defaulted = null;
  for (const a of argList) {
    if (/^\s*(OUT|INOUT|VARIADIC)\b/i.test(a)) return null;   // not judged — see above
    let hasDefault = false;
    for (let i = 0; i < a.length && !hasDefault; i++) {
      // `p_defaulted_at timestamptz` and `is_default boolean` are parameter
      // NAMES, not defaults. The word boundary rejects the suffix and the
      // preceding-character test rejects the prefix; both are needed, and the
      // test file has a case for each.
      if (a[i] === "=") hasDefault = true;
      else if (/^DEFAULT\b/i.test(a.slice(i)) && !/[A-Za-z0-9_$]/.test(a[i - 1] ?? " ")) hasDefault = true;
    }
    if (hasDefault) { defaulted = a; continue; }
    if (defaulted) return { defaulted, after: a };
  }
  return null;
}
