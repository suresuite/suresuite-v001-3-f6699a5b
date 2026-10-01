/**
 * The temporary password a super admin hands to somebody who forgot theirs (PLAN.md §4 D251).
 *
 * Generated in the super admin's browser so nobody has to invent one — an invented one is
 * usually the same easy word for everybody, which makes every account mid-reset guessable.
 * It reaches the database once, as `admin_reset_user_password`'s argument, and is stored
 * only as a hash; the reset forces a change at the next sign-in, so it only ever opens
 * /profile.
 *
 * Three groups of four from an alphabet with the look-alikes removed (0/O, 1/l/I), so it
 * can be read out over the phone: 12 symbols from 57 is about 70 bits. Drawn with
 * `crypto.getRandomValues` and rejection sampling, so every symbol is equally likely.
 */
export const TEMP_PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
export const TEMP_PASSWORD_GROUPS = 3;
export const TEMP_PASSWORD_GROUP_LENGTH = 4;

type RandomSource = (bytes: Uint8Array) => Uint8Array;

const cryptoRandom: RandomSource = (bytes) => globalThis.crypto.getRandomValues(bytes);

export function generateTemporaryPassword(random: RandomSource = cryptoRandom): string {
  const n = TEMP_PASSWORD_ALPHABET.length;
  // The largest multiple of n below 256: a byte at or above it would favour the first
  // symbols, so it is drawn again.
  const limit = 256 - (256 % n);
  const needed = TEMP_PASSWORD_GROUPS * TEMP_PASSWORD_GROUP_LENGTH;
  const symbols: string[] = [];
  while (symbols.length < needed) {
    for (const b of random(new Uint8Array(needed * 2))) {
      if (b < limit) symbols.push(TEMP_PASSWORD_ALPHABET[b % n]);
      if (symbols.length === needed) break;
    }
  }
  const groups: string[] = [];
  for (let i = 0; i < needed; i += TEMP_PASSWORD_GROUP_LENGTH) {
    groups.push(symbols.slice(i, i + TEMP_PASSWORD_GROUP_LENGTH).join(''));
  }
  return groups.join('-');
}
