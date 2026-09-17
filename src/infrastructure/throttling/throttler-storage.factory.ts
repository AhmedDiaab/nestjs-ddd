import type { ConfigPort } from '@application/ports';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import type { ThrottlerStorage } from '@nestjs/throttler';
import type { RedisOptions } from 'ioredis';

/**
 * `null` keeps @nestjs/throttler's in-memory storage (counters per instance).
 * `redis` shares counters across instances; the service disconnects on shutdown.
 */
export function createThrottlerStorage(
    config: ConfigPort,
    redisOptions: RedisOptions = {},
): ThrottlerStorage | null {
    if (config.get('http.throttleStorage') !== 'redis') return null;

    // presence is guaranteed by the http schema when storage is redis
    const url = config.get('http.throttleRedisUrl') as string;
    return new ThrottlerStorageRedisService(url, redisOptions);
}
