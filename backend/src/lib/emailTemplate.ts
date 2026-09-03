import { escapeHtml } from './html.js';

/**
 * The HTML wrapper every outgoing email gets.
 *
 * Email clients are a decade behind browsers, so none of the app's CSS applies
 * here. The rules this file obeys:
 *
 *   - tables for layout, never flex or grid
 *   - inline styles only; Gmail strips <style> blocks in many contexts
 *   - no web fonts — Georgia and the system sans stack are the closest
 *     available match to Instrument Serif and Inter
 *   - a 600px content column, which is the width every client renders sanely
 *   - hex colours only, no custom properties
 *
 * Visually it is the same restraint as the app: paper ground, a ruled card,
 * ink type, and the amber accent used exactly once as a hairline. Deliberately
 * light-touch — a heavily branded wrapper on a cold email reads as bulk mail,
 * which is the opposite of what this product is for.
 */

const PAPER = '#f4f1e9';
const SURFACE = '#fdfcf8';
const RULE = '#e2dccf';
const INK = '#1c1a15';
const INK_2 = '#5a544a';
const INK_3 = '#766f63';
const ACCENT = '#e5a13c';

const SERIF = "Georgia, 'Times New Roman', serif";
const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export interface EmailTemplateOptions {
  /** Shown small above the message, e.g. the sender's display name. */
  fromName?: string | null;
  /** Rendered as the preheader — the grey line clients show next to the subject. */
  subject?: string;
}

/**
 * Turn the plain-text body into paragraphs.
 *
 * Everything is escaped: the compose form collects plain text, so any angle
 * bracket in it is content, not markup.
 */
function renderParagraphs(text: string): string {
  const blocks = text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  if (blocks.length === 0) return '';

  return blocks
    .map(
      (block) =>
        `<p style="margin:0 0 16px;font-family:${SANS};font-size:15px;line-height:1.6;color:${INK_2};">` +
        `${escapeHtml(block).replace(/\n/g, '<br />')}</p>`,
    )
    .join('\n            ');
}

export function renderEmailHtml(bodyText: string, options: EmailTemplateOptions = {}): string {
  const paragraphs = renderParagraphs(bodyText);

  // The preheader is the preview line in an inbox list. Left empty it fills
  // with whatever text comes first, which is usually the wordmark.
  const preheader = escapeHtml((options.subject ?? '').trim()).slice(0, 140);
  const sender = options.fromName ? escapeHtml(options.fromName) : null;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light" />
<title>${preheader}</title>
</head>
<body style="margin:0;padding:0;background-color:${PAPER};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${PAPER};">
    <tr>
      <td align="center" style="padding:32px 16px;">

        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;background-color:${SURFACE};border:1px solid ${RULE};">

          <!-- masthead -->
          <tr>
            <td style="padding:24px 32px 20px;border-bottom:1px solid ${RULE};">
              <span style="font-family:${SERIF};font-size:17px;letter-spacing:-0.2px;color:${INK};">TimedInk</span>
              ${
                sender
                  ? `<span style="font-family:${SANS};font-size:11px;letter-spacing:1.2px;text-transform:uppercase;color:${INK_3};float:right;padding-top:5px;">${sender}</span>`
                  : ''
              }
            </td>
          </tr>

          <!-- the message -->
          <tr>
            <td style="padding:32px;">
            ${paragraphs}
            </td>
          </tr>

          <!-- one amber hairline, the only accent in the whole thing -->
          <tr>
            <td style="padding:0 32px;">
              <div style="height:1px;background-color:${ACCENT};line-height:1px;font-size:0;">&nbsp;</div>
            </td>
          </tr>

          <tr>
            <td style="padding:16px 32px 24px;">
              <span style="font-family:${SANS};font-size:11px;letter-spacing:1.2px;text-transform:uppercase;color:${INK_3};">Scheduled with TimedInk</span>
            </td>
          </tr>

        </table>

      </td>
    </tr>
  </table>
</body>
</html>`;
}
