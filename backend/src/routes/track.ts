import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.js';
import { TRANSPARENT_PIXEL, recordOpen } from '../services/tracking.js';

export const trackRouter = Router();

const paramSchema = z.object({ id: z.string().uuid() });

/**
 * GET /api/track/:id.png - the open-tracking pixel (bonus C).
 *
 * Deliberately unauthenticated: the request comes from a recipient's mail
 * client, which has no token. The id is a v4 UUID, so it is unguessable, and
 * the worst a forged hit can do is suppress one follow-up.
 *
 * Always returns the pixel, even for an unknown id - a 404 here would leak
 * which ids exist, and a broken image in someone's inbox is a bad look.
 */
trackRouter.get(
  '/:id.png',
  asyncHandler(async (req, res) => {
    const parsed = paramSchema.safeParse({ id: req.params.id });

    if (parsed.success) {
      // Fire-and-forget: never make the recipient wait on our database.
      void recordOpen(parsed.data.id).catch(() => undefined);
    }

    res
      .status(200)
      .set({
        'Content-Type': 'image/png',
        'Content-Length': String(TRANSPARENT_PIXEL.length),
        // Without this, a caching proxy would serve the pixel once and we would
        // never see a second open.
        'Cache-Control': 'no-store, no-cache, must-revalidate, private',
        Pragma: 'no-cache',
        Expires: '0',
      })
      .end(TRANSPARENT_PIXEL);
  }),
);
