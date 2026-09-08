# PATCH 3 — why the phone doesn't look like the demo

**The mobile shell is real, correct, and not mounted on the screen you land on.**

`src/pages/GettingStarted.tsx` — the `/app` home route, the first screen after
sign-in — does not use `PageLayout`. It renders the desktop sidebar directly:

```
line   1:  import Navbar from "@/components/Navbar";
line 165:  <Navbar isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed} />
```

That `<Navbar>` is **not** wrapped in `hidden md:block`. Every other app page
goes through `PageLayout`, which does three things this page therefore misses:

| `PageLayout` provides | GettingStarted gets |
|---|---|
| `<div className="hidden md:block"><Navbar …/></div>` | the 192px sidebar, at every width |
| `<MobileTabBar>` — Home · Policies · Lab · AI · More | nothing |
| `<MobileNavDrawer>` | nothing |
| bottom reservation + `env(safe-area-inset-bottom)` | nothing |

So on both iOS and Android the home screen shows a desktop sidebar eating half a
320–414px viewport, no bottom tab bar, and no way to reach Policies, the Lab or
AI — because on mobile the tab bar **is** the navigation. The app is not
"partly there"; the entry point has no mobile shell at all, which is exactly what
you are seeing.

It also carries `max-w-7xl mx-auto` at lines 54, 80 and 372, against contract C1
(app pages: full width, no `max-w`, no `mx-auto`).

**This is my failure, not the implementation's.** Page book entries 04 and 18
say the shell "landed". I verified that `MobileNav.tsx` exists and that
`PageLayout` mounts it — and never checked which pages use `PageLayout`. One
`grep` for `PageLayout` across `src/pages` would have shown `GettingStarted`
missing from the list. Gate G would not catch this either: it checks copy
strings, not whether a page is wrapped in the right layout.

---

## 1 · Put GettingStarted on PageLayout

`src/pages/GettingStarted.tsx`

FIND
```
import Navbar from "@/components/Navbar";
```
REPLACE
```
import { PageLayout } from "@/components/shared/PageLayout";
```

Then replace the page's own shell. Find the `<Navbar …/>` at line 165 and the
wrapper `<div>` that follows it, and restructure so the page body is a child of
`PageLayout`:

```tsx
return (
  <PageLayout isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed}>
    {/* the page's existing content, unchanged */}
  </PageLayout>
);
```

`PageLayout` already owns the sidebar (desktop-only), the tab bar, the drawer,
the credit footer and the bottom reservation — so delete the page's own `<Navbar>`
and any `ml-48` / `ml-14` sidebar-offset wrapper it applies. Keep `isCollapsed`
state: `PageLayout` takes it as props.

**Do not restyle the page while you are in there.** Its gradients, `rounded-2xl`
cards and step markers stay exactly as they are — the visual-dialect question
(book entry 04) is a separate, open decision. This patch only gives the page the
shell every other page already has.

## 2 · Drop the three `max-w-7xl mx-auto`

Lines 54, 80, 372. Replace `max-w-7xl mx-auto` with nothing (keep any other
classes on those elements). Contract C1: app pages are full width; `PageHeader`
bleeds out with `-mx-12 -mt-6` and a centred max-width container breaks it.

## 3 · The four other orphan pages

Neither `PageLayout` nor `Navbar` — so they render with no navigation at all. A
user who lands on one is stranded, with no tab bar to leave by:

- `src/pages/Forbidden.tsx` — reached by `RoleGuard`, i.e. exactly when a user
  needs a way out. Book entry 24 says its action returns to the first page they
  may open; without the shell there is no other route.
- `src/pages/help/HelpPage.tsx`
- `src/pages/NotFound.tsx`
- `src/pages/About.tsx` — public, linked from the landing page. If About is
  meant to be public, leaving it shell-less is correct; if it is reachable from
  inside the app, it needs the shell. **Your call.**

Wrap the first three in `PageLayout` the same way. `OrbitMrpCallback.tsx` is a
redirect target and correctly has no chrome.

---

## Verify — on the phone, not the simulator

This is the one that matters, because it is the failure you actually saw:

1. Sign in on the phone. The home screen must show **no sidebar** and a
   five-item bottom tab bar: Home · Policies · Lab · AI · More.
2. Tap each of the four tabs. Each loads its page and the tab bar stays.
3. Tap **More** — the drawer opens with the full nav inventory, the account row
   and Log out.
4. Scroll to the bottom of the home screen: the last row of content clears the
   black credit bar, and the credit bar clears the tab bar.
5. At 320px, `document.documentElement.scrollWidth > innerWidth` is `false`.
6. Desktop at 1280: the home page is unchanged — same sidebar, same layout.

```bash
npm run verify:mobile && npm run lint && npm run build
```

Commit:

```
fix(mobile): mount the mobile shell on GettingStarted and the orphan pages

GettingStarted rendered Navbar directly instead of going through
PageLayout, so the /app home route — the first screen after sign-in —
had the desktop sidebar at every width and no tab bar, drawer or
bottom safe-area reservation. Forbidden, HelpPage and NotFound had no
chrome at all. Also drops three max-w-7xl mx-auto containers (C1).

No visual change to GettingStarted's own content; the legacy-dialect
question is unaffected and still open.
```

---

## The check that should have existed

Add this to `verify-repo.mjs` as a new gate so it cannot recur: every file under
`src/pages/` that is not in a known-public allowlist (`Landing`, `Auth`,
`OrbitMrpCallback`, and `About` if you decide it is public) must import
`PageLayout` — or, for admin pages, `AdminLayout`. A page that renders `Navbar`
directly should fail outright.

That is a five-line check, and it would have caught this before deployment
instead of after.
