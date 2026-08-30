import { Router } from 'express';
import { authRouter } from './auth.js';
import { emailsRouter } from './emails.js';
import { mailboxesRouter } from './mailboxes.js';
import { trackRouter } from './track.js';

export const apiRouter = Router();

apiRouter.use('/auth', authRouter);
apiRouter.use('/emails', emailsRouter);
apiRouter.use('/mailboxes', mailboxesRouter);
// Unauthenticated on purpose - hit by recipients' mail clients.
apiRouter.use('/track', trackRouter);
