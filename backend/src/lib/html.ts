const ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export const escapeHtml = (input: string): string =>
  input.replace(/[&<>"']/g, (c) => ESCAPE_MAP[c] ?? c);

/**
 * Build a minimal HTML part from the plain-text body the compose form collects.
 * Deliberately conservative: escape everything, turn blank lines into
 * paragraphs. A real product would let users author rich HTML (and would then
 * need a sanitiser such as DOMPurify on the way in).
 */
export function textToHtml(text: string): string {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, '<br />')}</p>`)
    .join('\n');

  const style =
    'font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#111';
  return `<div style="${style}">\n${paragraphs || '<p></p>'}\n</div>`;
}

/** Crude HTML -> text fallback, only used if a caller supplies HTML but no text. */
export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
