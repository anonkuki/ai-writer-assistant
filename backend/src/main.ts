/**
 * AI+ 文档系统后端入口文件
 * ============================================
 * 本文件是整个后端应用的启动入口
 */

// 引入 NestJS 核心模块，用于创建应用实例
import { NestFactory } from '@nestjs/core';
// 引入验证管道，用于验证请求数据
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
// 引入根模块，定义应用的整体结构
import { AppModule } from './app.module';
// 引入全局过滤器和拦截器
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { TransformInterceptor } from './common/interceptors/success.interceptor';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

/**
 * 启动引导函数
 */
async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  // 获取配置服务
  const configService = app.get(ConfigService);

  // 启用全局验证管道
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // 注册全局异常过滤器
  app.useGlobalFilters(new AllExceptionsFilter());

  // 注册全局响应拦截器
  app.useGlobalInterceptors(
    new LoggingInterceptor(),
    new TransformInterceptor(),
  );

  // 启用 CORS，从环境变量读取
  const corsOrigins = configService.get<string>('CORS_ORIGIN')?.split(',') || ['http://localhost:5173'];
  app.enableCors({
    origin: corsOrigins,
    credentials: true,
  });

  // 从环境变量获取端口
  const port = configService.get<number>('PORT') || 3001;
  await app.listen(port);

  logger.log(`🚀 AI+ Backend running on http://localhost:${port}`);
  logger.log(`📝 Environment: ${configService.get<string>('NODE_ENV') || 'development'}`);
}

// 调用 bootstrap 函数启动应用
bootstrap();
