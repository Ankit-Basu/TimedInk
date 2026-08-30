import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { AppError, isAppError, notFound } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { isProduction } from '../config/env.js';

export interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

/** 404 for unmatched routes - handed to the error handler like anything else. */
export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(notFound(`No route for ${req.method} ${req.path}`));
}

/** Map a Prisma error to something a client can act on. */
function fromPrisma(err: Prisma.PrismaClientKnownRequestError): AppError {
  switch (err.code) {
    case 'P2002':
      return new AppError(409, 'CONFLICT', 'A record with those unique values already exists');
    case 'P2025':
      return new AppError(404, 'NOT_FOUND', 'Record not found');
    case 'P2003':
      return new AppError(400, 'BAD_REQUEST', 'Referenced record does not exist');
    default:
      return new AppError(500, 'DATABASE_ERROR', 'Database error');
  }
}

/**
 * Single exit point for every error in the app.
 *
 * Known AppErrors are reported verbatim. Anything else is a bug: it is logged
 * with its stack and reported as an opaque 500, because internal messages leak
 * schema and file-system details.
 */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  // Delegate to Express if the response is already streaming.
  if (res.headersSent) {
    next(err);
    return;
  }

  let appError: AppError;
  if (isAppError(err)) {
    appError = err;
  } else if (err instanceof Prisma.PrismaClientKnownRequestError) {
    appError = fromPrisma(err);
  } else {
    appError = new AppError(500, 'INTERNAL_ERROR', 'Something went wrong');
  }

  const logPayload = {
    err,
    method: req.method,
    path: req.path,
    statusCode: appError.statusCode,
    code: appError.code,
  };
  if (appError.statusCode >= 500) logger.error(logPayload, 'request failed');
  else logger.warn(logPayload, 'request rejected');

  const body: ErrorBody = {
    error: {
      code: appError.code,
      message: appError.message,
      ...(appError.details === undefined ? {} : { details: appError.details }),
    },
  };

  // Stacks are useful locally and dangerous in production.
  if (!isProduction && appError.statusCode >= 500 && err instanceof Error) {
    body.error.details = { stack: err.stack };
  }

  res.status(appError.statusCode).json(body);
}

/** Wrap an async handler so rejections reach the error handler. */
export const asyncHandler =
  <T>(fn: (req: Request, res: Response, next: NextFunction) => Promise<T>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    void fn(req, res, next).catch(next);
  };
