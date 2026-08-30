import type { NextFunction, Request, Response } from 'express';
import { unauthorized } from '../lib/errors.js';
import { verifyToken } from '../services/auth.js';

const BEARER_PREFIX = 'Bearer ';

/**
 * Gate for every /api/emails and /api/mailboxes route.
 *
 * Verification is purely cryptographic - no DB round trip per request. The
 * cost is that deleting a user does not invalidate their outstanding tokens
 * until expiry; a token blocklist in Redis is the usual next step.
 */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;

  if (!header?.startsWith(BEARER_PREFIX)) {
    next(unauthorized('Missing Authorization: Bearer <token> header'));
    return;
  }

  const token = header.slice(BEARER_PREFIX.length).trim();
  if (!token) {
    next(unauthorized('Empty bearer token'));
    return;
  }

  try {
    req.user = verifyToken(token);
    next();
  } catch (err) {
    next(err);
  }
}

/** Narrowing helper so handlers do not repeat the non-null assertion. */
export function currentUser(req: Request): { id: string; email: string; name: string } {
  if (!req.user) throw unauthorized();
  return req.user;
}
