import pino, { type LoggerOptions } from 'pino';
import { env, isProduction, isTest } from '../config/env.js';

const pretty = env.LOG_PRETTY ?? !isProduction;

const options: LoggerOptions = {
  level: isTest ? 'silent' : env.LOG_LEVEL,
  base: undefined, // drop pid/hostname — noise in a single-machine demo
  redact: {
    // Never let a credential or token reach the log stream.
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'password',
      '*.password',
      'passwordHash',
      '*.passwordHash',
      'smtp.pass',
      '*.pass',
    ],
    censor: '[redacted]',
  },
  ...(pretty
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss.l',
            ignore: 'pid,hostname',
            messageFormat: '{msg}',
          },
        },
      }
    : {}),
};

export const logger = pino(options);

/** Child logger tagged with a subsystem name, e.g. `worker`, `reconcile`. */
export const childLogger = (name: string) => logger.child({ scope: name });
