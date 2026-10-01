/**
 * The ConfirmSheet's bullets ARE the existing `confirm()` message, split by
 * sentence (mobile redesign handoff §2.3: "add no new claims").
 *
 * The message's leading question is what the sheet's title restates, so it is
 * removed first — by its exact text, which the call site builds from the same
 * template, rather than by guessing where the first sentence ends. A name can
 * hold a full stop ("Contoso Inc. GmbH"), and the question is where the names
 * are; what is left after it is the app's own fixed wording.
 *
 * Dot colour (§2.3): red for permanent loss, amber for a side effect. Decided
 * from the sentence's own words; a sentence that says what is KEPT, detached or
 * moved is a side effect even when it also says "deleted" ("Detached, not
 * deleted: …").
 */
export type BulletTone = 'red' | 'amber' | 'neutral';
export interface ConfirmBullet {
  text: string;
  tone: BulletTone;
}

const SIDE_EFFECT = /\b(kept|keeps|not deleted|stays?|moves?|stop seeing|detached|none until)\b/i;
const LOSS = /\b(cannot be undone|deleted?|removed?|lost|forever|permanently)\b/i;

export function bulletTone(sentence: string): BulletTone {
  if (SIDE_EFFECT.test(sentence)) return 'amber';
  return LOSS.test(sentence) ? 'red' : 'amber';
}

/** Ends a sentence at . ? or ! followed by whitespace and a capital, a quote or
 *  a bracket — so "1.5", "e.g. foo" and a decimal in a date do not split. */
const SENTENCE_END = /(?<=[.?!])\s+(?=["“(A-Z])/;

export function confirmBullets(
  message: string,
  opts: {
    /** The message's leading question, verbatim; dropped because the title restates it. */
    lead?: string;
    neutral?: boolean;
    /** A message written for `confirm()` explains its buttons as "OK — …" and
     *  "Cancel — …"; on the sheet those words are the button labels. */
    actionLabel?: string;
    cancelLabel?: string;
  } = {},
): ConfirmBullet[] {
  let rest = message.trim();
  if (opts.lead && rest.startsWith(opts.lead)) rest = rest.slice(opts.lead.length);
  return rest
    .split(/\n+/)
    .flatMap((line) => line.split(SENTENCE_END))
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      let text = s;
      if (opts.actionLabel) text = text.replace(/^OK\s+—\s*/, `${opts.actionLabel} — `);
      if (opts.cancelLabel) text = text.replace(/^Cancel\s+—\s*/, `${opts.cancelLabel} — `);
      return { text, tone: opts.neutral ? 'neutral' : bulletTone(s) };
    });
}
