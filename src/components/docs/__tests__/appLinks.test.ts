// Every in-app link the manual offers opens something — WP 5.2j.
//
// §4 D110 and D111 are two faces of one failure: the manual pointing at
// something the product does not have, or not pointing at something it does.
// `docsAssets.test.ts` covers the files. This covers the routes.
//
// A documentation page that sends a reader to a URL the router does not serve
// is worse than one that describes the screen without linking it: the reader
// concludes the feature was removed, or that they lack permission, and neither
// is true. It is also exactly the kind of breakage a route rename causes
// silently — nothing in the application imports these strings.

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const BODIES = join(__dirname, "..", "bodies");
const APP = join(__dirname, "..", "..", "..", "App.tsx");

/** Every `path=` the router declares, with its wildcards reduced to a prefix. */
function routes(): string[] {
  const src = readFileSync(APP, "utf8");
  const found = [...src.matchAll(/path="([^"]*)"/g)].map((m) => m[1]);
  if (found.length < 10) {
    throw new Error(`appLinks: parsed ${found.length} routes from App.tsx — the scan has broken`);
  }
  return found;
}

/** React Router's matching, narrowed to what a manual link can be: a literal
 *  path, a `/prefix/*` wildcard, or a route with a `:param` segment. */
function serves(all: string[], link: string): boolean {
  const linkParts = link.split("/").filter(Boolean);
  return all.some((r) => {
    if (r === link) return true;
    if (r.endsWith("/*")) return link === r.slice(0, -2) || link.startsWith(r.slice(0, -1));
    const parts = r.split("/").filter(Boolean);
    if (parts.length !== linkParts.length) return false;
    return parts.every((p, i) => p.startsWith(":") || p === linkParts[i]);
  });
}

describe("every AppLink in the manual opens a route", () => {
  const all = routes();
  const links = new Map<string, string[]>();
  for (const file of readdirSync(BODIES).filter((f) => f.endsWith(".tsx"))) {
    const src = readFileSync(join(BODIES, file), "utf8");
    for (const m of src.matchAll(/<AppLink\s+to="([^"]+)"/g)) {
      if (!links.has(m[1])) links.set(m[1], []);
      links.get(m[1])!.push(file);
    }
  }

  it("found links to check", () => {
    // The vacuity rule: a scan matching nothing would make the assertion below
    // pass over an empty map, which is the shape §4 D57 is.
    expect(links.size).toBeGreaterThanOrEqual(10);
  });

  it.each([...links.keys()].sort())("%s", (link) => {
    expect(
      serves(all, link),
      `the manual links ${link} from ${links.get(link)!.join(", ")}, and App.tsx serves no ` +
        `such route. Either the route was renamed — fix the pages — or the link was a guess.`,
    ).toBe(true);
  });
});
