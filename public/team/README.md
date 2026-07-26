# Team portraits

Referenced by absolute path from `src/pages/About.tsx` (`/team/…`), one per entry in
the `PEOPLE` array (`photo` field).

## Required files

| File | Person |
| --- | --- |
| `phu-nguyen.jpg` | Phu Nguyen |
| `dmitry-ivanov.jpg` | Prof. Dr. Dr. habil. Dmitry Ivanov |

## Spec

- **552 × 696** (3× the 92 × 116 render box), JPEG, quality 80
- Crop to 4:5 with the head in the upper third — the frame is filled with `object-cover`

## Portrait not ready yet?

Set that person's `photo` to `null` in the `PEOPLE` array and the card renders a black
monogram tile from their `initials` instead — same 92 × 116 box, so no layout shift when
the real photo lands.
