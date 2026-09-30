/**
 * The avatar palette (PLAN.md §4 D206). A user picks the colour of the initial on their
 * avatar; the image upload is retired. The TOKENS are the database's — the CHECK on
 * `approved_users.avatar_color` in `20260929000003` — and `avatarColors.test.ts` fails
 * if this list and that one differ. The CLASSES are this file's: each is a literal
 * string so Tailwind's scan finds it, a 600 fill so white ink reads in both themes.
 * `null` is no choice, which renders the theme's primary colour.
 */
export const AVATAR_COLORS = {
  slate: { label: 'Slate', className: 'bg-slate-600 text-white' },
  red: { label: 'Red', className: 'bg-red-600 text-white' },
  orange: { label: 'Orange', className: 'bg-orange-600 text-white' },
  amber: { label: 'Amber', className: 'bg-amber-600 text-white' },
  green: { label: 'Green', className: 'bg-green-600 text-white' },
  teal: { label: 'Teal', className: 'bg-teal-600 text-white' },
  blue: { label: 'Blue', className: 'bg-blue-600 text-white' },
  indigo: { label: 'Indigo', className: 'bg-indigo-600 text-white' },
  violet: { label: 'Violet', className: 'bg-violet-600 text-white' },
  pink: { label: 'Pink', className: 'bg-pink-600 text-white' },
} as const;

export type AvatarColor = keyof typeof AVATAR_COLORS;

export const DEFAULT_AVATAR_CLASS = 'bg-primary text-primary-foreground';

export function isAvatarColor(v: unknown): v is AvatarColor {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(AVATAR_COLORS, v);
}

/** The fill for an avatar's initial; an unknown or missing token is the default. */
export function avatarClass(color: string | null | undefined): string {
  return isAvatarColor(color) ? AVATAR_COLORS[color].className : DEFAULT_AVATAR_CLASS;
}
