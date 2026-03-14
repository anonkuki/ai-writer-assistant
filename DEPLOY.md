# AI+ 作家助手 - 部署指南

本项目是一个前后端分离的 AI 写作助手应用，包含：
- **前端**: Vue 3 + Vite + TailwindCSS
- **后端**: NestJS + Prisma + Socket.io
- **数据库**: 开发环境默认使用 SQLite（零配置），生产部署推荐 PostgreSQL
- **缓存**: Redis (可选)

---

## 快速部署 (免费层)

### 1. 数据库 - Neon (免费 PostgreSQL)

> **注意**：本地开发默认使用 SQLite（见 `prisma/schema.prisma`），无需额外数据库服务。
> 线上部署时需要将 schema 中 `provider` 改为 `"postgresql"` 并配置连接串。

1. 访问 https://neon.tech 注册账号
2. 创建新项目，选择免费套餐
3. 获取连接字符串，格式如下：
   ```
   postgresql://username:password@ep-xxx.us-east-1.aws.neon.tech/aiplus?sslmode=require
   ```

### 2. Redis - Upstash (免费)

1. 访问 https://upstash.com 注册账号
2. 创建 Redis 数据库，获取连接 URL：
   ```
   redis://default:password@xxx.upstash.io
   ```

> 当前仓库内置的 Docker 方案默认已经包含本地 Redis 容器；只有云部署时才需要额外接入 Upstash。

### 3. 后端部署 - Railway

1. 访问 https://railway.app 注册账号 (用 GitHub 登录)
2. 点击 "New Project" → "Deploy from GitHub repo"
3. 选择 `ai-writer-assistant` 仓库
4. 在 Variables 标签页添加环境变量：

```
NODE_ENV=production
PORT=3001
DATABASE_URL=postgresql://... (Neon 的连接字符串)
REDIS_URL=redis://... (Upstash 的连接字符串)
CORS_ORIGIN=https://你的vercel域名.vercel.app
JWT_SECRET=生成一个随机字符串
SILICONFLOW_API_KEY=你的API密钥 (可选)
```

5. 部署完成后， Railway 会提供后端 URL，例如：`https://ai-plus-backend-production-xxx.up.railway.app`

### 4. 前端部署 - Vercel

1. 访问 https://vercel.com 注册账号 (用 GitHub 登录)
2. 点击 "Add New..." → "Project"
3. 选择 `ai-writer-assistant` 仓库
4. 配置：
   - Framework Preset: `Vue.js`
   - Build Command: `npm run build` 或留空
   - Output Directory: `dist`

5. 在 Environment Variables 添加：

```
VITE_API_URL=https://你的railway后端URL
```

6. 点击 Deploy

### 5. 验证部署

部署完成后：
- 前端: `https://你的项目名.vercel.app`
- 后端 API: `https://你的railway域名/api/...`

---

## 本地运行

### Docker 本地运行

项目仓库已内置完整 Docker 方案，可直接在根目录运行。

1. 复制环境变量模板

```bash
cp .env.docker.example .env
```

2. 至少填写以下变量：

```env
JWT_SECRET=replace-with-a-strong-secret
SILICONFLOW_API_KEY=your-api-key
```

3. 启动容器

```bash
docker compose up -d --build
```

Windows PowerShell 也可直接运行：

```powershell
./scripts/docker-up.ps1 -Build
```

停止容器：

```powershell
./scripts/docker-down.ps1
```

启动后：

- 前端：http://localhost
- 后端：http://localhost:3001
- 反代 API：http://localhost/api

说明：

- Docker 方案默认使用 SQLite 持久化卷，不依赖外部数据库
- Redis 已在 compose 中内置
- 当前 Prisma schema 仍以 SQLite 为默认 provider，因此 Docker 本地部署优先走 SQLite

### 本地开发运行

#### 前端

```bash
cd frontend
npm install
npm run dev
# 访问 http://localhost:5173
```

#### 后端

```bash
cd backend
npm install
# 复制 .env.example 为 .env，配置数据库等
npm run prisma:generate
npm run prisma:migrate
npm run start:dev
# API 运行在 http://localhost:3001
```

---

## 所需服务账号

| 服务 | 免费额度 | 注册地址 |
|------|---------|---------|
| Neon (PostgreSQL) | 512MB | https://neon.tech |
| Upstash (Redis) | 10K 命令/天 | https://upstash.com |
| Railway | $5/月 | https://railway.app |
| Vercel | 免费 | https://vercel.com |
| SiliconFlow (可选) | 免费 API | https://siliconflow.cn |

---

## 面试展示建议

1. **演示前**：确保所有服务都已部署完成并正常运行
2. **展示重点**：
   - 登录注册功能
   - AI 写作助手交互
   - 角色管理、场景管理等业务功能
   - 实时协作 (Socket.io)
3. **备用方案**：如果服务不稳定，可以准备本地运行的录屏作为备份
