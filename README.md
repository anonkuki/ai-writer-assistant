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
  <img src="https://img.shields.io/badge/Tests-107%20passed-4ade80" alt="Tests" />
  <img src="https://img.shields.io/badge/License-MIT-blue" alt="License" />
</p>

<p>
  <img src="picture/主页.png" alt="AI+ 主页" width="80%" />
</p>

> 提供书籍-卷-章结构化管理、实时协作编辑、**三层 AI 写作代理**（战略-战术-执行）、角色关系网络、Copilot 风格行内润色、**多步编排任务系统**、**一键创意计划**（从零生成完整设定+章节）、**一致性检查引擎**与 **RAG 检索增强**。通过 **SiliconFlow** 平台调用 **DeepSeek-V3.2 / GLM-5 / MiniMax-M2.5** 大语言模型（支持动态切换），支持 Web 部署与 Electron 桌面应用打包，可完全私有化部署到本地。

</div>

---

## 目录

- [产品截图展示](#产品截图展示)
- [项目定位](#项目定位)
- [核心功能](#核心功能)
- [技术栈](#技术栈)
- [系统架构](#系统架构)
- [AI 能力全景](#ai-能力全景)
- [数据模型](#数据模型)
- [本地部署指南](#本地部署指南)
- [环境变量配置](#环境变量配置)
- [常用命令](#常用命令)
- [API 接口总览](#api-接口总览)
- [生产部署方案](#生产部署方案)
- [Electron 桌面应用](#electron-桌面应用)
- [工程化与安全](#工程化与安全)
- [项目结构](#项目结构)
- [常见问题](#常见问题)

---

## 产品截图展示

### 登录页

用户注册与登录界面，采用 JWT 无状态令牌鉴权，支持安全的用户隔离。

<p align="center">
  <img src="picture/登录页.png" alt="登录页" width="80%" />
</p>

### 主页仪表板

书籍管理主页，展示用户全部创作项目与写作统计（总字数/今日字数/连续天数），支持新建书籍、卷、章节的全链路管理。首次访问自动触发新手引导。

<p align="center">
  <img src="picture/主页.png" alt="主页仪表板" width="80%" />
</p>

### 写作编辑页

基于 TipTap (ProseMirror) 的富文本编辑器，集成 Slash Command 菜单、Markdown 快捷键、右侧 8 大创作工具面板（校对/拼字/大纲/角色/世界观/灵感/润色）、实时协作与自动保存。

<p align="center">
  <img src="picture/写作页.png" alt="写作编辑页" width="80%" />
</p>

### AI 助手面板

右侧滑出式 AI 助手面板，支持基于文档上下文的智能问答、续写、改写和摘要生成。所有 AI 响应均通过 SSE 流式传输实时展示，支持**多模型动态切换**（DeepSeek V3.2 / GLM-5 / MiniMax M2.5）。

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

### 实际使用场景 — 小说多维度构建

利用 AI 创意计划功能，一键生成包含世界观、角色群、剧情线、伏笔系统和章节大纲的完整创作框架。从自然语言描述到结构化小说蓝图，实现「零到一」的快速构建。

<p align="center">
  <img src="picture/实际使用场景_小说多维度构建.png" alt="小说多维度构建" width="80%" />
</p>

### 实际使用场景 — 根据已有章纲编写

在已有结构化大纲（世界观 / 角色 / 剧情线 / 伏笔）的基础上，AI 根据章节大纲自动生成正文内容。系统自动加载全书设定作为上下文，确保生成内容与已有设定保持一致。

<p align="center">
  <img src="picture/实际使用场景_根据已有章纲编写.png" alt="根据已有章纲编写" width="80%" />
</p>

<p align="center">
  <img src="picture/实际使用场景_根据已有章纲编写2.png" alt="根据已有章纲编写 - 生成结果" width="80%" />
</p>

---

## 项目定位

AI+ 面向 **可持续长篇写作生产** 而非一次性对话：

- 以 **Book → Volume → Chapter → Document** 层级组织创作资产
- 通过 **三层 AI 代理架构**（L3 战略层 → L2 战术层 → L1 执行层）系统化辅助创作
- 以 **创意计划** 支持从自然语言描述一键生成完整小说蓝图并批量执行
- 以 **多步编排系统** 将复杂创作拆解为可审批的子任务流
- 用 **Socket.io 协作网关** 支持多人实时编辑
- 用 **一致性检查引擎 + RAG 检索增强** 保障长篇内容的逻辑连贯与质量
- 用 **全文分析引擎** 从伏笔、角色弧线、叙事节奏、综合质量四个维度诊断作品
- 提供 **新手引导系统**，降低使用门槛

适合个人创作者、小型内容团队的私有化部署。

---

## 核心功能

### 结构化写作管理
- 书籍 / 卷 / 章节全链路 CRUD，章节版本快照与回滚
- 字数统计仪表盘与写作日历（今日字数/连续天数/活跃天数/周月趋势图）
- 灵感卡片收集与管理

### AI 辅助创作

<p align="center">
  <img src="picture/ai助手.png" alt="AI 辅助创作" width="60%" />
</p>

- **续写 / 改写 / 摘要**：基于上下文的 SSE 流式生成，支持 1-5 个多候选并行生成（温度递增提升多样性）
- **FIM 光标续写**：支持 Fill-in-the-Middle 模式，在文中任意位置插入光标即可触发上下文感知续写
- **Copilot 行内润色**：选中文本后获取红绿 Diff 对比建议，逐条接受/拒绝
- **深度思考对话**：两阶段推理（快速模型分析 → 主模型生成），含推理过程透明展示
- **创意计划**：自然语言描述 → AI 一键生成完整创作方案（世界观 + 角色群 + 剧情线 + 伏笔 + 章节大纲 + 前 N 章正文），支持流式生成与批量执行
- **全文分析**：四大分析维度（伏笔分析 / 角色弧线 / 节奏分析 / 全面诊断），返回结构化建议并按优先级排序
- **多步编排系统**：复杂任务自动拆解 → 逐步思考 → 用户审批 → 批量执行
- **大纲变更影响分析**：角色 / 世界观 / 剧情线 / 伏笔变更时，自动分析受影响章节并标注严重级别（HIGH / MEDIUM / LOW）
- **多模型动态切换**：DeepSeek V3.2 / GLM-5 / MiniMax M2.5，面板顶部一键切换

### 右侧 8 大创作工具

| 工具 | 说明 |
|------|------|
| 校对助手 | 语法、逻辑、上下文一致性全面检查 |
| 拼字检查 | 错别字、同音字智能纠错 |
| 大纲生成 | 章节结构化大纲 AI 生成 |
| 角色管理 | 角色档案 + 关系图谱 + AI 补全 |
| 世界观设定 | 题材/基调/力量体系/地理/社会/历史 |
| 灵感生成 | 基于上下文的创意激发 |
| 妙笔润色 | 修辞与风格优化建议 |
| 字段级补全 | 角色/世界观/大纲任意字段 AI 建议，一键采纳 |
| 全文分析 | 伏笔/角色弧线/节奏/综合四维度深度诊断 |

### 全屏编辑器系列

<p align="center">
  <img src="picture/写作页.png" alt="全屏编辑器" width="60%" />
</p>

- **角色编辑器**：基本信息 / 性格心理 / 能力成长 / 背景故事 四维管理
- **世界观编辑器**：流派 / 基调 / 力量体系 / 地理 / 社会 / 历史 / 规则
- **剧情线编辑器**：主线 / 副线 / 角色线，含冲突-高潮-结局结构
- **伏笔编辑器**：创建 / 回收 / 废弃状态管理，AI 伏笔回收建议

### 角色关系网络
- SVG 力导向图（零依赖），节点按角色着色（主角/配角/反派）
- 边按关系状态着色（正面/负面/复杂），双向贝塞尔曲线
- 拖拽交互、双击打开角色编辑
- **AI 关系建议**：自动分析角色并推荐 3-6 条有故事潜力的缺失关系，说明每段关系对剧情的推动作用

### 一致性检查引擎
- 自定义检查规则（时间线/角色能力/性格/世界观规则/伏笔）
- 章节级 / 全书扫描，生成结构化报告（评分 + 问题列表 + 修改建议）
- 规则启用/禁用切换，历史报告查阅

### RAG 检索增强
- 基于 `BAAI/bge-large-zh-v1.5` 的向量嵌入
- 全书内容索引（章节/角色/世界观/剧情线/伏笔/场景）
- 语义检索辅助 AI 上下文构建，伏笔回收建议

### 实时协作
- WebSocket 房间机制 + 内容增量同步
- 在线协作者感知

### 新手引导系统
- 首页 4 步引导 + 编辑器 9 步引导
- SVG mask 遮罩高亮 + 品牌色光圈 + 弹性动画
- 仅首次访问触发，localStorage 持久化完成标记

---

## 技术栈

### 前端

| 类别 | 技术 | 版本 | 说明 |
|------|------|------|------|
| 框架 | Vue 3 | 3.5+ | Composition API + `<script setup>` |
| 状态管理 | Pinia | 2.1 | 响应式 Store（5 个核心 Store） |
| 编辑器 | TipTap | 2.2 | 基于 ProseMirror 的富文本编辑器 |
| 样式 | Tailwind CSS | 3.4 | 自定义设计令牌 |
| 构建工具 | Vite | 5.0 | HMR + 开发代理 |
| 类型检查 | TypeScript | 5.3 | Strict 模式 |
| HTTP | Axios | 1.6 | API 请求（自动附加 JWT） |
| 实时通信 | Socket.io-client | 4.7 | WebSocket 协作 |
| 桌面 | Electron | 28 | 可选桌面应用打包 |
| 路由 | Vue Router | 4.2 | SPA 路由（懒加载） |

### 后端

| 类别 | 技术 | 版本 | 说明 |
|------|------|------|------|
| 框架 | NestJS | 10.3 | 模块化企业级框架（19 个业务模块） |
| ORM | Prisma | 5.9 | 类型安全数据库访问 |
| 数据库 | SQLite | — | 默认轻量数据库（可迁移 PostgreSQL） |
| 实时通信 | Socket.io | 4.7 | WebSocket 网关 |
| 认证 | Passport + JWT | — | 无状态令牌鉴权 |
| 校验 | class-validator | 0.14 | DTO 输入校验 |
| AI 调用 | Axios + HTTP Agent | 1.6 | SiliconFlow API（连接池 + 指数退避重试） |
| 安全 | Helmet | 8.1 | HTTP 安全头 |
| 压缩 | compression | 1.8 | Gzip 响应压缩 |
| 限流 | @nestjs/throttler | 6.5 | 全局 60次/分 + AI 15次/分 |
| 缓存 | cache-manager + Redis | — | 可选 Redis 缓存层 + 上下文内存缓存 |
| 文档 | @nestjs/swagger | 11.2 | 自动生成 API 文档 |
| 测试 | Jest | 29.7 | 8 个套件 / 107 个测试 |

### AI 模型

| 提供商 | 模型 | 用途 | 速度 |
|--------|------|------|------|
| SiliconFlow | DeepSeek-V3.2 | 对话/续写/润色/补全（默认旗舰） | 标准 |
| SiliconFlow | GLM-5 | 用户可选的智谱高质量模型 | 标准 |
| SiliconFlow | MiniMax-M2.5 | 用户可选的快速响应模型 | 快速 |
| SiliconFlow | Qwen2.5-7B-Instruct | 轻量任务自动路由（一致性检查/思考阶段） | 极快 |
| SiliconFlow | BAAI/bge-large-zh-v1.5 | RAG 向量嵌入检索 | — |

支持 **SSE 流式输出**（续写/润色/对话/编排）与 **常规 JSON 响应**（角色/大纲/关系建议）。
前端支持**动态切换模型**（localStorage 持久化），非白名单模型 ID 自动回退默认模型。

---

## 系统架构

```
┌─────────────┐     HTTP/WS      ┌──────────────┐     Prisma     ┌──────────┐
│  Vue 3 SPA  │ ◄──────────────► │  NestJS API  │ ◄────────────► │  SQLite  │
│  (or Electron)                 │  19 个模块    │                │(可替换PG)│
└─────────────┘                  │              │                └──────────┘
       │                         │  ┌─────────┐ │
       │    /socket.io           │  │ Socket  │ │     REST       ┌──────────┐
       └─────────────────────────┤  │ Gateway │ │ ◄────────────► │SiliconFlow│
                                 │  └─────────┘ │                │ LLM API  │
                                 │              │                └──────────┘
                                 │  ┌─────────┐ │
                                 │  │  Agent  │ │     Embedding  ┌──────────┐
                                 │  │Orchestr.│ │ ◄────────────► │ BGE-zh   │
                                 │  └─────────┘ │                │ 向量模型  │
                                 │              │                └──────────┘
                                 │  ┌─────────┐ │
                                 │  │  RAG +  │ │     Optional   ┌──────────┐
                                 │  │Consist. │ │ ◄────────────► │  Redis   │
                                 │  └─────────┘ │                └──────────┘
                                 └──────────────┘
```

### 三层 AI 代理架构

| 层级 | 名称 | 职责 | 数据模型 |
|------|------|------|----------|
| L3 | 战略层 | 世界观、剧情线、时间线、伏笔、大纲规划 | WorldSetting, PlotLine, TimelineEvent, Foreshadowing, Outline |
| L2 | 战术层 | 角色档案、关系网络、情绪轨迹、成长记录 | CharacterProfile, CharacterRelationship, EmotionLog, GrowthRecord |
| L1 | 执行层 | 场景管理、事件日志、章节摘要、AI 会话 | Scene, EventLog, ChapterSummary, AgentSession |

### 关键流程

1. 用户登录获取 JWT → 前端自动附加 Bearer Token
2. 前端调用 REST API 管理书籍与章节
3. 进入编辑器后连接 Socket 命名空间并加入文档房间
4. 用户触发 AI 操作，后端从上下文缓存（30s TTL）加载数据并拼接 Prompt
5. 通过连接池调用 SiliconFlow 模型，失败自动指数退避重试（最多 3 次）
6. 流式结果实时推送前端，非流式结果回写文档并向协作者广播

---

## AI 能力全景

本项目通过 **SiliconFlow** 云平台统一调用 AI 大语言模型，所有 AI 请求均在后端发起，前端不直接接触 API 密钥，确保安全性。

### 获取 API Key

访问 [SiliconFlow 控制台](https://cloud.siliconflow.cn) 注册账号 → 创建 API Key → 填入后端环境变量 `SILICONFLOW_API_KEY`。新用户有免费额度，可直接用于开发测试。

### 后端 AI 服务矩阵

| 服务 | 文件 | 职责 | 调用方式 |
|------|------|------|----------|
| **AI 通用服务** | `ai/ai.service.ts` | 文档问答、写作辅助 | HTTP POST（非流式） |
| **编排器** | `agent/orchestrator.service.ts` | 续写、多候选生成、行内润色、多步编排、模型切换 | SSE 流式 |
| **RAG 服务** | `rag/rag.service.ts` | 向量嵌入、语义检索、全书索引 | Embedding API |
| **一致性检查** | `consistency/consistency.service.ts` | 逻辑矛盾检测、规则引擎、报告生成 | HTTP POST |
| **规划服务** | `planner/planner.service.ts` | 大纲更新影响分析 | HTTP POST |
| **角色服务** | `character/character.service.ts` | 角色档案管理、AI 关系建议、冲突检测 | HTTP POST |
| **场景服务** | `scene/scene.service.ts` | 场景 CRUD、自动分割 | HTTP POST |

### 性能优化措施

| 优化项 | 说明 |
|--------|------|
| **HTTP 连接池** | Keep-Alive 复用 TCP/TLS 连接，最大 20 并发 socket |
| **上下文内存缓存** | 同一 bookId+chapterId 在 TTL（默认 30s）内复用，减少 4-5 次 DB 查询 |
| **并行候选生成** | 多候选续写 `Promise.allSettled` 并发调用，1-5 个候选温度递增 |
| **指数退避重试** | 429/5xx/超时自动重试（最多 3 次） |
| **快速模型路由** | 一致性检查、深度思考分析阶段自动使用轻量模型 |
| **双通道 AI 调用** | SiliconFlow 统一网关 + MiniMax 付费直连，按模型类型自动路由 |

### 前端 AI 交互流程

```
用户操作 (选中文本/点击按钮)
    │
    ▼
前端 Store (agent.ts / ai.ts)
    │  发起 HTTP 请求到后端 /ai/* 端点
    ▼
Axios 封装层 (lib/api.ts)
    │  自动附加 JWT Bearer Token + modelId
    ▼
后端 NestJS Controller
    │
    ▼
Service 层加载上下文缓存 + 拼接 Prompt
    │
    ▼
调用 SiliconFlow API（连接池 + 重试）
    │
    ▼  流式: SSE → EventSource 实时推送
    ▼  非流式: JSON → 标准 HTTP 响应
前端展示结果 (AI 面板 / Diff 对比 / 编排面板 / 编辑器内嵌)
```

---

## 数据模型

项目使用 Prisma + SQLite，共 **34 个数据模型**：

```
用户与团队       文档协作             书籍结构              AI 三层架构
─────────      ─────────            ─────────            ──────────
User           Document             Book                 L3: WorldSetting
Team           DocumentVersion      Volume                   PlotLine
TeamMember     Folder               Chapter                  TimelineEvent
TeamInvite     Tag / DocumentTag    ChapterVersion           Foreshadowing
               Share                Outline                  Outline
               Favorite             Character            L2: CharacterProfile
               Comment              Inspiration              CharacterRelationship
               Notification         WritingStat              EmotionLog
               AuditLog                                      GrowthRecord
                                                         L1: Scene
                                                             EventLog
                                                             ChapterSummary
                                                             AgentSession

辅助: Embedding (向量存储), ConsistencyRule, ConsistencyReport
```

完整 Schema 见 `backend/prisma/schema.prisma`。

---

## 本地部署指南

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

在 `backend/` 目录下创建 `.env` 文件，**至少配置以下两项**：

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
SILICONFLOW_FAST_MODEL=Qwen/Qwen2.5-7B-Instruct
SILICONFLOW_TIMEOUT_MS=30000
CONTEXT_CACHE_TTL_MS=30000
```

前端通常无需修改环境变量，本地开发会自动通过 Vite 代理转发到后端。

### 第五步：初始化数据库

```bash
cd backend

# 生成 Prisma Client（类型安全的数据库访问层）
npm run prisma:generate

# 执行数据库迁移（自动创建 SQLite 数据库文件和全部数据表）
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

打开浏览器访问 http://localhost:5173，注册账号即可开始使用。首次登录会自动触发新手引导。

### 本地部署验证清单

- [ ] 后端启动无报错（特别检查 `JWT_SECRET` 和 `SILICONFLOW_API_KEY`）
- [ ] 前端 Vite 开发服务器正常运行
- [ ] 能正常注册/登录用户
- [ ] 能创建书籍和章节
- [ ] AI 助手能正常对话（验证 API Key 有效）
- [ ] 编辑器实时保存正常工作
- [ ] 模型切换功能正常（AI 面板顶部切换）

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
| `SILICONFLOW_MODEL` | 否 | `deepseek-ai/DeepSeek-V3.2` | 默认 AI 模型标识 |
| `SILICONFLOW_FAST_MODEL` | 否 | `Qwen/Qwen2.5-7B-Instruct` | 轻量任务快速模型 |
| `SILICONFLOW_TIMEOUT_MS` | 否 | `30000` | AI 调用超时（毫秒） |
| `CONTEXT_CACHE_TTL_MS` | 否 | `30000` | 上下文缓存 TTL（毫秒） |
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
npm run test            # 单元测试（8 套件 / 107 测试）
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

## API 接口总览

### 后端核心模块（19 个）

| 模块 | 路由前缀 | 职责 |
|------|----------|------|
| `auth/` | `/auth` | 用户注册、登录、JWT 签发与守卫 |
| `users/` | `/users` | 用户信息管理 |
| `book/` | `/books` | 书籍 CRUD |
| `volume/` | `/volumes` | 卷管理 |
| `chapter/` | `/chapters` | 章节管理（含写作者视角接口） |
| `document/` | `/documents` | 文档内容管理 |
| `gateway/` | Socket.io | 协作编辑 WebSocket 网关 |
| `ai/` | `/ai` | AI 通用对话与辅助 |
| `agent/` | `/ai` | 写作智能体编排（三层架构核心，40+ 端点） |
| `assistant/` | `/assistant` | 对话助手 |
| `consistency/` | `/ai/consistency` | 一致性检查（规则/扫描/报告） |
| `rag/` | `/ai/rag`, `/ai/retrieve` | 检索增强（向量化/语义检索） |
| `planner/` | `/ai/planner` | 大纲规划与影响分析 |
| `character/` | — | 角色档案/关系/情绪/成长服务 |
| `scene/` | `/ai/scenes` | 场景管理与自动分割 |
| `stats/` | `/stats` | 写作统计与日历 |
| `upload/` | `/upload` | 文件上传（5MB 限制） |
| `common/` | — | 异常过滤器、日志拦截器、Redis 缓存 |
| `config/` | — | 环境变量启动校验 |

### AI 流式接口

| 端点 | 方法 | 说明 |
|------|------|------|
| `/ai/chat/stream` | POST | SSE 流式对话（基于文档上下文） |
| `/ai/deep-think/stream` | POST | 深度思考流式对话（含推理过程） |
| `/ai/polish/inline` | POST | Copilot 行内润色建议（SSE） |
| `/ai/generate/continue` | POST | 多候选续写生成（SSE） |
| `/ai/orchestrate/stream` | POST | 多步编排流式执行 |
| `/ai/tool-analysis/stream` | POST | 校对/拼字/灵感/润色工具分析（SSE） |
| `/ai/analyze/stream` | POST | 全文分析（伏笔/角色弧线/节奏/综合）（SSE） |
| `/ai/creative-plan/stream` | POST | 流式创意计划生成 |
| `/ai/creative-plan/stream-execute` | POST | 流式创意计划执行 |

### AI 非流式接口

| 端点 | 方法 | 说明 |
|------|------|------|
| `/ai/ask` | POST | 文档问答 |
| `/ai/suggest` | POST | 写作建议 |
| `/ai/assist-content` | POST | 字段级 AI 补全（支持 key 归一化） |
| `/ai/suggest-relationships` | POST | 角色关系 AI 建议（3-6 条推荐） |
| `/ai/creative-plan` | POST | 创意计划生成（结构化 JSON） |
| `/ai/creative-plan/execute` | POST | 批量执行创意计划（逐步创建资源） |
| `/ai/planner/impact` | POST | 大纲变更影响分析 |
| `/ai/models` | GET | 可用模型列表 |

### 三层架构 CRUD（L3 战略 / L2 战术 / L1 执行）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET/POST/PUT/DELETE | `/ai/world-settings` | 世界观设定 |
| GET/POST/PUT/DELETE | `/ai/plot-lines` | 剧情线 |
| GET/POST/DELETE | `/ai/timeline-events` | 时间线事件 |
| GET/POST/PUT/DELETE | `/ai/foreshadowings` | 伏笔管理（含回收/废弃） |
| GET/POST/PUT/DELETE | `/ai/outlines` | 章节大纲 |
| GET/POST | `/ai/character-profile` | 角色档案（Upsert） |
| GET/POST/PUT/DELETE | `/ai/relationships` | 角色关系 |
| GET/POST | `/ai/emotions` | 情绪日志 |
| GET/POST | `/ai/growth` | 成长记录 |
| GET/POST/PUT/DELETE | `/ai/scenes` | 场景管理 |
| POST | `/ai/scenes/auto-split` | 自动分割场景 |
| GET/POST/PUT/DELETE | `/ai/consistency/rules` | 一致性规则 |
| POST | `/ai/consistency/check` | 章节一致性检查 |
| POST | `/ai/consistency/scan/:bookId` | 全书扫描 |
| GET | `/ai/consistency/reports/:bookId` | 检查报告 |
| POST | `/ai/rag/index/:bookId` | 全书 RAG 索引 |
| GET | `/ai/retrieve/:bookId` | 语义检索 |

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
| 限流 | 全局限流 60次/分 + AI 限流 15次/分（@nestjs/throttler） |
| 配置治理 | 启动时环境变量校验，缺失即阻断 |
| AI 稳健性 | 连接池复用、指数退避重试、快速模型路由、上下文缓存 |
| 请求体限制 | JSON / URLEncoded 均限制 10MB |
| 类型安全 | 前后端均使用 TypeScript Strict 模式 |
| API 文档 | Swagger 自动生成（仅开发环境） |
| 单元测试 | Jest 8 个套件 / 107 个测试全部通过 |

---

## 项目结构

```
ai-plus/
├── README.md                        # 本文档
├── SPEC.md                          # 技术规格文档
├── DEPLOY.md                        # 部署指南
│
├── backend/                         # NestJS 后端
│   ├── prisma/
│   │   ├── schema.prisma            # 数据模型定义（34 个表）
│   │   └── migrations/              # 数据库迁移文件
│   ├── src/
│   │   ├── main.ts                  # 启动入口（安全/压缩/校验/日志）
│   │   ├── app.module.ts            # 根模块（19 个业务模块注册）
│   │   ├── prisma.service.ts        # Prisma 数据库服务
│   │   ├── agent/                   # AI 智能体编排（核心）
│   │   │   ├── orchestrator.service.ts  # 编排器：续写/润色/补全/编排/模型切换
│   │   │   ├── agent.controller.ts      # 40+ AI 端点
│   │   │   └── dto/                     # 数据传输对象
│   │   ├── ai/                      # AI 通用服务（问答/建议/写作）
│   │   ├── assistant/               # 对话助手
│   │   ├── auth/                    # JWT 认证（Passport）
│   │   ├── book/                    # 书籍管理
│   │   ├── chapter/                 # 章节管理（含写作者视角）
│   │   ├── character/               # 角色档案/关系/情绪/成长
│   │   ├── common/                  # 公共模块
│   │   │   ├── constants/           # 常量定义
│   │   │   ├── filters/             # 全局异常过滤器
│   │   │   ├── interceptors/        # 日志 + 响应格式化拦截器
│   │   │   └── redis/               # Redis 缓存模块
│   │   ├── config/                  # 环境变量启动校验
│   │   ├── consistency/             # 一致性检查（规则引擎+报告）
│   │   ├── document/                # 文档管理
│   │   ├── gateway/                 # Socket.io 协作网关
│   │   ├── planner/                 # 大纲规划与影响分析
│   │   ├── rag/                     # RAG 检索增强（向量嵌入+语义检索）
│   │   ├── scene/                   # 场景管理与自动分割
│   │   ├── stats/                   # 写作统计与日历
│   │   ├── upload/                  # 文件上传（5MB 限制）
│   │   ├── users/                   # 用户管理
│   │   └── volume/                  # 卷管理
│   ├── package.json
│   ├── tsconfig.json
│   └── jest.config.js
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
│   │   ├── components/              # 12 个核心组件
│   │   │   ├── Sidebar.vue              # 侧边导航栏
│   │   │   ├── RightToolPanel.vue       # 右侧 8 大创作工具面板
│   │   │   ├── ThreeLayerPanel.vue      # AI 三层面板（战略/战术/执行）
│   │   │   ├── OrchestrationPanel.vue   # 多步编排任务面板
│   │   │   ├── AiPanelHeader.vue        # AI 面板顶栏（含模型切换）
│   │   │   ├── OnboardingCard.vue       # 新手引导浮动卡片
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
│   │   │   ├── api.ts               # Axios HTTP 封装（JWT 自动附加）
│   │   │   └── textToHtml.ts        # 文本 → HTML 转换
│   │   ├── stores/                  # 5 个 Pinia Store
│   │   │   ├── agent.ts             # AI 代理 Store（核心状态+模型切换）
│   │   │   ├── ai.ts                # AI 通用 Store
│   │   │   ├── auth.ts              # 认证 Store
│   │   │   ├── book.ts              # 书籍 Store
│   │   │   └── document.ts          # 文档 Store
│   │   └── views/                   # 5 个页面视图
│   │       ├── AuthView.vue         # 登录注册页
│   │       ├── HomeView.vue         # 主页仪表板（含新手引导）
│   │       ├── BookEditorView.vue   # 主编辑器（TipTap + 行内润色 + 9步引导）
│   │       ├── StatsView.vue        # 写作统计仪表盘
│   │       └── LandingPromo.vue     # 产品宣传落地页
│   ├── package.json
│   ├── vite.config.ts               # Vite 配置（/api → 3001 代理）
│   ├── tailwind.config.js           # Tailwind 自定义设计令牌
│   └── tsconfig.json
│
└── picture/                         # 产品截图资源
```

---

## 常见问题

### Q: 启动报 `JWT_SECRET 未配置`
检查 `backend/.env` 是否存在且配置了 `JWT_SECRET`。重启后端。

### Q: AI 接口返回 502 或超时
1. 检查 `SILICONFLOW_API_KEY` 是否正确
2. 确认网络可访问 `api.siliconflow.cn`
3. 增大 `SILICONFLOW_TIMEOUT_MS`（建议生产 60000+）
4. 系统已内置指数退避重试（最多 3 次），临时性错误会自动恢复

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

### Q: 如何切换 AI 模型
在编辑器右侧 AI 面板顶部点击模型名称即可切换。选择会持久化到 localStorage。非白名单模型 ID 会自动回退到默认模型。

### Q: 如何重置新手引导
浏览器控制台执行：
```js
localStorage.removeItem('onboarding_home_done')
localStorage.removeItem('onboarding_editor_done')
```

### Q: GLM 模型全文分析返回原始 JSON 代码块
GLM 系列模型在全文分析时可能返回 fenced JSON 而非自然语言。系统已内置兼容处理：自动提取结构化 JSON 中的建议项，将响应体转换为可读摘要文本，确保前端展示正常。如仍遇到类似情况，切换到 DeepSeek V3.2 可获得最佳输出质量。

### Q: AI 辅助字段补全返回格式异常
部分模型可能返回本地化 key 或伪 JSON 格式。后端 `assist-content` 接口已做 key 归一化处理，兼容各模型输出差异。建议对角色字段补全结果逐字段确认后采纳，避免一键全量接受。

### Q: 普通自然语言聊天误触发自动操作
已修复：普通知识问答（如「主角动机是什么」「世界观优缺点」）现在只返回文字回答，不再自动触发创建角色/剧情线/创意计划等操作，`suggestedActions` 在纯对话模式下为空。

### Q: 创意计划执行后看不到新增内容
执行创意计划后，世界观、角色、剧情线、伏笔、章节会逐步批量创建。请在左侧数据面板刷新查看新增内容。如果部分资源创建失败，检查后端日志中是否有并发限流（AI_THROTTLE_LIMIT）触发。

---

## License

MIT
