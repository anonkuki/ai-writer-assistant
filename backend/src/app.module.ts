/**
 * AI+ 文档系统根模块
 * ============================================
 * 本文件是 NestJS 应用的根模块（Root Module），相当于公司的组织架构图
 *
 * 核心功能：
 * 1. 整合所有功能模块 - 类似于将各个部门整合成一个公司
 * 2. 定义服务提供者 - 声明哪些服务可以被其他模块使用
 * 3. 配置全局设置 - 应用级别的配置
 *
 * 什么是模块（Module）？
 * 在 NestJS 中，模块是用来组织代码的一种方式，类似于文件夹
 * 每个模块包含：控制器（负责处理请求）、服务（负责处理业务逻辑）、其他依赖
 *
 * 包含的子模块：
 * - DocumentModule: 文档管理模块，处理文档的 CRUD 操作
 * - AiModule: AI 智能模块，处理 AI 对话和建议功能
 *
 * 服务提供者：
 * - DocumentGateway: 实时通信网关，处理 WebSocket 连接实现多人协作
 */

// 引入 NestJS 的装饰器，用于定义模块
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
// 引入文档模块，处理文档相关的业务逻辑
import { DocumentModule } from './document/document.module';
// 引入 AI 模块，处理 AI 相关的业务逻辑
import { AiModule } from './ai/ai.module';
// 引入认证模块，处理 JWT 鉴权
import { AuthModule } from './auth/auth.module';
// 引入用户模块，处理用户注册登录
import { UsersModule } from './users/users.module';
// 引入 Redis 模块，处理缓存
import { RedisModule } from './common/redis/redis.module';
// 引入文档网关，处理实时通信（多人协作）
import { DocumentGateway } from './gateway/document.gateway';

/**
 * @Module 装饰器
 * 告诉 NestJS 这是一个模块类
 * 装饰器是 TypeScript/JavaScript 的一种特殊语法，用于给类添加元数据
 */
@Module({
  // imports: 声明当前模块依赖的其他模块
  // 就像在公司架构中，一个部门可能需要依赖其他部门的服务
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    RedisModule,
    DocumentModule,
    AiModule,
    AuthModule,
    UsersModule,
  ],

  // providers: 声明当前模块提供的服务（可以被注入到其他类中）
  // DocumentGateway 是 WebSocket 网关，用于处理实时通信
  providers: [DocumentGateway],
})
// 导出根模块类，供 main.ts 使用
export class AppModule {}
