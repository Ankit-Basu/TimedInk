/**
 * Bonus A — Deliverability Guard.
 *
 * A pure, dependency-free heuristic scorer. It is *informational*: a low score
 * never blocks a send, it just surfaces a badge and a list of flags in the UI.
 *
 * Pure on purpose — no I/O, no clock, no randomness — so it is trivially
 * unit-testable and safe to run inside a request handler.
 */

export interface DeliverabilityFlag {
  /** Stable machine-readable key, used by the UI for ordering/icons. */
  code: string;
  /** Human sentence shown in the dashboard. */
  message: string;
  /** Points subtracted from 100 for this flag. */
  penalty: number;
}

export interface DeliverabilityResult {
  /** 0 (very likely spam-foldered) .. 100 (clean). */
  score: number;
  /** Flat list of human-readable messages, as the brief specifies. */
  flags: string[];
  /** Structured version, persisted for the dashboard. */
  details: DeliverabilityFlag[];
}

/**
 * Words/phrases that correlate with promotional filtering. Deliberately short
 * and boring — a real implementation would use a maintained corpus plus
 * per-tenant tuning, and would learn from actual bounce/spam feedback.
 */
const SPAM_TERMS: readonly string[] = [
  'free', 'act now', 'limited time', 'risk free', 'guarantee', 'guaranteed',
  'no obligation', 'winner', 'you have been selected', 'cash', 'cheap',
  'click here', 'buy now', 'order now', 'urgent', 'congratulations',
  'make money', 'earn extra', 'double your', 'best price', '100%',
  'credit card', 'investment', 'crypto', 'viagra', 'discount', 'promo',
  'special offer', 'exclusive deal', 'apply now', 'call now', 'lowest price',
];

const MAX_SUBJECT_LENGTH = 60;
const URL_PATTERN = /https?:\/\/[^\s<>"')]+/gi;

/** Ratio of A-Z characters among cased letters. Ignores digits/punctuation. */
export function allCapsRatio(input: string): number {
  const letters = input.replace(/[^a-zA-Z]/g, '');
  if (letters.length === 0) return 0;
  const upper = letters.replace(/[^A-Z]/g, '').length;
  return upper / letters.length;
}

export function countLinks(input: string): number {
  return input.match(URL_PATTERN)?.length ?? 0;
}

function findSpamTerms(haystack: string): string[] {
  const lower = haystack.toLowerCase();
  return SPAM_TERMS.filter((term) => lower.includes(term));
}

/**
 * Score an email before it is scheduled.
 *
 * @param subject  Subject line as typed by the user.
 * @param bodyText Plain-text body. An empty string is itself a flag — a
 *                 multipart message with no text/* alternative is a classic
 *                 spam signal.
 */
export function scoreDeliverability(subject: string, bodyText: string): DeliverabilityResult {
  const details: DeliverabilityFlag[] = [];
  const subjectTrimmed = subject.trim();
  const bodyTrimmed = bodyText.trim();

  // --- Missing / empty plain-text body ------------------------------------
  if (bodyTrimmed.length === 0) {
    details.push({
      code: 'MISSING_TEXT_BODY',
      message: 'No plain-text body — HTML-only mail is heavily penalised by spam filters.',
      penalty: 25,
    });
  } else if (bodyTrimmed.length < 25) {
    details.push({
      code: 'THIN_BODY',
      message: 'Body is very short; filters treat near-empty mail as low quality.',
      penalty: 10,
    });
  }

  // --- Empty subject -------------------------------------------------------
  if (subjectTrimmed.length === 0) {
    details.push({
      code: 'MISSING_SUBJECT',
      message: 'Empty subject line.',
      penalty: 20,
    });
  } else if (subjectTrimmed.length > MAX_SUBJECT_LENGTH) {
    details.push({
      code: 'LONG_SUBJECT',
      message: `Subject is ${subjectTrimmed.length} characters; over ${MAX_SUBJECT_LENGTH} gets truncated on mobile.`,
      penalty: 5,
    });
  }

  // --- Spammy vocabulary ---------------------------------------------------
  const subjectSpam = findSpamTerms(subjectTrimmed);
  if (subjectSpam.length > 0) {
    details.push({
      code: 'SPAM_WORDS_SUBJECT',
      message: `Subject contains spam-trigger wording: ${subjectSpam.join(', ')}.`,
      // Subject hits matter more than body hits, and compound.
      penalty: Math.min(30, 10 * subjectSpam.length),
    });
  }

  const bodySpam = findSpamTerms(bodyTrimmed);
  if (bodySpam.length > 0) {
    details.push({
      code: 'SPAM_WORDS_BODY',
      message: `Body contains spam-trigger wording: ${bodySpam.join(', ')}.`,
      penalty: Math.min(20, 4 * bodySpam.length),
    });
  }

  // --- SHOUTING ------------------------------------------------------------
  // Guard on length: "OK" or "RE" shouldn't count as shouting.
  const subjectCaps = allCapsRatio(subjectTrimmed);
  if (subjectTrimmed.length >= 6 && subjectCaps > 0.5) {
    details.push({
      code: 'ALL_CAPS_SUBJECT',
      message: `Subject is ${Math.round(subjectCaps * 100)}% uppercase — reads as shouting.`,
      penalty: 15,
    });
  }

  const bodyCaps = allCapsRatio(bodyTrimmed);
  if (bodyTrimmed.length >= 40 && bodyCaps > 0.4) {
    details.push({
      code: 'ALL_CAPS_BODY',
      message: `Body is ${Math.round(bodyCaps * 100)}% uppercase — reads as shouting.`,
      penalty: 10,
    });
  }

  // --- Punctuation abuse ---------------------------------------------------
  const exclamations = (subjectTrimmed.match(/!/g)?.length ?? 0) + (bodyTrimmed.match(/!/g)?.length ?? 0);
  if (exclamations >= 3) {
    details.push({
      code: 'EXCESSIVE_EXCLAMATION',
      message: `${exclamations} exclamation marks — 2 or fewer reads as human.`,
      penalty: Math.min(15, 5 * (exclamations - 2)),
    });
  }

  // --- Link density --------------------------------------------------------
  const links = countLinks(bodyTrimmed);
  if (links > 3) {
    details.push({
      code: 'TOO_MANY_LINKS',
      message: `${links} links in the body — cold outreach with more than 3 looks like bulk mail.`,
      penalty: Math.min(20, 5 * (links - 3)),
    });
  }

  const totalPenalty = details.reduce((sum, f) => sum + f.penalty, 0);
  const score = Math.max(0, Math.min(100, 100 - totalPenalty));

  return { score, flags: details.map((f) => f.message), details };
}

/** Bucket used by the dashboard badge colour. */
export function deliverabilityBand(score: number): 'good' | 'warning' | 'poor' {
  if (score >= 80) return 'good';
  if (score >= 50) return 'warning';
  return 'poor';
}
