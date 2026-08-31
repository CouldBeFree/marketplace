import {
  Global,
  Module,
  OnModuleDestroy,
  Inject,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { Pool } from 'pg';
import { Env } from '../config/env.schema';

export const PG_POOL = 'PG_POOL';

const logger = new Logger('Database');

export const poolProvider = {
  provide: PG_POOL,
  inject: [ConfigService],
  useFactory: (config: ConfigService<Env, true>): Pool => {
    const url = new URL(config.get('DB_URL', { infer: true }));
    const passwordFile = resolve(config.get('DB_PASSWORD_FILE', { infer: true }));

    const pool = new Pool({
      host: url.hostname,
      port: Number(url.port) || 5432,
      user: decodeURIComponent(url.username),
      database: url.pathname.slice(1),
      password: async () => (await readFile(passwordFile, 'utf8')).trim(),
      max: 10,
    });

    pool.on('error', (err) => {
      logger.warn(`pg pool error (idle client): ${err.message}`);
    });

    return pool;
  },
};

@Global()
@Module({
  providers: [poolProvider],
  exports: [PG_POOL],
})
export class DatabaseModule implements OnModuleDestroy {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
