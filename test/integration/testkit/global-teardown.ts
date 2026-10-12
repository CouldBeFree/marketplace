import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';

// Зупиняє контейнер, піднятий у global-setup (ділимо стан через globalThis —
// обидва хуки крутяться в одному процесі jest).
module.exports = async (): Promise<void> => {
  const c = (globalThis as unknown as { __PG_CONTAINER__?: StartedPostgreSqlContainer })
    .__PG_CONTAINER__;
  if (c) {
    await c.stop();
  }
};
