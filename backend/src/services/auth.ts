import bcrypt from 'bcryptjs';
import jwt, { type SignOptions } from 'jsonwebtoken';
import type { User } from '@prisma/client';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { conflict, unauthorized } from '../lib/errors.js';
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
}

export interface AuthResult {
  token: string;
  user: AuthUser;
}

interface JwtPayload {
  sub: string;
  email: string;
  name: string;
}

export const toAuthUser = (user: User): AuthUser => ({
  id: user.id,
  email: user.email,
  name: user.name,
});

/** Emails are matched case-insensitively; store the normalised form. */
export const normaliseEmail = (email: string): string => email.trim().toLowerCase();

export function signToken(user: AuthUser): string {
  const payload: JwtPayload = { sub: user.id, email: user.email, name: user.name };
  const options: SignOptions = { expiresIn: env.JWT_EXPIRES_IN as SignOptions['expiresIn'] };
  return jwt.sign(payload, env.JWT_SECRET, options);
}

export function verifyToken(token: string): AuthUser {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
    return { id: decoded.sub, email: decoded.email, name: decoded.name };
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
