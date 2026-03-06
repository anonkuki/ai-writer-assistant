<div align="center">

# AI+ 智能写作平台

**面向长篇小说 / 网文创作的全栈 AI 辅助写作系统**

<p>
  <img src="https://img.shields.io/badge/Frontend-Vue%203.5-42b883" alt="Vue" />
  <img src="https://img.shields.io/badge/Backend-NestJS%2010-e0234e" alt="NestJS" />
  <img src="https://img.shields.io/badge/Database-Prisma%20%2B%20SQLite-2D3748" alt="Prisma" />
  <img src="https://img.shields.io/badge/Realtime-Socket.io-010101" alt="Socket.io" />
  <img src="https://img.shields.io/badge/AI-DeepSeek%20V3.2-FF6C37" alt="AI" />
  <img src="https://img.shields.io/badge/Desktop-Electron%2028-47848F" alt="Electron" />
  <img src="https://img.shields.io/badge/License-MIT-blue" alt="License" />
</p>

<p>
  <img src="picture/主页.png" alt="AI+ 主页" width="80%" />
</p>

> 提供书籍-卷-章结构化管理、实时协作编辑、三层 AI 写作代理（战略-战术-执行）、角色关系网络、Copilot 风格行内润色与一致性检查。通过 **SiliconFlow** 平台调用 **DeepSeek-V3.2** 大语言模型，支持 Web 部署与 Electron 桌面应用打包，可完全私有化部署到本地。

</div>

---

## 目录

- [产品截图展示](#产品截图展示)
- [项目定位](#项目定位)
- [核心功能](#核心功能)
- [技术栈](#技术栈)
- [系统架构](#系统架构)
- [AI 模型与 API 调用详解](#ai-模型与-api-调用详解)
- [数据模型](#数据模型)
- [本地部署指南](#本地部署指南)
- [环境变量配置](#环境变量配置)
- [常用命令](#常用命令)
- [API 与模块说明](#api-与模块说明)
- [生产部署方案](#生产部署方案)
- [Electron 桌面应用](#electron-桌面应用)
- [工程化与安全](#工程化与安全)
- [项目结构](#项目结构)
- [更新日志 (2026-03-06)](#更新日志-2026-03-06)
- [常见问题](#常见问题)

---

## 产品截图展示

### 登录页

用户注册与登录界面，采用 JWT 无状态令牌鉴权，支持安全的用户隔离。

<p align="center">
  <img src="picture/登录页.png" alt="登录页" width="80%" />
</p>

### 主页仪表板

书籍管理主页，展示用户全部创作项目，支持新建书籍、卷、章节的全链路管理。

<p align="center">
  <img src="picture/主页.png" alt="主页仪表板" width="80%" />
</p>

### 写作编辑页

基于 TipTap (ProseMirror) 的富文本编辑器，支持 Slash Command 菜单、Markdown 快捷键、实时协作与自动保存。

<p align="center">
  <img src="picture/写作页.png" alt="写作编辑页" width="80%" />
</p>

### AI 助手面板

右侧滑出式 AI 助手面板，支持基于文档上下文的智能问答、续写、改写和摘要生成，所有 AI 响应均通过 SSE 流式传输实时展示。

<p align="center">
  <img src="picture/ai助手.png" alt="AI 助手面板" width="80%" />
</p>

### Copilot 行内润色 (Diff 对比)

选中文本后触发 AI 行内润色，系统返回红绿 Diff 对比建议，用户可逐条接受或拒绝，体验类似 GitHub Copilot。

<p align="center">
  <img src="picture/润色diff.png" alt="润色 Diff 对比" width="80%" />
</p>

### 实际使用场景 — AI 大纲辅助创作

以下展示完整的 AI 辅助大纲规划流程：

**第一步：向 AI 提出大纲规划问题**

<p align="center">
  <img src="picture/实际使用场景_大纲提问.png" alt="大纲提问" width="80%" />
</p>

**第二步：AI 深度思考分析**

<p align="center">
  <img src="picture/实际使用场景_大纲思考.png" alt="大纲思考" width="80%" />
</p>

**第三步：AI 处理上下文与结构化信息**

<p align="center">
  <img src="picture/实际使用场景_大纲处理.png" alt="大纲处理" width="80%" />
</p>

**第四步：获得结构化大纲结果**

<p align="center">
  <img src="picture/实际使用场景_大纲结果.png" alt="大纲结果" width="80%" />
</p>

---

## 项目定位

AI+ 面向 **可持续长篇写作生产** 而非一次性对话：

- 以 **Book → Volume → Chapter → Document** 层级组织创作资产
- 通过 **三层 AI 代理架构**（L3 大纲层 → L2 角色层 → L1 执行层）系统化辅助创作
- 用 **Socket.io 协作网关** 支持多人实时编辑
- 用 **一致性检查 + RAG 检索增强** 保障内容逻辑与质量

适合个人创作者、小型内容团队的私有化部署。

---

## 核心功能

### 结构化写作管理
- 书籍 / 卷 / 章节 全链路 CRUD
- 章节版本快照与回滚
- 字数统计与写作日历

### AI 辅助创作

<p align="center">
  <img src="picture/ai助手.png" alt="AI 辅助创作" width="60%" />
</p>

- **续写 / 改写 / 摘要**：基于上下文的 SSE 流式生成
- **Copilot 行内润色**：选中文本后获取红绿 Diff 对比建议，逐条接受/拒绝
- **角色/大纲/世界观 AI 补全**：字段级智能建议，一键采纳
- **关系网络 AI 建议**：自动分析角色并推荐缺失关系

### 全屏编辑器

<p align="center">
  <img src="picture/写作页.png" alt="全屏编辑器" width="60%" />
</p>

- **角色编辑器**：基本信息 / 性格心理 / 能力成长 / 背景故事 四维管理
- **世界观编辑器**：流派 / 基调 / 力量体系 / 地理 / 社会 / 历史 / 规则
- **剧情线编辑器**：主线 / 副线 / 角色线，含冲突-高潮-结局结构
- **伏笔编辑器**：创建 / 回收 / 废弃状态管理

### 角色关系网络
- SVG 力导向图（零依赖）
- 节点按角色着色（主角/配角/反派）
- 边按关系状态着色（正面/负面/复杂）
- 双向贝塞尔曲线、拖拽交互、双击打开角色编辑

### 实时协作
- WebSocket 房间机制 + 内容增量同步
- 在线协作者感知

### 安全与运维
- JWT 鉴权 + 用户维度资源隔离
- 全局限流 + AI 专用限流
- Helmet 安全头 + 压缩中间件
- 统一环境变量启动校验

---

## 技术栈

### 前端

| 类别 | 技术 | 版本 | 说明 |
|------|------|------|------|
| 框架 | Vue 3 | 3.5+ | Composition API + `<script setup>` |
| 状态管理 | Pinia | 2.1 | 响应式 Store |
| 编辑器 | TipTap | 2.2 | 基于 ProseMirror 的富文本编辑器 |
| 样式 | Tailwind CSS | 3.4 | 自定义设计令牌 |
| 构建工具 | Vite | 5.0 | HMR + 开发代理 |
| 类型检查 | TypeScript | 5.3 | Strict 模式 |
| HTTP | Axios | 1.6 | API 请求 |
| 实时通信 | Socket.io-client | 4.7 | WebSocket 协作 |
| 桌面 | Electron | 28 | 可选桌面应用打包 |
| 路由 | Vue Router | 4.2 | SPA 路由 |

### 后端

| 类别 | 技术 | 版本 | 说明 |
|------|------|------|------|
| 框架 | NestJS | 10.3 | 模块化企业级框架 |
| ORM | Prisma | 5.9 | 类型安全数据库访问 |
| 数据库 | SQLite | — | 默认轻量数据库（可迁移 PostgreSQL） |
| 实时通信 | Socket.io | 4.7 | WebSocket 网关 |
| 认证 | Passport + JWT | — | 无状态令牌鉴权 |
| 校验 | class-validator | 0.14 | DTO 输入校验 |
| AI 调用 | Axios | 1.6 | SiliconFlow API 请求 |
| 安全 | Helmet | 8.1 | HTTP 安全头 |
| 压缩 | compression | 1.8 | Gzip 响应压缩 |
| 限流 | @nestjs/throttler | 6.5 | 全局 + AI 专用限流 |
| 缓存 | cache-manager + Redis | — | 可选 Redis 缓存层 |
| 文档 | @nestjs/swagger | 11.2 | 自动生成 API 文档 |
| 测试 | Jest | 29.7 | 单元测试 |

### AI 模型

| 提供商 | 模型 | 用途 | API 端点 |
|--------|------|------|----------|
| SiliconFlow | DeepSeek-V3.2 | 对话/续写/润色/补全（默认） | `https://api.siliconflow.cn/v1/chat/completions` |
| SiliconFlow | GLM-5 | 用户可选切换的高质量模型 | `https://api.siliconflow.cn/v1/chat/completions` |
| SiliconFlow | MiniMax-M2.5 | 用户可选切换的快速模型 | `https://api.siliconflow.cn/v1/chat/completions` |
| SiliconFlow | BAAI/bge-large-zh-v1.5 | RAG 向量嵌入检索 | `https://api.siliconflow.cn/v1/embeddings` |

支持 **SSE 流式输出**（续写/润色/对话）与 **常规 JSON 响应**（角色/大纲/关系建议）。

---

## 系统架构

```
┌─────────────┐     HTTP/WS      ┌──────────────┐     Prisma     ┌──────────┐
│  Vue 3 SPA  │ ◄──────────────► │  NestJS API  │ ◄────────────► │  SQLite  │
│  (or Electron)                 │              │                │(可替换PG)│
└─────────────┘                  │  ┌─────────┐ │                └──────────┘
       │                         │  │ Socket  │ │
       │    /socket.io           │  │ Gateway │ │     REST       ┌──────────┐
       └─────────────────────────┤  └─────────┘ │ ◄────────────► │SiliconFlow│
                                 │              │                │ DeepSeek │
                                 │  ┌─────────┐ │                └──────────┘
                                 │  │  Agent  │ │
                                 │  │Orchestr.│ │     Optional   ┌──────────┐
                                 │  └─────────┘ │ ◄────────────► │  Redis   │
                                 └──────────────┘                └──────────┘
```

### 三层 AI 代理架构

| 层级 | 名称 | 职责 | 数据模型 |
|------|------|------|----------|
| L3 | 战略层 | 世界观、剧情线、时间线、伏笔 | WorldSetting, PlotLine, TimelineEvent, Foreshadowing |
| L2 | 战术层 | 角色档案、关系网络、情绪轨迹、成长记录 | CharacterProfile, CharacterRelationship, EmotionLog, GrowthRecord |
| L1 | 执行层 | 场景、事件日志、章节摘要、AI 会话 | Scene, EventLog, ChapterSummary, AgentSession |

### 关键流程

1. 用户登录获取 JWT
2. 前端调用 REST API 管理书籍与章节
3. 进入编辑器后连接 Socket 命名空间并加入文档房间
4. 用户触发 AI 操作，后端拼接上下文并调用 SiliconFlow 模型
5. 结果回写文档，并向协作者广播更新

---

## AI 模型与 API 调用详解

本项目通过 **SiliconFlow** 云平台统一调用 AI 大语言模型，所有 AI 请求均在后端发起，前端不直接接触 API 密钥，确保安全性。

### API 提供商与模型

| 提供商 | 平台地址 | 模型标识 | 用途 |
|--------|----------|----------|------|
| [SiliconFlow](https://siliconflow.cn) | `https://api.siliconflow.cn` | `deepseek-ai/DeepSeek-V3.2` | 对话、续写、润色、角色补全、大纲规划 |
| [SiliconFlow](https://siliconflow.cn) | `https://api.siliconflow.cn` | `BAAI/bge-large-zh-v1.5` | RAG 向量嵌入与语义检索 |

> **如何获取 API Key**：访问 [SiliconFlow 控制台](https://cloud.siliconflow.cn) 注册账号 → 创建 API Key → 填入后端环境变量 `SILICONFLOW_API_KEY`。

### 后端 AI 调用架构

项目中有 **4 个核心服务** 直接调用 SiliconFlow API：

#### 1. `backend/src/ai/ai.service.ts` — AI 通用服务

负责文档问答、写作辅助等 **非流式** 请求：

```typescript
// 调用方式：标准 HTTP POST 请求
const response = await axios.post(
  'https://api.siliconflow.cn/v1/chat/completions',
  {
    model: 'deepseek-ai/DeepSeek-V3.2',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    temperature: 0.7,
    max_tokens: 2000
  },
  {
    timeout: 30000,  // 可通过 SILICONFLOW_TIMEOUT_MS 配置
    headers: {
      Authorization: `Bearer ${SILICONFLOW_API_KEY}`,
      'Content-Type': 'application/json'
    }
  }
);
return response.data.choices[0].message.content;
```

#### 2. `backend/src/agent/orchestrator.service.ts` — 核心编排器

三层 AI 代理的核心，负责 **续写、多候选生成、行内润色** 等 **流式 (SSE)** 请求：

```typescript
// 流式调用：通过 stream: true 开启 SSE
const response = await axios.post(url, {
  model: 'deepseek-ai/DeepSeek-V3.2',
  messages: [...],
  stream: true       // 关键：启用流式传输
}, {
  responseType: 'stream'  // Axios 以流方式接收
});

// 解析 SSE 数据
response.data.on('data', (buf: Buffer) => {
  const lines = buf.toString().split('\n')
    .filter(l => l.trim().startsWith('data:'));
  for (const line of lines) {
    const json = line.replace(/^data:\s*/, '').trim();
    if (json === '[DONE]') break;
    const parsed = JSON.parse(json);
    const token = parsed.choices[0].delta.content;
    onChunk(token);  // 实时将 token 推送给前端
  }
});
```

#### 3. `backend/src/rag/rag.service.ts` — RAG 检索增强

调用 **Embedding API** 将文本向量化，支持语义检索：

```typescript
// 向量嵌入调用
const response = await axios.post(
  'https://api.siliconflow.cn/v1/embeddings',
  {
    model: 'BAAI/bge-large-zh-v1.5',
    input: text
  },
  { headers: { Authorization: `Bearer ${API_KEY}` } }
);
return response.data.data[0].embedding;  // 返回向量数组
```

#### 4. `backend/src/consistency/consistency.service.ts` — 一致性检查

利用 AI 分析文本中的逻辑矛盾、角色行为偏差等问题，返回结构化检查报告。

### 前端 AI 交互流程

```
用户操作 (选中文本/点击按钮)
    │
    ▼
前端 Store (agent.ts / ai.ts)
    │  发起 HTTP 请求到后端 /ai/* 端点
    ▼
Axios 封装层 (lib/api.ts)
    │  自动附加 JWT Bearer Token
    ▼
后端 NestJS Controller (agent.controller.ts / ai.controller.ts)
    │
    ▼
Service 层拼接 Prompt + 上下文
    │
    ▼
调用 SiliconFlow API (DeepSeek-V3.2)
    │
    ▼  流式: SSE → EventSource 实时推送
    ▼  非流式: JSON → 标准 HTTP 响应
前端展示结果 (AI 面板 / Diff 对比 / 编辑器内嵌)
```

### 流式端点一览

| 端点 | 方法 | 说明 | 流式 |
|------|------|------|------|
| `/ai/chat` | POST | AI 对话 (基于文档上下文) | ✅ SSE |
| `/ai/deep-think-chat` | POST | 深度思考对话 (含推理过程) | ✅ SSE |
| `/ai/inline-polish` | POST | Copilot 行内润色建议 | ✅ SSE |
| `/ai/generate/continue` | POST | 多候选续写生成 | ✅ SSE |
| `/ai/ask` | POST | 文档问答 | ❌ JSON |
| `/ai/suggest` | POST | 写作建议 | ❌ JSON |
| `/ai/assist-content` | POST | 字段级 AI 补全 | ❌ JSON |
| `/ai/suggest-relationships` | POST | 角色关系 AI 建议 | ❌ JSON |

---

## 数据模型

项目使用 Prisma + SQLite，共 **31 个数据模型**：

```
用户与团队       文档协作             书籍结构              AI 三层架构
─────────      ─────────            ─────────            ──────────
User           Document             Book                 L3: WorldSetting
Team           DocumentVersion      Volume                   PlotLine
TeamMember     Folder               Chapter                  TimelineEvent
TeamInvite     Tag / DocumentTag    ChapterVersion           Foreshadowing
               Share                Outline              L2: CharacterProfile
               Favorite             Character                CharacterRelationship
               Comment              Inspiration              EmotionLog
               Notification         WritingStat              GrowthRecord
               AuditLog                                  L1: Scene
                                                             EventLog
                                                             ChapterSummary
                                                             AgentSession

辅助: Embedding (向量存储), ConsistencyRule, ConsistencyReport
```

完整 Schema 见 `backend/prisma/schema.prisma`。

---

## 本地部署指南

本节详细说明如何将 AI+ 完整部署到本地开发机/服务器上运行。

### 环境要求

| 依赖 | 版本要求 | 说明 |
|------|----------|------|
| **Node.js** | >= 18 | 推荐使用 LTS 版本 |
| **npm** | >= 9 | 随 Node.js 安装 |
| **Git** | 最新版 | 代码版本管理 |
| **Redis** | (可选) | 用于缓存增强，非必须 |

> **Windows 用户**：推荐使用 PowerShell 7+ 或 Git Bash 执行以下命令。

### 第一步：克隆项目

```bash
git clone <your-repo-url> ai-plus
cd ai-plus
```

### 第二步：安装依赖

```bash
# 后端依赖
cd backend
npm install

# 前端依赖
cd ../frontend
npm install
```

### 第三步：获取 SiliconFlow API Key

1. 访问 [SiliconFlow 云平台](https://cloud.siliconflow.cn) 注册账号
2. 进入控制台 → API Keys → 创建新密钥
3. 复制生成的 API Key（格式：`sk-xxxxxxxxxxxx`）

> **免费额度**：SiliconFlow 提供新用户免费额度，可直接用于开发测试。

### 第四步：配置环境变量

```bash
# 后端环境变量
cd backend
# Windows PowerShell:
Copy-Item .env.example .env
# Linux/macOS:
# cp .env.example .env
```

编辑 `backend/.env`，**至少配置以下两项**：

```env
# ========== 必填 ==========
JWT_SECRET=your-strong-random-secret-key-at-least-32-chars
SILICONFLOW_API_KEY=sk-your-api-key-from-siliconflow

# ========== 可选（有默认值）==========
NODE_ENV=development
PORT=3001
CORS_ORIGIN=http://localhost:5173
DATABASE_URL=file:./dev.db
SILICONFLOW_API_URL=https://api.siliconflow.cn/v1/chat/completions
SILICONFLOW_MODEL=deepseek-ai/DeepSeek-V3.2
SILICONFLOW_TIMEOUT_MS=30000
```

前端通常无需修改环境变量，本地开发会自动通过 Vite 代理转发到后端：

```bash
cd ../frontend
# Windows PowerShell:
Copy-Item .env.example .env
# 本地开发保持 VITE_API_URL 为空即可
```

### 第五步：初始化数据库

```bash
cd backend

# 生成 Prisma Client（类型安全的数据库访问层）
npm run prisma:generate

# 执行数据库迁移（自动创建 SQLite 数据库文件和全部 31 张表）
npm run prisma:migrate
```

> 默认使用 **SQLite**（零配置），数据文件存储在 `backend/dev.db`。如需 PostgreSQL，参见 [数据库迁移](#数据库迁移到-postgresql) 章节。

### 第六步：启动开发服务器

需要同时启动前端和后端两个服务：

```bash
# 终端 1：启动后端（端口 3001）
cd backend
npm run start:dev

# 终端 2：启动前端（端口 5173）
cd frontend
npm run dev
```

### 第七步：访问应用

| 服务 | 地址 | 说明 |
|------|------|------|
| **前端应用** | http://localhost:5173 | 主应用入口 |
| **后端 API** | http://localhost:3001 | REST API 服务 |
| **Swagger 文档** | http://localhost:3001/api/docs | API 交互式文档（仅开发环境） |
| **Prisma Studio** | 运行 `npm run prisma:studio` | 数据库可视化管理 |

<p align="center">
  <img src="picture/登录页.png" alt="登录页" width="60%" />
</p>

打开浏览器访问 http://localhost:5173，注册账号即可开始使用。

### 本地部署验证清单

- [ ] 后端启动无报错（特别检查 `JWT_SECRET` 和 `SILICONFLOW_API_KEY`）
- [ ] 前端 Vite 开发服务器正常运行
- [ ] 能正常注册/登录用户
- [ ] 能创建书籍和章节
- [ ] AI 助手能正常对话（验证 API Key 有效）
- [ ] 编辑器实时保存正常工作

---

## 环境变量配置

### 后端 `backend/.env`

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `JWT_SECRET` | **是** | — | JWT 签名密钥，生产请使用强随机值 |
| `SILICONFLOW_API_KEY` | **是**（AI功能） | — | SiliconFlow API 密钥 |
| `NODE_ENV` | 否 | `development` | 环境标识（development / production） |
| `PORT` | 否 | `3001` | 后端服务端口 |
| `CORS_ORIGIN` | 否 | `http://localhost:5173` | 允许跨域来源，逗号分隔 |
| `DATABASE_URL` | 否 | `file:./dev.db` | 数据库连接字符串 |
| `REDIS_URL` | 否 | — | Redis 连接（可选缓存层） |
| `SILICONFLOW_API_URL` | 否 | `https://api.siliconflow.cn/v1/chat/completions` | AI API 地址 |
| `SILICONFLOW_MODEL` | 否 | `deepseek-ai/DeepSeek-V3.2` | AI 模型标识 |
| `SILICONFLOW_TIMEOUT_MS` | 否 | `30000` | AI 调用超时（毫秒） |
| `THROTTLE_TTL` | 否 | `60000` | 限流时间窗口（毫秒） |
| `THROTTLE_LIMIT` | 否 | `60` | 全局每窗口最大请求数 |
| `AI_THROTTLE_LIMIT` | 否 | `15` | AI 接口每窗口最大请求数 |

> 后端启动时会执行环境变量校验，缺少必填项会直接报错阻断启动。

### 前端 `frontend/.env`

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `VITE_API_URL` | 空（走 Vite 代理） | API 基地址。留空 = 本地开发自动代理到 3001 |
| `VITE_SOCKET_URL` | 空（自动推导） | Socket 命名空间地址 |

---

## 常用命令

### 后端

```bash
npm run start:dev       # 开发模式（自动重载）
npm run build           # 构建到 dist/
npm run start:prod      # 生产运行 (node dist/main)
npm run test            # 单元测试
npm run test:cov        # 测试覆盖率
npm run prisma:generate # 生成 Prisma Client
npm run prisma:migrate  # 开发环境数据库迁移
npm run prisma:deploy   # 生产环境迁移（不交互）
npm run prisma:studio   # 数据库可视化管理界面
npm run prisma:reset    # 重置数据库（仅开发用）
```

### 前端

```bash
npm run dev             # Vite 开发服务器（端口 5173）
npm run build           # 生产构建（vue-tsc 类型检查 + Vite 打包）
npm run preview         # 预览构建产物
npm run electron:start  # 本地启动 Electron 桌面应用
npm run electron:build  # 打包 Electron 安装包（Windows NSIS）
```

---

## API 与模块说明

### 后端核心模块

| 模块 | 路径 | 职责 |
|------|------|------|
| `auth/` | `/auth` | 用户注册、登录、JWT 签发与守卫 |
| `users/` | `/users` | 用户信息管理 |
| `book/` | `/books` | 书籍 CRUD |
| `volume/` | `/volumes` | 卷管理 |
| `chapter/` | `/chapters` | 章节管理（含写作者视角接口） |
| `document/` | `/documents` | 文档内容管理 |
| `gateway/` | Socket.io | 协作编辑 WebSocket 网关 |
| `ai/` | `/ai` | AI 通用对话与辅助 |
| `agent/` | `/ai` | 写作智能体编排（三层架构核心） |
| `assistant/` | `/assistant` | 对话助手 |
| `consistency/` | — | 一致性检查服务 |
| `rag/` | — | 检索增强（embedding / 向量化） |
| `planner/` | — | 大纲规划服务 |
| `stats/` | `/stats` | 统计与写作日历 |
| `upload/` | `/upload` | 文件上传 |

### AI 核心接口

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/ai/ask` | 基于文档上下文问答 |
| `POST` | `/ai/suggest` | 基于命令给出写作建议（SSE 流） |
| `POST` | `/ai/polish/inline` | Copilot 行内润色（SSE 流） |
| `POST` | `/ai/assist-content` | 字段级 AI 补全（角色/世界观/大纲） |
| `POST` | `/ai/suggest-relationships` | AI 角色关系建议 |

### 世界观/剧情线/伏笔/角色 CRUD

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/ai/world-settings` | 创建世界观设定 |
| `PUT` | `/ai/world-settings/:id` | 更新世界观设定 |
| `DELETE` | `/ai/world-settings/:id` | 删除世界观设定 |
| `POST` | `/ai/plot-lines` | 创建剧情线 |
| `PUT` | `/ai/plot-lines/:id` | 更新剧情线 |
| `DELETE` | `/ai/plot-lines/:id` | 删除剧情线 |
| `POST` | `/ai/foreshadowings` | 创建伏笔 |
| `PUT` | `/ai/foreshadowings/:id` | 更新伏笔 |
| `PUT` | `/ai/foreshadowings/:id/resolve` | 回收伏笔 |
| `PUT` | `/ai/foreshadowings/:id/abandon` | 废弃伏笔 |
| `DELETE` | `/ai/foreshadowings/:id` | 删除伏笔 |
| `POST` | `/ai/characters` | 创建角色 |
| `DELETE` | `/ai/characters/:id` | 删除角色 |
| `POST` | `/ai/relationships` | 创建角色关系 |
| `PUT` | `/ai/relationships/:id` | 更新角色关系 |
| `DELETE` | `/ai/relationships/:id` | 删除角色关系 |

> 完整接口文档在开发环境可通过 Swagger 查看：**http://localhost:3001/api/docs**

---

## 生产部署方案

### 方案一：Nginx + Node.js（推荐）

最简单的生产部署方式，适合 VPS / 云服务器。

#### 1. 服务器准备

```bash
# 安装 Node.js 18+
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# 安装 PM2（进程守护）
npm install -g pm2

# 安装 Nginx
sudo apt-get install -y nginx
```

#### 2. 构建项目

```bash
# 克隆并进入项目
git clone <your-repo-url> /opt/ai-plus
cd /opt/ai-plus

# 后端构建
cd backend
npm install --production
npm run prisma:generate
npm run prisma:deploy     # 生产迁移（不交互）
npm run build

# 前端构建
cd ../frontend
npm install
npm run build             # 产物输出到 frontend/dist/
```

#### 3. 配置后端环境变量

```bash
cd /opt/ai-plus/backend
cat > .env << 'EOF'
NODE_ENV=production
PORT=3001
JWT_SECRET=<替换为64位随机字符串>
CORS_ORIGIN=https://your-domain.com
DATABASE_URL=file:./prod.db
SILICONFLOW_API_KEY=<你的API密钥>
SILICONFLOW_TIMEOUT_MS=60000
THROTTLE_LIMIT=120
AI_THROTTLE_LIMIT=20
EOF
```

> 生成强随机密钥：`openssl rand -base64 48`

#### 4. 用 PM2 启动后端

```bash
cd /opt/ai-plus/backend
pm2 start dist/main.js --name ai-plus-api
pm2 save
pm2 startup    # 设置开机自启
```

#### 5. 配置 Nginx

创建配置文件 `/etc/nginx/sites-available/ai-plus`：

```nginx
server {
    listen 80;
    server_name your-domain.com;

    # 前端静态文件
    root /opt/ai-plus/frontend/dist;
    index index.html;

    # SPA 路由回退
    location / {
        try_files $uri $uri/ /index.html;
    }

    # API 反向代理
    location /api/ {
        proxy_pass http://127.0.0.1:3001/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE 支持（AI 流式响应必需）
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 300s;
    }

    # WebSocket 代理
    location /socket.io/ {
        proxy_pass http://127.0.0.1:3001/socket.io/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400s;
    }

    # 静态资源长缓存
    location /assets/ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
```

启用站点：

```bash
sudo ln -s /etc/nginx/sites-available/ai-plus /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

#### 6. HTTPS（强烈推荐）

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

#### 7. 前端环境变量说明

如果前端和后端通过 Nginx 部署在**同一域名**下（上述配置），`VITE_API_URL` 和 `VITE_SOCKET_URL` 可留空，前端会自动走 `/api` 前缀。

如果前端和后端在**不同域名**，构建前需配置：

```bash
cd /opt/ai-plus/frontend
cat > .env << 'EOF'
VITE_API_URL=https://api.your-domain.com
VITE_SOCKET_URL=https://api.your-domain.com
EOF
npm run build
```

---

### 方案二：Docker 容器化

#### 后端 Dockerfile

```dockerfile
# backend/Dockerfile
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build

FROM node:18-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/prisma ./prisma
EXPOSE 3001
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
```

#### 前端 Dockerfile

```dockerfile
# frontend/Dockerfile
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG VITE_API_URL
ARG VITE_SOCKET_URL
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

#### docker-compose.yml

```yaml
version: '3.8'

services:
  backend:
    build: ./backend
    ports:
      - "3001:3001"
    environment:
      - NODE_ENV=production
      - PORT=3001
      - JWT_SECRET=${JWT_SECRET}
      - SILICONFLOW_API_KEY=${SILICONFLOW_API_KEY}
      - CORS_ORIGIN=${CORS_ORIGIN:-http://localhost}
      - DATABASE_URL=file:./data/prod.db
    volumes:
      - backend-data:/app/data
    restart: unless-stopped

  frontend:
    build:
      context: ./frontend
      args:
        VITE_API_URL: ${VITE_API_URL:-}
        VITE_SOCKET_URL: ${VITE_SOCKET_URL:-}
    ports:
      - "80:80"
    depends_on:
      - backend
    restart: unless-stopped

volumes:
  backend-data:
```

启动：

```bash
# 创建 .env 文件
cat > .env << 'EOF'
JWT_SECRET=<your-strong-secret>
SILICONFLOW_API_KEY=<your-api-key>
CORS_ORIGIN=http://localhost
EOF

# 启动所有服务
docker-compose up -d
```

---

### 方案三：云平台

| 平台 | 前端 | 后端 | 注意事项 |
|------|------|------|----------|
| **Vercel** | 直接部署 `frontend/` | 不支持 | 需单独部署后端 |
| **Railway** | 静态站点 | 一键部署 | 自动检测 Prisma |
| **Fly.io** | Dockerfile | Dockerfile | 需持久化卷存 SQLite |
| **阿里云 ECS** | 方案一 | 方案一 | 最灵活 |
| **腾讯云轻量** | 方案一 | 方案一 | 性价比高 |

> **重要**：SQLite 依赖本地文件系统，Serverless 平台（Vercel Functions / AWS Lambda）不适合运行后端。如需无服务器架构，请将数据库切换为 PostgreSQL。

---

### 数据库迁移到 PostgreSQL

如需支持更高并发或使用云数据库：

1. 修改 `backend/prisma/schema.prisma`:
   ```prisma
   datasource db {
     provider = "postgresql"
     url      = env("DATABASE_URL")
   }
   ```

2. 更新环境变量:
   ```
   DATABASE_URL=postgresql://user:password@host:5432/aiplus
   ```

3. 重新生成并迁移:
   ```bash
   npx prisma generate
   npx prisma migrate dev --name init-pg
   ```

---

## Electron 桌面应用

项目内置 Electron 28 支持，可打包为 Windows 桌面安装程序。

### 桌面应用特性
- **无边框自定义窗口**（1400×900 默认，1000×700 最小）
- **系统托盘**（最小化到托盘，右键菜单）
- **原生菜单栏**（文件/编辑/视图/帮助）
- **IPC 通信**（窗口控制、文件对话框、版本查询）
- **安全隔离**（contextIsolation + preload 桥接）

### 本地开发

```bash
cd frontend

# 终端 1：启动 Vite 开发服务器
npm run dev

# 终端 2：启动 Electron（会加载 localhost:5173）
npm run electron:start
```

### 打包发布

```bash
cd frontend

# 一键构建 + 打包（Windows NSIS 安装包）
npm run electron:build

# 安装包输出到 frontend/release/
```

### 桌面应用配置

打包前需在 `frontend/.env` 中指定后端地址：

```bash
VITE_API_URL=https://your-api-domain.com
VITE_SOCKET_URL=https://your-api-domain.com
```

打包参数在 `frontend/package.json` → `build` 字段中配置：

```json
{
  "build": {
    "appId": "com.aiplus.writer",
    "productName": "AI+作家助手",
    "win": { "target": "nsis", "icon": "public/icon.ico" },
    "nsis": { "oneClick": false, "allowToChangeInstallationDirectory": true }
  }
}
```

> 桌面应用**不内嵌后端**，需要单独部署后端服务。

---

## 工程化与安全

### 已落地

| 类别 | 措施 |
|------|------|
| 输入校验 | 全局 `ValidationPipe`（whitelist + forbidNonWhitelisted） |
| 安全头 | Helmet（生产环境启用 CSP） |
| 响应压缩 | compression（Gzip） |
| 异常处理 | 全局 AllExceptionsFilter + TransformInterceptor |
| 限流 | 全局限流 + AI 专用限流（@nestjs/throttler） |
| 配置治理 | 启动时环境变量校验，缺失即阻断 |
| AI 稳健性 | 统一封装、超时控制、错误语义化 |
| 请求体限制 | JSON / URLEncoded 均限制 10MB |
| 类型安全 | 前后端均使用 TypeScript Strict 模式 |
| API 文档 | Swagger 自动生成（仅开发环境） |

### 建议后续增强

- 结构化日志（pino + traceId）
- OpenTelemetry 指标与链路追踪
- E2E 测试（Playwright / Cypress）
- CI/CD 流水线（lint → test → build → deploy）
- 数据库定时备份策略
- AI Provider 抽象层（支持多模型切换）

---

## 更新日志 (2026-03-06)

### 一、AI 模型性能优化

针对 DeepSeek 模型调用速度慢的问题，在后端实施了六项核心优化：

#### 1. HTTP 连接池 (Keep-Alive)

在 `orchestrator.service.ts` 和 `ai.service.ts` 中引入 Node.js 原生 `http.Agent` / `https.Agent`，启用 `keepAlive: true`，最大 20 个并发 socket。避免每次 AI 请求重建 TCP/TLS 握手，显著降低请求延迟。

#### 2. 上下文内存缓存

`orchestrator.service.ts` 中的 `loadContext()` 方法新增内存缓存机制，缓存 TTL 可通过环境变量 `CONTEXT_CACHE_TTL_MS`（默认 30 秒）配置。同一 bookId+chapterId 在 TTL 内复用已有上下文，避免重复 4-5 次数据库查询。

#### 3. 并行候选生成

`generateWithPlanning()` 中的多候选生成从串行改为并行（`Promise.allSettled`），3 个 API 调用同时发起，与 `continueGeneration` 保持一致。

#### 4. 指数退避重试

所有 AI API 调用添加重试机制（最多 3 次），遇到 429（限流）、5xx（服务端错误）或超时时，按指数退避策略等待后重试。

#### 5. 快速模型路由

新增 `SILICONFLOW_FAST_MODEL` 环境变量，为一致性检查、思考阶段等轻量任务自动使用更快的小模型，减少旗舰模型排队压力。

#### 6. 深度思考优化

`streamDeepThinkChat()` 中的推理分析阶段（thinking phase）自动使用快速模型，而最终生成阶段使用用户选择的主模型。

### 二、多模型动态切换

#### 后端 API

| 新增端点 | 方法 | 说明 |
|----------|------|------|
| `/ai/models` | GET | 返回可用模型列表和默认模型 |

- `ChatMessageDto` 和 `DeepThinkChatDto` 新增可选 `modelId` 字段
- `OrchestratorService` 新增 `availableModels` 白名单、`resolveModel()` 安全解析
- 所有 AI 调用支持 `modelOverride` 参数，非白名单 ID 自动回退默认模型

#### 当前可用模型

| 模型 ID | 显示名 | 速度 | 说明 |
|---------|--------|------|------|
| `Pro/deepseek-ai/DeepSeek-V3.2` | DeepSeek V3.2 | 标准 | 旗舰模型，质量最高 |
| `Pro/zhipuai/GLM-5` | GLM-5 | 标准 | 智谱高质量模型 |
| `Pro/MiniMaxAI/MiniMax-M2.5` | MiniMax M2.5 | 快速 | 快速响应，均衡质量 |

#### 前端实现

- `agent.ts` Store 新增状态：`availableModels`、`selectedModelId`（localStorage 持久化）、`currentModelLabel`、`effectiveModelId`
- `AiPanelHeader.vue` 顶部品牌区域改为可点击模型选择器，Teleport 到 body 的固定定位下拉菜单
- 选择后，所有聊天/深度思考请求自动携带 `modelId` 参数
- 内置 fallback 模型列表，API 不可用时仍可使用

### 三、新手引导系统

为首次注册用户提供分步悬浮引导卡片，覆盖首页和编辑器全部核心功能。

#### 技术实现

| 文件 | 用途 |
|------|------|
| `frontend/src/composables/useOnboarding.ts` | 通用引导 composable，管理步骤序列、位置计算、localStorage 完成标记 |
| `frontend/src/components/OnboardingCard.vue` | 引导卡片组件：SVG mask 遮罩高亮 + 品牌色光圈 + 弹性动画 + 圆点进度 |

#### 首页引导 (HomeView) — 4 步

| 步骤 | 高亮目标 | 说明 |
|------|---------|------|
| 1 | 欢迎横幅 | 介绍智文写作助手整体功能 |
| 2 | 统计卡片 | 讲解作品总数/今日字数/连续天数 |
| 3 | 新建作品按钮 | 引导创建第一部作品 |
| 4 | 书籍网格 | 说明点击进入编辑器 |

#### 编辑器引导 (BookEditorView) — 9 步

| 步骤 | 高亮目标 | 说明 |
|------|---------|------|
| 1 | 顶部工具栏 | 字体/历史/查找替换/撤销AI 操作 |
| 2 | 章节管理面板 | 左侧章节列表和卷组结构 |
| 3 | 富文本编辑器 | 核心写作区域和浮动格式栏 |
| 4 | 右侧工具栏 | 9 个工具按钮总览 |
| 5 | AI 助手按钮 | AI 对话和多种写作能力 |
| 6 | 大纲与世界观 | 剧情线/伏笔/设定管理 |
| 7 | 角色管理 | 角色档案和关系图谱 |
| 8 | 智能润色 | Copilot 风格逐处修改 |
| 9 | 底部状态栏 | 字数统计和快捷操作 |

#### 视觉特性

- SVG mask 挖空遮罩 + `rgba(15,23,42,0.5)` 蓝调半透明背景
- 品牌蓝光圈高亮 (`boxShadow: 0 0 0 3px rgba(79,124,255,0.5)`)
- 顶部渐变装饰条 (brand → indigo → purple)
- `cubic-bezier(0.16,1,0.3,1)` 弹性入场动画
- 圆点进度指示器（当前步骤为胶囊形态）
- 最后一步显示 "开始使用 🎉"

#### 行为逻辑

- 仅首次访问触发（`localStorage` 标记 `onboarding_home_done` / `onboarding_editor_done`）
- 数据加载完成后延迟启动（首页 600ms，编辑器 800ms）
- 支持"上一步/下一步/跳过引导"操作
- 完成或跳过后永久不再显示
- 重制方法：`localStorage.removeItem('onboarding_home_done')`

### 四、新增环境变量

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `SILICONFLOW_FAST_MODEL` | `Qwen/Qwen2.5-7B-Instruct` | 轻量任务使用的快速模型 |
| `CONTEXT_CACHE_TTL_MS` | `30000` | 上下文缓存 TTL（毫秒） |

### 五、变更文件汇总

#### 后端
| 文件 | 变更类型 |
|------|---------|
| `backend/src/agent/orchestrator.service.ts` | 重大修改：连接池、缓存、并行生成、重试、快速模型、模型切换 |
| `backend/src/ai/ai.service.ts` | 修改：连接池、重试机制、默认模型更新 |
| `backend/src/agent/agent.controller.ts` | 修改：新增 GET /ai/models 端点、modelId 透传 |
| `backend/src/agent/dto/agent.dto.ts` | 修改：ChatMessageDto/DeepThinkChatDto 添加 modelId |
| `backend/src/config/env.validation.ts` | 修改：新增环境变量验证 |
| `backend/.env` / `.env.example` | 修改：新增配置项 |

#### 前端
| 文件 | 变更类型 |
|------|---------|
| `frontend/src/stores/agent.ts` | 修改：模型选择状态、API 调用携带 modelId |
| `frontend/src/components/AiPanelHeader.vue` | 修改：模型选择下拉菜单（Teleport + fixed 定位） |
| `frontend/src/composables/useOnboarding.ts` | **新增**：通用引导 composable |
| `frontend/src/components/OnboardingCard.vue` | **新增**：引导卡片组件 |
| `frontend/src/views/HomeView.vue` | 修改：data-guide 属性 + 引导集成 |
| `frontend/src/views/BookEditorView.vue` | 修改：data-guide 属性 + 引导集成 |

### 测试状态

所有 8 个测试套件、104 个测试全部通过。

---

## 常见问题

### Q: 启动报 `JWT_SECRET 未配置`
检查 `backend/.env` 是否存在且配置了 `JWT_SECRET`。重启后端。

### Q: AI 接口返回 502 或超时
1. 检查 `SILICONFLOW_API_KEY` 是否正确
2. 确认网络可访问 `api.siliconflow.cn`
3. 增大 `SILICONFLOW_TIMEOUT_MS`（建议生产 60000+）

### Q: 前端请求 404 / 跨域失败
- **本地开发**：确保 `VITE_API_URL` 为空（自动走 Vite 代理）
- **生产部署**：检查 Nginx `/api/` 反代配置 + 后端 `CORS_ORIGIN`

### Q: WebSocket 连接失败
- 检查 Nginx 配置是否包含 `proxy_http_version 1.1` + `Upgrade` 头
- 检查 `VITE_SOCKET_URL` 或 `VITE_API_URL`

### Q: SQLite 并发性能不足
迁移到 PostgreSQL — 见 [数据库迁移](#数据库迁移到-postgresql) 章节。

### Q: Electron 打包后连不上后端
桌面应用不内嵌后端，需单独部署后端并在 `VITE_API_URL` 中指定地址后重新打包。

### Q: 构建产物体积偏大
主编辑器 chunk (~560KB min / ~170KB gzip) 较大，可通过以下方式优化：
- `vite.config.ts` 中配置 `build.rollupOptions.output.manualChunks` 拆分 TipTap
- 已启用路由懒加载
- 部署时启用 Nginx Gzip 压缩即可

---

## 项目结构

```
ai+/
├── README.md                        # 本文档
├── SPEC.md                          # 技术规格文档
│
├── backend/                         # NestJS 后端
│   ├── prisma/
│   │   ├── schema.prisma            # 数据模型定义（31 个表）
│   │   └── migrations/              # 数据库迁移文件
│   ├── src/
│   │   ├── main.ts                  # 启动入口
│   │   ├── app.module.ts            # 根模块
│   │   ├── prisma.service.ts        # Prisma 数据库服务
│   │   ├── agent/                   # AI 智能体编排（核心）
│   │   │   ├── orchestrator.service.ts  # 编排器：续写/润色/补全/关系建议
│   │   │   ├── agent.controller.ts      # AI 相关全部接口
│   │   │   └── dto/                     # 数据传输对象
│   │   ├── ai/                      # AI 通用服务
│   │   ├── assistant/               # 对话助手
│   │   ├── auth/                    # JWT 认证（Passport）
│   │   ├── book/                    # 书籍管理
│   │   ├── chapter/                 # 章节管理
│   │   ├── character/               # 角色服务
│   │   ├── common/                  # 公共模块
│   │   │   ├── filters/             # 全局异常过滤器
│   │   │   ├── interceptors/        # 日志 + 响应格式化拦截器
│   │   │   └── redis/               # Redis 缓存模块
│   │   ├── config/                  # 环境变量校验
│   │   ├── consistency/             # 一致性检查服务
│   │   ├── document/                # 文档管理
│   │   ├── gateway/                 # Socket.io 协作网关
│   │   ├── planner/                 # 大纲规划服务
│   │   ├── rag/                     # 检索增强（向量化）
│   │   ├── scene/                   # 场景服务
│   │   ├── stats/                   # 统计
│   │   ├── upload/                  # 文件上传
│   │   ├── users/                   # 用户管理
│   │   └── volume/                  # 卷管理
│   ├── package.json
│   ├── tsconfig.json
│   ├── jest.config.js
│   └── .env.example                 # 环境变量模板
│
├── frontend/                        # Vue 3 前端
│   ├── electron/                    # Electron 桌面应用
│   │   ├── main.cjs                 # 主进程（窗口/托盘/菜单/IPC）
│   │   └── preload.cjs              # 安全预加载脚本
│   ├── src/
│   │   ├── main.ts                  # Vue 应用入口
│   │   ├── App.vue                  # 根组件
│   │   ├── assets/
│   │   │   └── main.css             # 全局样式 + TipTap + 润色动画
│   │   ├── components/
│   │   │   ├── Sidebar.vue              # 侧边导航栏
│   │   │   ├── ThreeLayerPanel.vue      # AI 三层面板（战略/战术/执行）
│   │   │   ├── AiPanelHeader.vue        # AI 面板顶栏（含模型切换下拉）
│   │   │   ├── OnboardingCard.vue       # 新手引导浮动卡片组件
│   │   │   ├── CharacterEditor.vue      # 角色全屏编辑器（4 维管理）
│   │   │   ├── WorldSettingEditor.vue   # 世界观全屏编辑器
│   │   │   ├── PlotLineEditor.vue       # 剧情线全屏编辑器
│   │   │   ├── ForeshadowingEditor.vue  # 伏笔全屏编辑器
│   │   │   ├── RelationshipGraph.vue    # SVG 力导向关系图
│   │   │   └── InlinePolishPlugin.ts    # TipTap Copilot 行内润色插件
│   │   ├── composables/
│   │   │   ├── useSocket.ts         # Socket.io 组合式函数
│   │   │   └── useOnboarding.ts     # 新手引导系统 composable
│   │   ├── lib/
│   │   │   ├── api.ts               # Axios HTTP 封装
│   │   │   └── textToHtml.ts        # 文本 → HTML 转换
│   │   ├── stores/
│   │   │   ├── agent.ts             # AI 代理 Store（~1800行，核心状态）
│   │   │   ├── ai.ts                # AI 通用 Store
│   │   │   ├── auth.ts              # 认证 Store
│   │   │   ├── book.ts              # 书籍 Store
│   │   │   └── document.ts          # 文档 Store
│   │   └── views/
│   │       └── BookEditorView.vue   # 主编辑器视图（TipTap + 行内润色）
│   ├── package.json
│   ├── vite.config.ts               # Vite 配置（代理/别名）
│   ├── tailwind.config.js           # Tailwind 自定义设计令牌
│   ├── tsconfig.json
│   └── .env.example                 # 前端环境变量模板
```

---

## License

MIT
