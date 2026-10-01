// postcss/desktop-md.js
//
// Teaches Tailwind's `md:` the one exception `useIsMobile()` makes: a touch
// phone held sideways is mobile even though it is 768px+ wide (mobile redesign
// handoff §0). Tailwind cannot say this in `screens` — an object-valued screen
// switches off the `min-[…]:` variants the desktop uses at 1920/2560px and
// changes how screen variants sort — so the rule is applied to the CSS it emits:
//
//   @media (min-width: 768px) { R }
//     →  @media (min-width: 768px) { @media not all and <phone landscape> { R } }
//
// A mouse desktop never matches `(pointer: coarse)`, so on desktop the inner
// query is always true and every rule applies exactly as before: same
// selectors, same order, same specificity. On a landscape phone every `md:`
// rule switches off together, so the mobile skin's `md:` resets, the
// `hidden md:block` sidebar and the `md:hidden` tab bar all agree with the hook.
//
// The condition is mirrored from PHONE_LANDSCAPE_MEDIA in
// src/hooks/use-is-mobile.ts; `useIsMobile.test.ts` fails if they drift.

export const DESKTOP_MD_MEDIA = '(min-width: 768px)';
export const PHONE_LANDSCAPE_MEDIA = '(pointer: coarse) and (max-height: 500px)';
export const NOT_PHONE_LANDSCAPE_MEDIA = `not all and ${PHONE_LANDSCAPE_MEDIA}`;

export default function desktopMd() {
  return {
    postcssPlugin: 'desktop-md',
    OnceExit(root, { AtRule }) {
      root.walkAtRules('media', (rule) => {
        if (rule.params.trim() !== DESKTOP_MD_MEDIA) return;
        const only = rule.nodes?.length === 1 ? rule.nodes[0] : null;
        if (only?.type === 'atrule' && only.name === 'media' && only.params === NOT_PHONE_LANDSCAPE_MEDIA) return;
        const inner = new AtRule({ name: 'media', params: NOT_PHONE_LANDSCAPE_MEDIA });
        for (const node of [...rule.nodes]) inner.append(node);
        rule.append(inner);
      });
    },
  };
}
desktopMd.postcss = true;
