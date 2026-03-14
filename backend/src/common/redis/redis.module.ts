import { Module, Global, Logger } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RedisCacheService } from './redis-cache.service';

function parseRedisUrl(redisUrl: string) {
  const parsed = new URL(redisUrl);
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 6379,
    password: parsed.password || undefined,
  };
}

@Global()
@Module({
  imports: [
    CacheModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService): any => {
        const cacheTtl = configService.get<number>('CACHE_TTL', 300) * 1000;
        const redisUrl = configService.get<string>('REDIS_URL');
        const redisHost = configService.get<string>('REDIS_HOST');

        if (redisUrl) {
          const parsed = parseRedisUrl(redisUrl);
          return {
            store: 'redis' as const,
            host: parsed.host,
            port: parsed.port,
            password: parsed.password,
            ttl: cacheTtl,
          };
        }

        // 若未配置 REDIS_URL / REDIS_HOST，使用内存缓存
        if (!redisHost) {
          new Logger('RedisModule').warn(
            'REDIS_URL / REDIS_HOST not configured, falling back to in-memory cache',
          );
          return {
            ttl: cacheTtl,
          };
        }

        return {
          store: 'redis' as const,
          host: redisHost,
          port: configService.get<number>('REDIS_PORT') || 6379,
          password: configService.get<string>('REDIS_PASSWORD') || undefined,
          ttl: cacheTtl,
        };
      },
    }),
  ],
  providers: [RedisCacheService],
  exports: [RedisCacheService, CacheModule],
})
export class RedisModule {}
