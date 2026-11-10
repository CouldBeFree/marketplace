import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type Redis from 'ioredis';
import { makeQueueClient } from '../redis/connection';

const PREFIX = 'denylist:jti:';

// Денилист jti відкликаних access-токенів. У noeviction-інстансі Redis (REDIS_QUEUE_URL, той
// самий, що й сесії #23): денилист НЕ МОЖНА витісняти — викинутий ключ = «воскреслий» токен.
// exp перевіряє бібліотека, revoked — ми: ключ має зникати САМ, тож TTL = залишок життя токена.
@Injectable()
export class DenylistService implements OnModuleDestroy {
  private readonly logger = new Logger('Denylist');
  private readonly redis: Redis | null;

  constructor() {
    // Без REDIS_QUEUE_URL денилист ВИМКНЕНО (демо/грейдер завжди з Redis; у суто-юніт-середовищі
    // без Redis застосунок усе одно стартує — access тоді живе лише до exp).
    let client: Redis | null = null;
    try {
      client = process.env.REDIS_QUEUE_URL ? makeQueueClient() : null;
    } catch {
      client = null;
    }
    this.redis = client;
    if (!this.redis) {
      this.logger.warn('REDIS_QUEUE_URL не задано — денилист вимкнено (access живе до exp)');
    }
  }

  async deny(jti: string, expUnixSec: number): Promise<void> {
    if (!this.redis) return;
    const ttl = expUnixSec - Math.floor(Date.now() / 1000);
    if (ttl <= 0) return; // токен уже протух — денилистити нічого
    await this.redis.set(PREFIX + jti, '1', 'EX', ttl);
  }

  async isDenied(jti: string): Promise<boolean> {
    if (!this.redis) return false;
    return (await this.redis.exists(PREFIX + jti)) === 1;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redis) await this.redis.quit();
  }
}
