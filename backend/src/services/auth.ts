import bcrypt from 'bcryptjs';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import type { User } from '@prisma/client';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { badRequest, conflict, unauthorized } from '../lib/errors.js';
import { childLogger } from '../lib/logger.js';

const log = childLogger('auth');

/**
 * Auth model: stateless JWT sent as `Authorization: Bearer <token>`.
 *
 * Chosen over an httpOnly cookie because the API and the SPA sit on different
 * origins in development, which would otherwise mean SameSite=None + credentialed
 * CORS + CSRF protection for no benefit at this scale. The trade-off - a token
 * in localStorage is readable by any XSS on the page - is recorded in
 * ASSUMPTIONS.md. A production build would move to httpOnly + refresh tokens.
 */

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  /** Google profile picture; null for email + password accounts. */
  avatarUrl: string | null;
}

export interface AuthResult {
  token: string;
  user: AuthUser;
}

interface JwtPayload {
  sub: string;
  email: string;
  name: string;
  avatarUrl?: string | null;
}

export const toAuthUser = (user: User): AuthUser => ({
  id: user.id,
  email: user.email,
  name: user.name,
  avatarUrl: user.avatarUrl ?? null,
});

/** Emails are matched case-insensitively; store the normalised form. */
export const normaliseEmail = (email: string): string => email.trim().toLowerCase();

export function signToken(user: AuthUser): string {
  const payload: JwtPayload = {
    sub: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
  };
  const options: SignOptions = { expiresIn: env.JWT_EXPIRES_IN as SignOptions['expiresIn'] };
  return jwt.sign(payload, env.JWT_SECRET, options);
}

export function verifyToken(token: string): AuthUser {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
    return {
      id: decoded.sub,
      email: decoded.email,
      name: decoded.name,
      avatarUrl: decoded.avatarUrl ?? null,
    };
  } catch {
    // Deliberately opaque: never leak whether it was expired vs. forged.
    throw unauthorized('Invalid or expired token');
  }
}

export const hashPassword = (plain: string): Promise<string> =>
  bcrypt.hash(plain, env.BCRYPT_ROUNDS);

export async function registerUser(
  email: string,
  password: string,
  name: string,
): Promise<AuthResult> {
  const normalised = normaliseEmail(email);

  const existing = await prisma.user.findUnique({ where: { email: normalised } });
  if (existing) throw conflict('An account with that email already exists');

  const user = await prisma.user.create({
    data: { email: normalised, passwordHash: await hashPassword(password), name: name.trim() },
  });

  log.info({ userId: user.id, email: user.email }, 'user registered');
  const authUser = toAuthUser(user);
  return { token: signToken(authUser), user: authUser };
}

export async function loginUser(email: string, password: string): Promise<AuthResult> {
  const user = await prisma.user.findUnique({ where: { email: normaliseEmail(email) } });

  // Compare against a dummy hash when the user is missing so that a wrong email
  // and a wrong password take the same amount of time (no user enumeration via
  // response latency).
  const hash = user?.passwordHash ?? '$2b$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidi';
  const ok = await bcrypt.compare(password, hash);

  if (!user || !ok) throw unauthorized('Incorrect email or password');

  log.info({ userId: user.id }, 'user logged in');
  const authUser = toAuthUser(user);
  return { token: signToken(authUser), user: authUser };
}

let googleClient: OAuth2Client | null = null;

/**
 * Sign in with a Google ID token (the `credential` Google Identity Services
 * hands the browser).
 *
 * The token is verified server-side — signature, issuer, expiry and, crucially,
 * that its audience is OUR client id — so a token minted for some other app
 * cannot be replayed here. Then:
 *   - a user already linked to this Google account signs straight in;
 *   - an existing email + password account with the same verified address is
 *     linked to Google on first use, rather than duplicated;
 *   - otherwise a new account is created with no password.
 */
export async function loginWithGoogle(credential: string): Promise<AuthResult> {
  if (!env.GOOGLE_CLIENT_ID) throw badRequest('Google sign-in is not configured on this server');

  googleClient ??= new OAuth2Client(env.GOOGLE_CLIENT_ID);

  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: env.GOOGLE_CLIENT_ID,
    });
    payload = ticket.getPayload();
  } catch (err) {
    log.warn({ err: err instanceof Error ? err.message : err }, 'rejected Google credential');
    throw unauthorized('Google sign-in failed: the credential could not be verified');
  }

  if (!payload?.sub || !payload.email) {
    throw unauthorized('Google sign-in failed: the credential has no email');
  }
  // Linking on an unverified address would let anyone claim an account.
  if (!payload.email_verified) {
    throw unauthorized('Google sign-in failed: that Google email address is not verified');
  }

  const email = normaliseEmail(payload.email);
  const profile = {
    googleId: payload.sub,
    avatarUrl: payload.picture ?? null,
    name: payload.name?.trim() || email.split('@')[0]!,
  };

  const existing =
    (await prisma.user.findUnique({ where: { googleId: payload.sub } })) ??
    (await prisma.user.findUnique({ where: { email } }));

  const user = existing
    ? await prisma.user.update({
        where: { id: existing.id },
        // Keep a name the user already has; refresh the link and picture.
        data: { googleId: profile.googleId, avatarUrl: profile.avatarUrl },
      })
    : await prisma.user.create({ data: { email, ...profile } });

  log.info({ userId: user.id, linked: Boolean(existing) }, 'user signed in with Google');
  const authUser = toAuthUser(user);
  return { token: signToken(authUser), user: authUser };
}
