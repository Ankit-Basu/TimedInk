import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    /**
     * The whole suite is hermetic: no MySQL, no Redis, no SMTP. Everything at
     * the edges is faked, so `npm test` works on a clean checkout and in CI.
     *
     * env.ts validates configuration at import time, so these have to exist
     * before any module under test is loaded.
     */
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'mysql://test:test@localhost:3306/outbox_pilot_test',
      REDIS_URL: 'redis://localhost:6379',
      JWT_SECRET: 'test-secret-that-is-long-enough-32',
      // Bull Board would try to introspect a mocked queue object.
      BULL_BOARD_ENABLED: 'false',
      LOG_LEVEL: 'error',
      LOG_PRETTY: 'false',
      STALE_CATCHUP_THRESHOLD_MINUTES: '1440',
      RATE_LIMIT_MAX: '10',
      RATE_LIMIT_DURATION_MS: '10000',
      WORKER_CONCURRENCY: '5',
    },
    restoreMocks: true,
    clearMocks: true,
  },
});
