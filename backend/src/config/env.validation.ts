type RawEnv = Record<string, string | undefined>;

function toInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`环境变量必须为整数，收到: ${value}`);
  }

  return parsed;
}

function toPositiveInt(value: string | undefined, fallback: number, key: string): number {
  const parsed = toInt(value, fallback);
  if (parsed <= 0) {
    throw new Error(`环境变量 ${key} 必须大于 0，当前值: ${parsed}`);
  }
  return parsed;
}

export function validateEnv(env: RawEnv) {
  const nodeEnv = env.NODE_ENV || 'development';
  const allowedEnvs = ['development', 'test', 'production'];

  if (!allowedEnvs.includes(nodeEnv)) {
    throw new Error(`环境变量 NODE_ENV 非法，必须为 ${allowedEnvs.join(' | ')}`);
  }

  const validated = {
    NODE_ENV: nodeEnv,
    PORT: toPositiveInt(env.PORT, 3001, 'PORT'),
    CORS_ORIGIN: env.CORS_ORIGIN || 'http://localhost:5173',
    THROTTLE_TTL: toPositiveInt(env.THROTTLE_TTL, 60000, 'THROTTLE_TTL'),
    THROTTLE_LIMIT: toPositiveInt(env.THROTTLE_LIMIT, 60, 'THROTTLE_LIMIT'),
    AI_THROTTLE_LIMIT: toPositiveInt(env.AI_THROTTLE_LIMIT, 15, 'AI_THROTTLE_LIMIT'),
    SILICONFLOW_API_KEY: env.SILICONFLOW_API_KEY,
    SILICONFLOW_API_URL:
      env.SILICONFLOW_API_URL || 'https://api.siliconflow.cn/v1/chat/completions',
    SILICONFLOW_MODEL: env.SILICONFLOW_MODEL || 'deepseek-ai/DeepSeek-V3.2',
    SILICONFLOW_FAST_MODEL: env.SILICONFLOW_FAST_MODEL || '',
    SILICONFLOW_TIMEOUT_MS: toPositiveInt(
      env.SILICONFLOW_TIMEOUT_MS,
      30000,
      'SILICONFLOW_TIMEOUT_MS',
    ),
    CONTEXT_CACHE_TTL_MS: toInt(env.CONTEXT_CACHE_TTL_MS, 30000),
    JWT_SECRET: env.JWT_SECRET,
    DATABASE_URL: env.DATABASE_URL,
    REDIS_URL: env.REDIS_URL,
  };

  if (!validated.JWT_SECRET) {
    throw new Error('环境变量 JWT_SECRET 未配置，认证模块无法安全运行');
  }

  return validated;
}
