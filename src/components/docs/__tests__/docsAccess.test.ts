/**
 * Who may read which part of the manual, and where a reader finds it (§4 D219).
 *
 * Each SECTION of the manual has an audience a super admin sets at /admin/docs
 * — public, internal, confidential — and the failure this file exists for is
 * the surfaces disagreeing about it: a link a reader can see that lands on
 * /forbidden, a search hit in a section they may not open, or a guarded route
 * with no link to it at all. So the rule lives in ONE function
 * (`canReadDocsPath`, reached through `canAccessPage`) and this file asserts
 * both what it answers and that every surface goes through it rather than
 * carrying its own copy.
 *
 * Source text for the wiring, as in docsEntryPoints.test.ts: rendering App or
 * the Navbar needs auth, Supabase and a viewport to say the same thing less
 * directly.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_DOCS_AUDIENCE,
  canReadAnySection,
  canReadDocsPath,
  canReadSection,
  docsReaderLevel,
  hasPublicSection,
  isDocsPath,
  sectionAudience,
  type DocsReleases,
} from "../../../lib/ui/docsVisibility";
import { DOC_GROUPS, getPage } from "../registry";

const ROOT = join(__dirname, "..", "..", "..", "..");
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), "utf8");

const APP = read("src", "App.tsx");
const NAVBAR = read("src", "components", "Navbar.tsx");
const MOBILE_NAV = read("src", "components", "MobileNav.tsx");
const CAPABILITIES = read("src", "hooks", "useCapabilities.tsx");
const DOCS_LAYOUT = read("src", "components", "docs", "DocsLayout.tsx");
const DOCS_HOME = read("src", "components", "docs", "DocsHome.tsx");
const DOC_PAGE = read("src", "components", "docs", "DocPage.tsx");

describe("isDocsPath", () => {
  it.each(["/docs", "/docs/", "/docs/what-suresuite-is", "/help", "/help/getting-started"])(
    "%s is the manual",
    (path) => expect(isDocsPath(path)).toBe(true),
  );

  it.each(["/", "/app", "/docsx", "/helpdesk", "/admin", "/about", "/project-manager", "/admin/docs"])(
    "%s is not",
    (path) => expect(isDocsPath(path)).toBe(false),
  );
});

describe("who is reading", () => {
  it("nobody signed in reads public", () => {
    expect(docsReaderLevel({ signedIn: false, isSuperAdmin: false, hasConfidentialGrant: false })).toBe("public");
    // a stale flag without a session grants nothing
    expect(docsReaderLevel({ signedIn: false, isSuperAdmin: true, hasConfidentialGrant: true })).toBe("public");
  });
  it("any signed-in account reads internal", () => {
    expect(docsReaderLevel({ signedIn: true, isSuperAdmin: false, hasConfidentialGrant: false })).toBe("internal");
  });
  it("a super admin, or an account holding docs_confidential, reads confidential", () => {
    expect(docsReaderLevel({ signedIn: true, isSuperAdmin: true, hasConfidentialGrant: false })).toBe("confidential");
    expect(docsReaderLevel({ signedIn: true, isSuperAdmin: false, hasConfidentialGrant: true })).toBe("confidential");
  });
});

describe("the rule, section by section", () => {
  const releases: DocsReleases = { overview: "public", "getting-started": "internal", access: "confidential" };
  const overviewPage = DOC_GROUPS.find((g) => g.key === "overview")!.pages[0].slug;
  const startedPage = DOC_GROUPS.find((g) => g.key === "getting-started")!.pages[0].slug;
  const accessPage = DOC_GROUPS.find((g) => g.key === "access")!.pages[0].slug;

  it.each([
    ["public", overviewPage, true],
    ["public", startedPage, false],
    ["public", accessPage, false],
    ["internal", overviewPage, true],
    ["internal", startedPage, true],
    ["internal", accessPage, false],
    ["confidential", overviewPage, true],
    ["confidential", startedPage, true],
    ["confidential", accessPage, true],
  ] as const)("a %s reader on /docs/%s → %s", (level, slug, expected) => {
    expect(canReadDocsPath(`/docs/${slug}`, releases, level)).toBe(expected);
  });

  it("the front door opens when any section is open to the reader", () => {
    expect(canReadDocsPath("/docs", releases, "public")).toBe(true);
    expect(canReadDocsPath("/docs", { access: "confidential" }, "internal")).toBe(false);
    expect(canReadDocsPath("/help", releases, "public")).toBe(true);
    // an unknown slug follows the front door; DocPage answers it with "no such page"
    expect(canReadDocsPath("/docs/no-such-page", releases, "public")).toBe(true);
  });

  it("FAILS CLOSED: no row, an unknown section and unreadable releases are all confidential", () => {
    expect(DEFAULT_DOCS_AUDIENCE).toBe("confidential");
    expect(sectionAudience({}, "overview")).toBe("confidential");
    expect(sectionAudience(null, "overview")).toBe("confidential");
    expect(sectionAudience({ overview: "everyone" as never }, "overview")).toBe("confidential");
    expect(canReadAnySection(null, "internal")).toBe(false);
    expect(canReadAnySection(null, "confidential")).toBe(true);
    expect(hasPublicSection(null)).toBe(false);
    for (const g of DOC_GROUPS) expect(canReadSection(null, g.key, "public")).toBe(false);
  });

  it("the public site's links follow whether any section is public", () => {
    expect(hasPublicSection(releases)).toBe(true);
    expect(hasPublicSection({ overview: "internal" })).toBe(false);
  });

  it("a page's section is the group it sits in", () => {
    expect(getPage(accessPage)?.sectionKey).toBe("access");
  });
});

describe("one rule, every surface", () => {
  it("canAccessPage decides a docs path before the signed-in check and before any page capability", () => {
    const docs = CAPABILITIES.indexOf("if (isDocsPath(pathname)) return canReadDocsPath(pathname, docsReleases, docsLevel);");
    const signedIn = CAPABILITIES.indexOf("if (!capabilities) return false;\n      const key = pageKeyForPath(pathname);");
    expect(docs, "canAccessPage no longer consults the docs rule").toBeGreaterThan(-1);
    expect(signedIn, "the signed-in check moved").toBeGreaterThan(-1);
    expect(docs, "a public section is open to a reader with no capabilities, so the docs rule runs first").toBeLessThan(signedIn);
  });

  it("the reader's level reads the docs_confidential grant through the capability resolver", () => {
    expect(CAPABILITIES).toMatch(/hasConfidentialGrant: capabilities \? canFeature\('docs_confidential'\) : false/);
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

  it("DocsGate waits for the releases, then asks canAccessPage — and renders nothing it refuses", () => {
    const gate = APP.slice(APP.indexOf("function DocsGate"), APP.indexOf("const queryClient"));
    expect(gate).toContain("docs.loading");
    expect(gate).toContain("canAccessPage('/docs')");
    expect(gate).toContain('<Navigate to="/auth"');
    expect(gate).toContain('<Navigate to="/forbidden"');
    expect(gate).toContain("passwordStatus(user).mustChange");
  });

  it("the manual's own navigation, search, pager and related links follow the section rule", () => {
    expect(DOCS_LAYOUT).toContain("DOC_GROUPS.filter((g) => docs.canReadSection(g.key))");
    expect(DOCS_LAYOUT).toContain("searchPages(q, docs.canReadSection)");
    expect(DOCS_LAYOUT).toContain("prevNext(slug, docs.canReadSection)");
    expect(DOCS_LAYOUT).toMatch(/docs\.canReadSection\(p\.sectionKey\)/);
    expect(DOCS_HOME).toContain("DOC_GROUPS.filter((g) => docs.canReadSection(g.key))");
  });

  it("a page in a closed section says so rather than rendering its body", () => {
    const check = DOC_PAGE.indexOf("if (!docs.canReadSection(page.sectionKey)) return <NotReleased slug={slug} />;");
    const body = DOC_PAGE.indexOf("const Body = DOC_BODIES[slug];");
    expect(check).toBeGreaterThan(-1);
    expect(check, "the section check must come before the body is resolved").toBeLessThan(body);
  });
});
