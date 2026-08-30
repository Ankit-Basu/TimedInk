import type { NextFunction, Request, Response } from 'express';
import type { ZodType } from 'zod';
import { badRequest } from '../lib/errors.js';

export interface RequestSchemas {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

/**
 * Validate and *replace* the request parts with their parsed output, so
 * handlers receive coerced values (numbers, Dates) rather than raw strings.
 *
 * Express 4 lets us reassign req.query/req.params; Express 5 makes them
 * getters, which is why parsed values are also stashed on `res.locals`.
 */
export function validate(schemas: RequestSchemas) {
  return (req: Request, res: Response, next: NextFunction): void => {
    for (const key of ['body', 'query', 'params'] as const) {
      const schema = schemas[key];
      if (!schema) continue;

      const result = schema.safeParse(req[key]);
      if (!result.success) {
        const details = result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        }));
        next(badRequest(`Invalid request ${key}`, details));
        return;
      }

      res.locals[key] = result.data;
      try {
        Object.defineProperty(req, key, { value: result.data, writable: true, configurable: true });
      } catch {
        // Non-writable in some Express versions; res.locals is the fallback.
      }
    }
    next();
  };
}

/** Typed accessor for a validated part, avoiding `as` at every call site. */
export const validated = <T>(res: Response, key: 'body' | 'query' | 'params'): T =>
  res.locals[key] as T;
