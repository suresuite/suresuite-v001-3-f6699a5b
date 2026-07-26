# Funding logos

Referenced by absolute path from `src/pages/About.tsx` (`/funding/…`). Files in
`public/` are copied verbatim into `dist/` — no hashing, no optimisation.

## ⚠ Attribution rule

The programme logo (ACCURATE, later euroFMX) and the **Funded by the European Union**
logo must always appear together, side by side. Neither is ever shown alone.

`About.tsx` enforces this by rendering `EU_LOGO` *outside* the cross-fade: only the
programme logo swaps, so whichever programme is on screen, the EU logo is beside it.
Never delete `EU_LOGO` or move it inside the `PROGRAMMES.map()`.

When euroFMX replaces ACCURATE for good, reduce `PROGRAMMES` to the single euroFMX
entry — the dots and the auto-advance timer switch themselves off, and the EU logo is
untouched.

The verbatim EU disclaimer text lives on the landing page's funding band
(`src/pages/Landing.tsx`) — this page carries the logo pair, not the legal text.

## Required files

| File | Rendered box | Spec |
| --- | --- | --- |
| `accurate.png` | 168 × 46, `object-contain object-left` | height ≥ 138px, ≤ 504px wide, PNG-24 transparent |
| `eurofmx.png` | 168 × 46, `object-contain object-left` | same — trim surrounding whitespace so the two programmes optically match |
| `funded-by-eu.png` | 158 × 46, `object-contain object-left` | height ≥ 138px. Official EU emblem + "Funded by the European Union" lockup — do not recolour or crop the flag |
| `hwr-berlin.png` | `h-10` | height ≥ 120px, PNG-24 transparent |

SVG is preferable for all four — swap `.png` for `.svg` in the `EU_LOGO` / `PROGRAMMES`
constants and the pixel sizes stop mattering.
