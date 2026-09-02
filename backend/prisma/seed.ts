/**
 * Seed script — `npm run seed`.
 *
 * Creates one demo user and two mailboxes so a reviewer can log in immediately
 * without going through registration. Idempotent: safe to run repeatedly, it
 * upserts rather than duplicating.
 *
 * Deliberately does NOT import the queue module, so seeding works with Redis
 * down and never opens a connection it then has to clean up.
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const DEMO_EMAIL = process.env.SEED_USER_EMAIL ?? 'demo@timedink.dev';
const DEMO_PASSWORD = process.env.SEED_USER_PASSWORD ?? 'demo1234';
const DEMO_NAME = process.env.SEED_USER_NAME ?? 'Demo Operator';

interface MailboxSeed {
  fromName: string;
  fromEmail: string;
  warmupDay: number;
  dailyLimit: number;
}

/**
 * Two mailboxes so mailbox rotation (bonus C) is observable, on different
 * warmup days so the ramp (bonus B) is visible without waiting.
 */
const MAILBOXES: MailboxSeed[] = [
  { fromName: 'Ava from TimedInk', fromEmail: 'ava@timedink.dev', warmupDay: 3, dailyLimit: 100 },
  { fromName: 'Ben from TimedInk', fromEmail: 'ben@timedink.dev', warmupDay: 1, dailyLimit: 100 },
];

async function main(): Promise<void> {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  const user = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    update: { name: DEMO_NAME, passwordHash },
    create: { email: DEMO_EMAIL, name: DEMO_NAME, passwordHash },
  });

  // There is no unique constraint on (userId, fromEmail) — a user may
  // legitimately hold two identities on one address — so the seed matches by
  // ORDINAL POSITION rather than by address. Matching on fromEmail would make
  // a change to any seeded address create a duplicate mailbox instead of
  // updating the existing one, orphaning whatever history was attached to it.
  const existing = await prisma.mailbox.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });

  for (const [index, mailbox] of MAILBOXES.entries()) {
    const slot = existing[index];
    if (slot) {
      await prisma.mailbox.update({ where: { id: slot.id }, data: mailbox });
    } else {
      await prisma.mailbox.create({ data: { ...mailbox, userId: user.id } });
    }
  }

  const mailboxCount = await prisma.mailbox.count({ where: { userId: user.id } });

  console.log('\nSeed complete.\n');
  console.log('  Log in with:');
  console.log(`    email    ${DEMO_EMAIL}`);
  console.log(`    password ${DEMO_PASSWORD}`);
  console.log(`\n  ${mailboxCount} mailbox(es) ready for user ${user.id}\n`);
}

main()
  .catch((err: unknown) => {
    console.error('Seed failed:', err);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
