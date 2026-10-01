/**
 * D233 — the temporary password a super admin hands out. It must meet the database's
 * minimum (`admin_reset_user_password` refuses fewer than 8 characters), avoid symbols
 * that read alike, and draw every symbol with equal probability.
 */
import { describe, expect, it } from 'vitest';
import {
  TEMP_PASSWORD_ALPHABET, TEMP_PASSWORD_GROUPS, TEMP_PASSWORD_GROUP_LENGTH, generateTemporaryPassword,
} from '../temporaryPassword';

const SHAPE = new RegExp(
  `^[${TEMP_PASSWORD_ALPHABET}]{${TEMP_PASSWORD_GROUP_LENGTH}}(-[${TEMP_PASSWORD_ALPHABET}]{${TEMP_PASSWORD_GROUP_LENGTH}}){${TEMP_PASSWORD_GROUPS - 1}}$`,
);

describe('generateTemporaryPassword', () => {
  it('is three groups of four from the alphabet, and longer than the database minimum', () => {
    for (let i = 0; i < 200; i++) {
      const p = generateTemporaryPassword();
      expect(p).toMatch(SHAPE);
      expect(p.length).toBeGreaterThanOrEqual(8);
    }
  });

  it('leaves out the symbols that read alike', () => {
    for (const c of '0O1lI') expect(TEMP_PASSWORD_ALPHABET).not.toContain(c);
    expect(new Set(TEMP_PASSWORD_ALPHABET).size).toBe(TEMP_PASSWORD_ALPHABET.length);
  });

  it('draws again rather than favour the first symbols', () => {
    // 255 is above the largest multiple of the alphabet size below 256, so a source that
    // returns it first must be skipped; 0 then maps to the first symbol every time.
    let calls = 0;
    const source = (bytes: Uint8Array) => {
      calls++;
      bytes.fill(0);
      if (calls === 1) bytes.fill(255);
      return bytes;
    };
    const first = TEMP_PASSWORD_ALPHABET[0].repeat(TEMP_PASSWORD_GROUP_LENGTH);
    expect(generateTemporaryPassword(source)).toBe(Array(TEMP_PASSWORD_GROUPS).fill(first).join('-'));
    expect(calls).toBe(2);
  });

  it('does not repeat itself', () => {
    const seen = new Set(Array.from({ length: 500 }, () => generateTemporaryPassword()));
    expect(seen.size).toBe(500);
  });
});
