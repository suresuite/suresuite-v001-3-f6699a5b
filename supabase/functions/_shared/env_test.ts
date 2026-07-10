// Locks the quote-tolerance contract of env.ts: a secret pasted with
// wrapping quotes (the outage mode behind "Invalid URL: '\"https://…\"'")
// must come out clean, while legitimate values pass through untouched.

import { stripWrappingQuotes } from "./env.ts";

function assertEquals(actual: unknown, expected: unknown, msg: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg}\n  actual:   ${a}\n  expected: ${e}`);
}

Deno.test("double-quoted URL paste is unwrapped", () => {
  assertEquals(
    stripWrappingQuotes('"https://innocent-boxer-160775.upstash.io"'),
    "https://innocent-boxer-160775.upstash.io",
    "wrapping double quotes must be stripped",
  );
});

Deno.test("single-quoted paste is unwrapped", () => {
  assertEquals(
    stripWrappingQuotes("'https://example.upstash.io'"),
    "https://example.upstash.io",
    "wrapping single quotes must be stripped",
  );
});

Deno.test("whitespace around and inside the quotes is trimmed", () => {
  assertEquals(
    stripWrappingQuotes('  " https://example.upstash.io "  '),
    "https://example.upstash.io",
    "whitespace outside and inside the quotes must be trimmed",
  );
});

Deno.test("clean values pass through untouched", () => {
  assertEquals(
    stripWrappingQuotes("https://example.upstash.io"),
    "https://example.upstash.io",
    "an unquoted value must be returned as-is",
  );
});

Deno.test("interior or mismatched quotes are preserved", () => {
  assertEquals(
    stripWrappingQuotes(`token-with-'apostrophe`),
    "token-with-'apostrophe",
    "a lone interior quote is part of the value",
  );
  assertEquals(
    stripWrappingQuotes(`"mismatched'`),
    `"mismatched'`,
    "mismatched wrapping quotes must not be stripped",
  );
});

Deno.test("degenerate quote-only values collapse to empty", () => {
  assertEquals(stripWrappingQuotes('""'), "", "empty quoted string is empty");
  assertEquals(stripWrappingQuotes('"'), '"', "a single quote char is left alone");
});
