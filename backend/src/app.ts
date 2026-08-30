import type { IncomingMessage, ServerResponse } from 'node:http';
import express, { type Express } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { corsOrigins, env, isTest } from './config/env.js';
import { logger } from './lib/logger.js';
import { apiRouter } from './routes/index.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { emailQueue } from './queue/emailQueue.js';

/**
 * Build the Express app.
 *
 * Factored out of server.ts so integration tests can mount it with supertest
 * without opening a port or running boot reconciliation.
 */
export function createApp(): Express {
  const app = express();

  // Behind a proxy in any real deployment; needed for correct req.ip.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    cors({
      origin: corsOrigins.length === 1 && corsOrigins[0] === '*' ? true : corsOrigins,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  if (!isTest) {
    app.use(
      pinoHttp({
        logger,
        // The tracking pixel and the dashboard poll are both high-frequency and
        // uninteresting; drop them to debug so the demo log stays readable.
        autoLogging: {
          ignore: (req: IncomingMessage) =>
            req.url?.startsWith('/api/track/') === true || req.url?.startsWith('/health') === true,
        },
        customLogLevel: (_req: IncomingMessage, res: ServerResponse, err?: Error) => {
          if (err || res.statusCode >= 500) return 'error';
          if (res.statusCode >= 400) return 'warn';
          return 'info';
        },
      }),
    );
  }

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
  });

  // Bull Board: a read-only-ish window onto delayed/active/failed jobs. Local
  // debugging aid only - it is unauthenticated, so it must not be exposed in
  // production (see ASSUMPTIONS.md).
  if (env.BULL_BOARD_ENABLED) {
    const serverAdapter = new ExpressAdapter();
    serverAdapter.setBasePath('/admin/queues');
    createBullBoard({
      queues: [new BullMQAdapter(emailQueue)],
      serverAdapter,
    });
    app.use('/admin/queues', serverAdapter.getRouter());
  }

  app.use('/api', apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
