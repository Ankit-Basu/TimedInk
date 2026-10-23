/**
 * Pull email addresses out of an uploaded leads file.
 *
 * Deliberately forgiving about shape, because real lead exports are messy: a
 * CSV with an "email" column, a CSV where the address is in column 7, a plain
 * text file with one address per line, or a paste with commas and semicolons
 * all work. Anything that looks like an address is taken, wherever it is;
 * everything else (names, companies, header rows) is ignored.
 *
 * Runs in the browser, so the file itself never leaves the machine — only the
 * de-duplicated list of addresses is sent to the API.
 */

// Pragmatic, not RFC 5322: the server re-validates every address with zod.
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

export interface ParsedLeads {
  /** Unique, lower-cased, in first-seen order. */
  emails: string[];
  /** How many addresses appeared more than once and were dropped. */
  duplicates: number;
}

export function extractEmails(text: string): ParsedLeads {
  const seen = new Set<string>();
  let duplicates = 0;

  for (const match of text.matchAll(EMAIL_PATTERN)) {
    // Trailing dots come from sentences ("…at ava@x.com.").
    const email = match[0].toLowerCase().replace(/\.+$/, '');
    if (seen.has(email)) duplicates += 1;
    else seen.add(email);
  }

  return { emails: [...seen], duplicates };
}

/** Largest leads file accepted: plenty for 1,000 rows of a wide CSV export. */
export const MAX_LEADS_FILE_BYTES = 5 * 1024 * 1024;

export async function readLeadsFile(file: File): Promise<ParsedLeads> {
  if (file.size > MAX_LEADS_FILE_BYTES) {
    throw new Error(`${file.name} is over 5 MB — split it into smaller files.`);
  }
  return extractEmails(await file.text());
}
