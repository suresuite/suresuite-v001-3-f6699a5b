/**
 * Who may read the manual, and where a signed-in reader finds it.
 *
 * `DOCS_SUPER_ADMIN_ONLY` (src/lib/ui/docsVisibility.ts) is one flag read in
 * three places — the route guard, the sidebar and the phone drawer — and the
 * failure this file exists for is the three disagreeing: a link a user can see
 * that lands on /forbidden, or a guarded route with no link to it at all. So
 * the rule lives in ONE function (`canAccessPage`) and this file asserts that
 * each surface goes through it rather than carrying its own copy.
 *
 * Source text for the wiring, as in docsEntryPoints.test.ts: rendering App or
 * the Navbar needs auth, Supabase and a viewport to say the same thing less
 * directly.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DOCS_SUPER_ADMIN_ONLY, canReadDocs, isDocsPath } from "../../../lib/ui/docsVisibility";

const ROOT = join(__dirname, "..", "..", "..", "..");
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), "utf8");

const APP = read("src", "App.tsx");
const NAVBAR = read("src", "components", "Navbar.tsx");
const MOBILE_NAV = read("src", "components", "MobileNav.tsx");
const CAPABILITIES = read("src", "hooks", "useCapabilities.tsx");

describe("isDocsPath", () => {
  it.each(["/docs", "/docs/", "/docs/what-suresuite-is", "/help", "/help/getting-started"])(
    "%s is the manual",
    (path) => expect(isDocsPath(path)).toBe(true),
  );

  it.each(["/", "/app", "/docsx", "/helpdesk", "/admin", "/about", "/project-manager"])(
    "%s is not",
    (path) => expect(isDocsPath(path)).toBe(false),
  );
});

describe("canReadDocs follows the flag", () => {
  it("always admits a super admin", () => {
    expect(canReadDocs(true)).toBe(true);
  });

  it(`admits everyone else only when the flag is off (it is ${DOCS_SUPER_ADMIN_ONLY ? "on" : "off"})`, () => {
    expect(canReadDocs(false)).toBe(!DOCS_SUPER_ADMIN_ONLY);
  });
});

describe("one rule, three surfaces", () => {
  it("canAccessPage decides a docs path before any page capability", () => {
    const docs = CAPABILITIES.indexOf("if (isDocsPath(pathname)) return canReadDocs(capabilities.is_super_admin);");
    const pageKey = CAPABILITIES.indexOf("const key = pageKeyForPath(pathname);");
    expect(docs, "canAccessPage no longer consults the docs rule").toBeGreaterThan(-1);
    expect(docs, "the docs rule must run before the page-key lookup, which calls /docs unmanaged and open").toBeLessThan(pageKey);
  });

  it("the sidebar carries a Documentation link to /docs", () => {
    expect(NAVBAR).toMatch(/to: "\/docs",\s*icon: BookText,\s*label: "Documentation"/);
  });

  it("both navigations filter their items through canAccessPage", () => {
    expect(NAVBAR).toMatch(/filterVisibleSections\(NAV_SECTIONS, canAccessPage\)/);
    expect(MOBILE_NAV).toMatch(/filterVisibleSections\(NAV_SECTIONS, canAccessPage\)/);
  });

  it.each([
    ["/docs", /<Route path="\/docs" element={<DocsGate><DocsLayout \/><\/DocsGate>}>/],
    ["/help", /<Route path="\/help" element={<DocsGate>/],
    ["/help/:slug", /<Route path="\/help\/:slug" element={<DocsGate>/],
  ])("App.tsx guards %s with DocsGate", (_path, pattern) => {
    expect(APP).toMatch(pattern);
  });

  it("DocsGate reads the flag and guards through RoleGuard", () => {
    const gate = APP.slice(APP.indexOf("function DocsGate"), APP.indexOf("const queryClient"));
    expect(gate).toContain("DOCS_SUPER_ADMIN_ONLY");
    expect(gate).toContain("<ProtectedRoute>");
    expect(gate).toContain("<RoleGuard>");
  });
});
