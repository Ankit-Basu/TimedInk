import { describe, expect, it } from 'vitest';
import {
  allCapsRatio,
  countLinks,
  deliverabilityBand,
  scoreDeliverability,
} from '../../src/services/deliverability.js';

const codesOf = (subject: string, body: string): string[] =>
  scoreDeliverability(subject, body).details.map((f) => f.code);

const CLEAN_SUBJECT = 'Quick question about your outbound stack';
const CLEAN_BODY =
  'Hi Priya,\n\nI noticed your team is hiring SDRs. We help teams like yours keep ' +
  'deliverability high while ramping volume. Worth a short chat next week?\n\nThanks,\nAva';

describe('scoreDeliverability', () => {
  it('gives a clean, human-sounding email full marks', () => {
    const result = scoreDeliverability(CLEAN_SUBJECT, CLEAN_BODY);
    expect(result.score).toBe(100);
    expect(result.flags).toEqual([]);
  });

  it('never returns a score outside 0-100, however bad the input', () => {
    const awful = scoreDeliverability(
      'FREE CASH!!! ACT NOW WINNER GUARANTEED 100% DISCOUNT BUY NOW URGENT',
      '',
    );
    expect(awful.score).toBeGreaterThanOrEqual(0);
    expect(awful.score).toBeLessThanOrEqual(100);
  });

  it('flags a missing plain-text body', () => {
    expect(codesOf(CLEAN_SUBJECT, '')).toContain('MISSING_TEXT_BODY');
    expect(codesOf(CLEAN_SUBJECT, '   \n  ')).toContain('MISSING_TEXT_BODY');
  });

  it('flags an empty subject', () => {
    expect(codesOf('', CLEAN_BODY)).toContain('MISSING_SUBJECT');
  });

  it('flags spam vocabulary, and weighs the subject more heavily than the body', () => {
    const inSubject = scoreDeliverability('Act now for a free guarantee', CLEAN_BODY);
    const inBody = scoreDeliverability(CLEAN_SUBJECT, `${CLEAN_BODY}\n\nAct now for a free guarantee.`);

    expect(inSubject.details.map((f) => f.code)).toContain('SPAM_WORDS_SUBJECT');
    expect(inBody.details.map((f) => f.code)).toContain('SPAM_WORDS_BODY');
    expect(inSubject.score).toBeLessThan(inBody.score);
  });

  it('flags shouting subjects but not short ones like "RE"', () => {
    expect(codesOf('URGENT PLEASE READ THIS NOW', CLEAN_BODY)).toContain('ALL_CAPS_SUBJECT');
    // Too short to judge — must not be flagged.
    expect(codesOf('RE', CLEAN_BODY)).not.toContain('ALL_CAPS_SUBJECT');
  });

  it('flags excessive exclamation marks, but tolerates one or two', () => {
    expect(codesOf('Thanks!', `${CLEAN_BODY}!`)).not.toContain('EXCESSIVE_EXCLAMATION');
    expect(codesOf('Hi!!!', `${CLEAN_BODY}!!`)).toContain('EXCESSIVE_EXCLAMATION');
  });

  it('flags link-heavy bodies past three links', () => {
    const threeLinks = 'See https://a.com and https://b.com and https://c.com';
    const sixLinks = `${threeLinks} and https://d.com https://e.com https://f.com`;

    expect(codesOf(CLEAN_SUBJECT, threeLinks)).not.toContain('TOO_MANY_LINKS');
    expect(codesOf(CLEAN_SUBJECT, sixLinks)).toContain('TOO_MANY_LINKS');
  });

  it('flags an over-long subject that would be truncated on mobile', () => {
    expect(codesOf('x'.repeat(80), CLEAN_BODY)).toContain('LONG_SUBJECT');
  });

  it('produces one human-readable message per structured flag', () => {
    const result = scoreDeliverability('FREE MONEY!!!', '');
    expect(result.flags).toHaveLength(result.details.length);
    expect(result.flags.every((f) => typeof f === 'string' && f.length > 0)).toBe(true);
  });

  it('is pure — the same input always scores the same', () => {
    const a = scoreDeliverability('Act now', 'Click here for a free discount!!!');
    const b = scoreDeliverability('Act now', 'Click here for a free discount!!!');
    expect(a).toEqual(b);
  });
});

describe('allCapsRatio', () => {
  it('ignores digits and punctuation', () => {
    expect(allCapsRatio('ABC-123!')).toBe(1);
    expect(allCapsRatio('abc')).toBe(0);
  });

  it('returns 0 for input with no letters at all', () => {
    expect(allCapsRatio('123 !!! ---')).toBe(0);
    expect(allCapsRatio('')).toBe(0);
  });

  it('measures a mixed string', () => {
    expect(allCapsRatio('AAbb')).toBe(0.5);
  });
});

describe('countLinks', () => {
  it('counts http and https urls', () => {
    expect(countLinks('none here')).toBe(0);
    expect(countLinks('go to https://a.com and http://b.org now')).toBe(2);
  });
});

describe('deliverabilityBand', () => {
  it('buckets scores for the dashboard badge', () => {
    expect(deliverabilityBand(100)).toBe('good');
    expect(deliverabilityBand(80)).toBe('good');
    expect(deliverabilityBand(79)).toBe('warning');
    expect(deliverabilityBand(50)).toBe('warning');
    expect(deliverabilityBand(49)).toBe('poor');
    expect(deliverabilityBand(0)).toBe('poor');
  });
});
