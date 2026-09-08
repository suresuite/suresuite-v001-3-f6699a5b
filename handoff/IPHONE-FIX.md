# iPhone fix — safe-area insets are dead

**One-line root cause.** `index.html` omits `viewport-fit=cover`, so on iOS Safari
every `env(safe-area-inset-*)` resolves to **0**. All three bottom-pinned elements
compute their clearance from it, so all three are wrong on a real iPhone — and
correct in a desktop browser at any width, which is why review passed.

Affected, all already-correct code that simply never receives a non-zero inset:

| File | Expression | Value on iPhone today |
|---|---|---|
| `src/components/MobileNav.tsx` | `paddingBottom: 'env(safe-area-inset-bottom)'` | `0` — labels under the home indicator |
| `src/components/Footer.tsx` | `bottom: 'calc(3.5rem + env(safe-area-inset-bottom, 0px))'` | `56px` — flush on the 56px tab bar |
| `src/components/shared/PageLayout.tsx` | `paddingBottom: 'calc(8.5rem + env(safe-area-inset-bottom, 0px))'` | `136px` — under-reserved |

---

## Fix 1 — the viewport (required; nothing else works without it)

`index.html`:

```diff
-  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
+  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
```

That alone makes the existing guards live: the tab bar gains the ~34px inset, the
footer lifts to `56 + 34 = 90px`, and content reserves `136 + 34px`.

## Fix 2 — the footer/tab-bar collision (needed regardless of Fix 1)

The footer's offset is `3.5rem` = 56px, which is exactly `min-h-[56px]` on the tab
bar. With the inset dead they touch; with it live they still touch, because the tab
bar's total height becomes `56 + inset` while the footer only offsets by
`56 + inset`. Correct, but with zero visual gap.

Give it the gap explicitly. `src/components/Footer.tsx`:

```diff
       style={
         isMobile
-          ? { bottom: "calc(3.5rem + env(safe-area-inset-bottom, 0px))" }
+          ? { bottom: "calc(3.5rem + 1px + env(safe-area-inset-bottom, 0px))" }
           : undefined
       }
```

The `1px` is the tab bar's `border-t`, which the offset currently ignores.

## Fix 3 — make the reservation derive, not repeat

`8.5rem` (136px) in `PageLayout` is a hand-summed literal: 56 tab bar + 1 border +
~32 footer + slack. It will drift the next time either element changes height.
Publish the two heights once and compute from them.

`src/components/MobileNav.tsx` — add near the top:

```ts
/** Bottom chrome heights, in px. PageLayout reserves space from these, so a
 *  height change here cannot silently leave content under the tab bar. */
export const MOBILE_TABBAR_H = 56;   // min-h-[56px]
export const MOBILE_TABBAR_BORDER = 1;
```

`src/components/Footer.tsx` — add:

```ts
export const MOBILE_FOOTER_H = 32;   // px-3 py-2 text-xs, single line
```

`src/components/shared/PageLayout.tsx`:

```diff
-import { MobileTabBar, MobileNavDrawer } from '@/components/MobileNav';
+import {
+  MobileTabBar,
+  MobileNavDrawer,
+  MOBILE_TABBAR_H,
+  MOBILE_TABBAR_BORDER,
+} from '@/components/MobileNav';
+import { MOBILE_FOOTER_H } from '@/components/Footer';
```

```diff
         style={
           isMobile
-            ? { paddingBottom: 'calc(8.5rem + env(safe-area-inset-bottom, 0px))' }
+            ? {
+                paddingBottom:
+                  `calc(${MOBILE_TABBAR_H + MOBILE_TABBAR_BORDER + MOBILE_FOOTER_H}px` +
+                  ` + 1rem + env(safe-area-inset-bottom, 0px))`,
+              }
             : undefined
         }
```

`1rem` is breathing room below the last element; the rest is measured chrome.

## Fix 4 — guard it so it cannot regress

`scripts/audit-adaptive-ui.mjs` already walks the source tree. Add one check: any
file using `env(safe-area-inset-` requires `viewport-fit=cover` in `index.html`.

```js
// §2.6 — safe-area guards are inert on iOS without viewport-fit=cover.
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const coverSet = /viewport-fit\s*=\s*cover/.test(html);
if (!coverSet) {
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    const i = src.indexOf('env(safe-area-inset-');
    if (i >= 0) {
      push(file, src.slice(0, i).split('\n').length, 'safe-area-inert', '2.6',
        'env(safe-area-inset-*) resolves to 0 on iOS: index.html lacks viewport-fit=cover');
    }
  }
}
```

Three violations today; zero after Fix 1. Do not baseline these — they are a live
device defect, not backlog.

---

## Verify on the device, not the simulator

Safari at 414px does not reproduce this; the inset only exists on hardware (or a
notched simulator). On the phone, after Fix 1:

1. The five tab labels clear the home indicator, and a tap on "More" registers
   on the first attempt.
2. A gap is visible between the black credit bar and the tab bar.
3. Scroll any page to the bottom: the last row of content clears the credit bar.
4. Rotate to landscape: `viewport-fit=cover` also switches on the left/right
   insets, so check nothing hides behind the notch — spec §2.6 requires sheets to
   go full-height there.

## Why the audit missed it

Every rule in the audit is a static source pattern. The safe-area guards were all
*present and correct in source* — the defect was in the one file the audit never
reads. Fix 4 closes that specific hole; the general lesson is that a static check
cannot see a device-conditional value, so §7's device pass is not optional.
