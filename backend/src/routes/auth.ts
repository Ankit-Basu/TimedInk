import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.js';
import { validate, validated } from '../middleware/validate.js';
import { requireAuth, currentUser } from '../middleware/auth.js';
import { loginUser, registerUser } from '../services/auth.js';

export const authRouter = Router();

const registerSchema = z.object({
  email: z.email('Must be a valid email address'),
  // 8 chars is the floor; bcrypt silently truncates past 72 bytes, so cap it.
  password: z.string().min(8, 'Password must be at least 8 characters').max(72),
  name: z.string().trim().min(1, 'Name is required').max(120),
});

const loginSchema = z.object({
  email: z.email('Must be a valid email address'),
  password: z.string().min(1, 'Password is required').max(72),
});

type RegisterBody = z.infer<typeof registerSchema>;
type LoginBody = z.infer<typeof loginSchema>;

/** POST /api/auth/register -> { token, user } */
authRouter.post(
  '/register',
  validate({ body: registerSchema }),
  asyncHandler(async (_req, res) => {
    const body = validated<RegisterBody>(res, 'body');
    const result = await registerUser(body.email, body.password, body.name);
    res.status(201).json({ data: result });
  }),
);

/** POST /api/auth/login -> { token, user } */
authRouter.post(
  '/login',
  validate({ body: loginSchema }),
  asyncHandler(async (_req, res) => {
    const body = validated<LoginBody>(res, 'body');
    const result = await loginUser(body.email, body.password);
    res.json({ data: result });
  }),
);

/** GET /api/auth/me - lets the SPA validate a stored token on boot. */
authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ data: { user: currentUser(req) } });
  }),
);
