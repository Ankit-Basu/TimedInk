import { env } from '../config/env.js';
import { childLogger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { recordEvent } from './events.js';

const log = childLogger('tracking');

/**
 * Bonus C - open tracking.
 *
 * A 1x1 transparent PNG served from GET /api/track/:id.png. When a client with
 * images enabled renders the mail, the request lands here and we write an
 * OPENED event. That event is what suppresses the follow-up.
 *
 * Caveat worth stating out loud: pixel tracking is a lower bound on opens.
 * Gmail proxies images (so opens can be attributed to a prefetch), Apple Mail
 * Privacy Protection fires it unconditionally, and text-only clients never
 * fire it at all. Treat "no OPENED event" as "no evidence of an open".
 */

/** 1x1 fully transparent PNG, 68 bytes. */
export const TRANSPARENT_PIXEL: Buffer = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

export const trackingPixelUrl = (scheduledEmailId: string): string =>
  `${env.APP_BASE_URL.replace(/\/$/, '')}/api/track/${scheduledEmailId}.png`;

/**
 * Append the pixel just before the closing tag of the body wrapper so it lands
 * inside the rendered document rather than after it.
 */
export function injectTrackingPixel(html: string, scheduledEmailId: string): string {
  const img =
    `<img src="${trackingPixelUrl(scheduledEmailId)}" width="1" height="1" ` +
    `alt="" style="display:none;width:1px;height:1px;border:0" />`;

  const closingDiv = html.lastIndexOf('</div>');
  if (closingDiv !== -1) {
    return `${html.slice(0, closingDiv)}${img}${html.slice(closingDiv)}`;
  }
  return `${html}${img}`;
}

/**
 * Record an open. Idempotent: the first hit wins, later hits are ignored so the
 * timeline is not spammed by a client that re-renders the message.
 */
export async function recordOpen(scheduledEmailId: string): Promise<void> {
  const email = await prisma.scheduledEmail.findUnique({
    where: { id: scheduledEmailId },
    select: { id: true, openedAt: true },
  });

  if (!email || email.openedAt) return;

  await prisma.scheduledEmail.update({
    where: { id: scheduledEmailId },
    data: { openedAt: new Date() },
  });
  await recordEvent(scheduledEmailId, 'OPENED', { source: 'pixel' });
  log.info({ emailId: scheduledEmailId }, 'open tracked');
}
