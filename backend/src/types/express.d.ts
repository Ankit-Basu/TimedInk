import type { AuthUser } from '../services/auth.js';

/**
 * Augment Express' Request with the authenticated principal set by
 * `requireAuth`. Declaring it here keeps every handler honest without a cast.
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export {};
