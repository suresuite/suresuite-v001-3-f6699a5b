/**
 * Whether the public site advertises the manual (PLAN.md §6.5).
 *
 * §6.5's argument is that a prospective customer, a researcher and a new
 * modeller all ask the same opening question, and that answering it should not
 * require an account — so the manual is public and every public page links to
 * it. This flag suspends the ADVERTISING of it, not the manual itself: the
 * `/docs` routes stay served, every page still renders, and a direct URL or a
 * search result still opens. What goes away is the Docs link in the desktop top
 * bar, the Docs link in the phone drawer, the Documentation section on the
 * landing page, and the Docs link in both public footers.
 *
 * ONE CONSTANT, AND THE GATE READS IT TOO. `docsEntryPoints.test.ts` exists
 * because a link is one attribute in a nav and removing it breaks no build, no
 * type and no render — the orphaned page goes on rendering perfectly for anyone
 * who already knows the address, and nothing else in the suite would notice.
 * Deleting the markup would have meant deleting that gate, which is the same
 * failure one level up: the invariant would survive as a comment. Instead the
 * test branches on this value — with the flag on it asserts every surface links
 * to the manual, and with it off it asserts every one of those surfaces is
 * still GUARDED by this constant rather than quietly gone. Flipping this line
 * back to `true` restores the links and the original assertions together.
 *
 * Typed `boolean` on purpose: as a literal type, TypeScript narrows every
 * `FLAG && <…>` to `false` and the guarded markup stops being typechecked.
 */
export const DOCS_PUBLIC_ENTRY_POINTS: boolean = false;
