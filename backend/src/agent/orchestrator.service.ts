import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import * as http from 'http';
import * as https from 'https';
import { PrismaService } from '../prisma.service';
import { PlannerService } from '../planner/planner.service';
import { CharacterService } from '../character/character.service';
import { RagService } from '../rag/rag.service';
import { ConsistencyService } from '../consistency/consistency.service';

/**
 * Agent 类型枚举
 */
export enum AgentType {
  PLANNER = 'PLANNER',
  CHARACTER = 'CHARACTER',
  WRITER = 'WRITER',
  CONSISTENCY = 'CONSISTENCY',
}

/**
 * Agent 请求接口
 */
export interface AgentRequest {
  bookId: string;
  chapterId?: string;
  content?: string;
  command?: string;
  cursorPos?: number; // 光标位置（用于 Fill-in-the-Middle）
  userInstructions?: string; // 用户附加指令
  candidateCount?: number; // 候选数量（默认3）
  context?: {
    selectedText?: string;
    mode?: 'continue' | 'improve' | 'expand' | 'summarize' | 'generate';
  };
}

/**
 * Agent 响应接口 - 增强版
 */
export interface AgentResponse {
  type: AgentType;
  result: string;
  candidates?: string[]; // 多候选文本
  diff?: {
    original: string;
    replacement: string;
  };
  suggestions?: string[];
  warnings?: string[];
  diagnostics?: Array<{
    // 一致性诊断
    type: string;
    severity: string;
    description: string;
    suggestion?: string;
  }>;
  suggestedChanges?: Array<{
    // 建议修改
    location: string;
    original: string;
    replacement: string;
    reason: string;
  }>;
  sessionId?: string; // Agent 会话 ID
  status: 'success' | 'failed';
  duration?: number; // 耗时(ms)
}

/**
 * 影响分析结果
 */
export interface ImpactAnalysis {
  affectedChapters: Array<{
    chapterId: string;
    title: string;
    order: number;
    impact: 'HIGH' | 'MEDIUM' | 'LOW';
    reason: string;
  }>;
  suggestedPriority: string[];
}

/**
 * 创意计划 - AI 返回的结构化创作方案
 */
export interface CreativePlan {
  title: string;
  genre: string;
  theme: string;
  tone: string;
  worldSetting: {
    background: string;
    powerSystem?: string;
    geography?: string;
    socialStructure?: string;
    rules?: string;
  };
  characters: Array<{
    name: string;
    role: string;
    personality: string;
    background: string;
    goal: string;
    strength?: string;
    weakness?: string;
  }>;
  plotLines: Array<{
    title: string;
    type: 'MAIN' | 'SUB' | 'HIDDEN';
    description: string;
    keyEvents: string[];
  }>;
  chapterOutlines: Array<{
    title: string;
    summary: string;
    keyScenes: string[];
    involvedCharacters: string[];
  }>;
  foreshadowings: Array<{
    title: string;
    content: string;
    plantChapter: number;
    resolveChapter?: number;
  }>;
}

/**
 * 创意计划执行结果
 */
export interface CreativePlanExecutionResult {
  worldSettingId?: string;
  characterIds: string[];
  plotLineIds: string[];
  foreshadowingIds: string[];
  chapterResults: Array<{
    chapterId: string;
    title: string;
    wordCount: number;
  }>;
}

/**
 * OrchestratorService - 增强版调度中枢
 *
 * 新增功能：
 * 1. Agent Session 日志记录
 * 2. 多候选文本生成
 * 3. 结构化 JSON 输出解析
 * 4. 大纲变更影响分析
 * 5. Fill-in-the-Middle (FIM) 续写
 * 6. 与 ConsistencyService 集成
 */
@Injectable()
export class OrchestratorService {
  private readonly logger = new Logger(OrchestratorService.name);
  private readonly apiKey: string;
  private readonly apiUrl = 'https://api.siliconflow.cn/v1/chat/completions';
  private readonly model = 'Pro/deepseek-ai/DeepSeek-V3.2';
  /** 轻量任务快速模型（一致性检查、思考阶段等），留空则复用主模型 */
  private readonly fastModel: string;
  /** loadContext 内存缓存 TTL（毫秒），0 表示禁用 */
  private readonly contextCacheTtlMs: number;

  /** HTTP keep-alive 连接池，避免每次请求重建 TCP 连接 */
  private readonly httpAgent = new http.Agent({ keepAlive: true, maxSockets: 20 });
  private readonly httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 20 });

  /** loadContext 内存缓存: bookId -> { data, expireAt } */
  private readonly contextCache = new Map<string, { data: any; expireAt: number }>();

  /** 用户可选的模型列表（id → 显示信息） */
  private readonly availableModels: Array<{
    id: string;
    label: string;
    description: string;
    speed: 'fast' | 'normal' | 'slow';
  }>;

  constructor(
    private prisma: PrismaService,
    private plannerService: PlannerService,
    private characterService: CharacterService,
    private ragService: RagService,
    private consistencyService: ConsistencyService,
    private configService: ConfigService,
  ) {
    this.apiKey = this.configService.get<string>('SILICONFLOW_API_KEY') ?? '';
    this.fastModel = this.configService.get<string>('SILICONFLOW_FAST_MODEL') || '';
    this.contextCacheTtlMs = this.configService.get<number>('CONTEXT_CACHE_TTL_MS') ?? 30000;

    // 构建可用模型列表
    this.availableModels = [
      { id: 'Pro/deepseek-ai/DeepSeek-V3.2', label: 'DeepSeek V3.2', description: '旗舰模型，质量最高', speed: 'normal' },
      { id: 'Pro/zhipuai/GLM-5', label: 'GLM-5', description: '智谱高质量模型', speed: 'normal' },
      { id: 'Pro/MiniMaxAI/MiniMax-M2.5', label: 'MiniMax M2.5', description: '快速响应，均衡质量', speed: 'fast' },
    ];
  }

  /** 返回用户可选的模型列表 */
  getAvailableModels() {
    return {
      models: this.availableModels,
      defaultModel: this.model,
    };
  }

  /** 解析用户指定的模型ID，若不在白名单则回退到默认模型 */
  private resolveModel(modelId?: string): string {
    if (!modelId) return this.model;
    const found = this.availableModels.find((m) => m.id === modelId);
    return found ? found.id : this.model;
  }

  /**
   * 处理用户请求的主入口
   */
  async process(request: AgentRequest): Promise<AgentResponse> {
    const startTime = Date.now();
    const { bookId, chapterId, content, command } = request;

    try {
      // 1. RAG 检索上下文
      const ragResults = await this.ragService.retrieve(bookId, content || '', {
        chapterId,
        limit: 15,
      });

      // 2. 加载结构化上下文
      const context = await this.loadContext(bookId, chapterId);

      // 3. 合并 RAG 结果到上下文
      context.ragContext = ragResults.map((r) => `[${r.type}] ${r.content}`).join('\n');

      // 4. 根据命令类型选择 Agent 流程
      let result: AgentResponse;
      switch (command) {
        case 'generate':
          result = await this.generateWithPlanning(request, context);
          break;
        case 'continue':
          result = await this.continueGeneration(request, context);
          break;
        case 'improve':
        case 'expand':
        case 'summarize':
          result = await this.generateWithAgents(request, context);
          break;
        default:
          result = await this.continueGeneration(request, context);
          break;
      }

      // 5. 记录 Agent Session
      const duration = Date.now() - startTime;
      result.duration = duration;

      const session = await this.logSession(
        bookId,
        chapterId,
        result.type,
        JSON.stringify({ command, content: content?.slice(0, 500) }),
        JSON.stringify({ result: result.result?.slice(0, 500), warnings: result.warnings }),
        'COMPLETED',
        duration,
      );
      result.sessionId = session.id;

      return result;
    } catch (error: any) {
      const duration = Date.now() - startTime;
      await this.logSession(
        bookId,
        chapterId,
        AgentType.WRITER,
        JSON.stringify({ command, error: error.message }),
        '',
        'FAILED',
        duration,
      );
      throw error;
    }
  }

  /**
   * POST /generate/continue 的核心实现
   * 支持光标位置和用户指令，返回多候选
   */
  async continueGeneration(request: AgentRequest, context: any): Promise<AgentResponse> {
    const { content, cursorPos, userInstructions, candidateCount = 3 } = request;

    // 构建 FIM (Fill-in-the-Middle) 上下文
    let prefix = content || '';
    let suffix = '';
    if (cursorPos !== undefined && content) {
      prefix = content.slice(0, cursorPos);
      suffix = content.slice(cursorPos);
    }

    const candidates: string[] = [];

    // 并行生成多个候选
    const generatePromises = Array.from({ length: candidateCount }, (_, i) =>
      this.callAgent(
        AgentType.WRITER,
        this.buildFIMPrompt(prefix, suffix, context, userInstructions),
        0.7 + i * 0.1, // 逐步提高温度以增加多样性
      ),
    );

    const results = await Promise.allSettled(generatePromises);
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value.result) {
        candidates.push(result.value.result);
      }
    }

    // 对第一个候选做一致性检查（使用快速模型）
    let diagnostics: any[] = [];
    let warnings: string[] = [];
    if (candidates.length > 0) {
      const consistencyResult = await this.callAgent(
        AgentType.CONSISTENCY,
        this.buildConsistencyPrompt(request.bookId, candidates[0], context),
        0.3,
        { useFastModel: true },
      );

      const parsed = this.parseConsistencyResult(consistencyResult.result);
      diagnostics = parsed.issues;
      warnings = parsed.issues
        .filter((i: any) => i.severity === 'ERROR' || i.severity === 'WARNING')
        .map((i: any) => i.description);
    }

    return {
      type: AgentType.WRITER,
      result: candidates[0] || '',
      candidates,
      diagnostics,
      warnings: warnings.length > 0 ? warnings : undefined,
      status: candidates.length > 0 ? 'success' : 'failed',
    };
  }

  /**
   * 大纲变更影响分析
   */
  async analyzeImpact(
    bookId: string,
    changes: {
      type: 'world_setting' | 'plot_line' | 'character' | 'foreshadowing';
      action: 'create' | 'update' | 'delete';
      data: any;
    },
  ): Promise<ImpactAnalysis> {
    // 获取所有章节
    const chapters = await this.prisma.chapter.findMany({
      where: { bookId },
      orderBy: { order: 'asc' },
      include: { chapterSummary: true },
    });

    const affectedChapters: ImpactAnalysis['affectedChapters'] = [];

    // 基于变更类型分析影响
    for (const chapter of chapters) {
      if (!chapter.content || chapter.content.length < 10) continue;

      let impact: 'HIGH' | 'MEDIUM' | 'LOW' | null = null;
      let reason = '';

      switch (changes.type) {
        case 'character': {
          const charName = changes.data.name;
          if (charName && chapter.content.includes(charName)) {
            impact = changes.action === 'delete' ? 'HIGH' : 'MEDIUM';
            reason = `章节中包含角色「${charName}」的描写`;
          }
          break;
        }
        case 'world_setting': {
          // 世界观变更影响所有章节
          impact = 'MEDIUM';
          reason = '世界观设定变更可能影响全文基调';
          break;
        }
        case 'plot_line': {
          const plotTitle = changes.data.title;
          if (plotTitle && chapter.chapterSummary?.summary?.includes(plotTitle)) {
            impact = 'HIGH';
            reason = `章节涉及剧情线「${plotTitle}」`;
          } else {
            impact = 'LOW';
            reason = '可能受到剧情线调整的间接影响';
          }
          break;
        }
        case 'foreshadowing': {
          const fsTitle = changes.data.title;
          if (fsTitle && chapter.content.includes(fsTitle)) {
            impact = 'HIGH';
            reason = `章节中提及伏笔「${fsTitle}」`;
          }
          break;
        }
      }

      if (impact) {
        affectedChapters.push({
          chapterId: chapter.id,
          title: chapter.title,
          order: chapter.order,
          impact,
          reason,
        });
      }
    }

    // 按影响度排序
    const priorityOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 };
    affectedChapters.sort((a, b) => priorityOrder[a.impact] - priorityOrder[b.impact]);

    return {
      affectedChapters,
      suggestedPriority: affectedChapters
        .filter((c) => c.impact === 'HIGH')
        .map((c) => c.chapterId),
    };
  }

  // ==================== 创意计划 ====================

  /**
   * 根据用户的自然语言描述生成结构化创意计划
   * 例如："我要写一本黑暗修仙小说，给出设定、大纲、角色、世界观和前三章"
   */
  async generateCreativePlan(
    bookId: string,
    userPrompt: string,
    chapterCount: number = 3,
  ): Promise<CreativePlan> {
    const startTime = Date.now();

    const prompt = this.buildCreativePlanPrompt(userPrompt, chapterCount);

    // 创意计划需要大量 token 来生成完整 JSON 结构（估算 ~3000 tokens)
    const planSystemPrompt = `你是一个资深的网络小说策划大师，擅长从简短的描述中构思出完整的小说企划。
你必须严格以纯JSON格式返回结果。
规则：不要添加任何 markdown 代码块标记、不要在JSON前后添加文字说明、直接以 { 开头以 } 结尾。
你的JSON必须完整、可解析，绝不能截断。`;

    const result = await this.callAgent(AgentType.PLANNER, prompt, 0.85, {
      maxTokens: 4096,
      timeoutMs: 300000,
      systemPrompt: planSystemPrompt,
    });

    if (result.status === 'failed' || !result.result) {
      this.logger.error('[CreativePlan] AI 调用失败，无法生成创意计划');
      throw new Error('AI 无法生成创意计划，请稍后重试');
    }

    this.logger.log(`[CreativePlan] 原始返回 ${result.result.length} 字符`);
    const plan = this.parseCreativePlan(result.result, chapterCount);

    await this.logSession(
      bookId,
      undefined,
      'CREATIVE_PLAN',
      JSON.stringify({ userPrompt, chapterCount }),
      JSON.stringify(plan),
      'COMPLETED',
      Date.now() - startTime,
    );

    return plan;
  }

  /**
   * 执行创意计划 - 批量创建世界观、角色、剧情线、伏笔，并生成章节内容
   */
  async executeCreativePlan(
    bookId: string,
    plan: CreativePlan,
    volumeId?: string,
  ): Promise<CreativePlanExecutionResult> {
    const startTime = Date.now();
    const result: CreativePlanExecutionResult = {
      characterIds: [],
      plotLineIds: [],
      foreshadowingIds: [],
      chapterResults: [],
    };

    try {
      // 1. 创建世界观设定
      const ws = await this.plannerService.createWorldSetting(bookId, {
        genre: plan.genre,
        theme: `${plan.theme}\n${plan.worldSetting.background}`,
        tone: plan.tone,
      });
      result.worldSettingId = ws.id;
      this.logger.log(`[CreativePlan] 世界观已创建: ${ws.id}`);

      // 2. 创建角色
      for (const charDef of plan.characters) {
        try {
          const char = await this.prisma.character.create({
            data: {
              bookId,
              name: charDef.name,
              role: charDef.role,
              bio: `${charDef.personality}\n背景: ${charDef.background}\n目标: ${charDef.goal}`,
            },
          });
          // 创建角色档案
          await this.characterService.upsertCharacterProfile(char.id, {
            personality: charDef.personality,
            background: charDef.background,
            currentGoal: charDef.goal,
            strength: charDef.strength || '',
            weakness: charDef.weakness || '',
          });
          result.characterIds.push(char.id);
          this.logger.log(`[CreativePlan] 角色已创建: ${charDef.name}`);
        } catch (err: any) {
          this.logger.warn(`[CreativePlan] 角色创建失败 ${charDef.name}: ${err.message}`);
        }
      }

      // 3. 创建剧情线
      for (let i = 0; i < plan.plotLines.length; i++) {
        try {
          const pl = await this.plannerService.createPlotLine(bookId, {
            title: plan.plotLines[i].title,
            description:
              plan.plotLines[i].description +
              '\n关键事件: ' +
              plan.plotLines[i].keyEvents.join(', '),
            type: plan.plotLines[i].type as any,
          });
          result.plotLineIds.push(pl.id);
          this.logger.log(`[CreativePlan] 剧情线已创建: ${plan.plotLines[i].title}`);
        } catch (err: any) {
          this.logger.warn(`[CreativePlan] 剧情线创建失败: ${err.message}`);
        }
      }

      // 4. 创建伏笔
      for (const fs of plan.foreshadowings) {
        try {
          const created = await this.plannerService.createForeshadowing(bookId, {
            title: fs.title,
            content: fs.content,
          });
          result.foreshadowingIds.push(created.id);
          this.logger.log(`[CreativePlan] 伏笔已创建: ${fs.title}`);
        } catch (err: any) {
          this.logger.warn(`[CreativePlan] 伏笔创建失败: ${err.message}`);
        }
      }

      // 5. 获取或创建章节并生成内容
      const existingChapters = await this.prisma.chapter.findMany({
        where: { bookId },
        orderBy: { order: 'asc' },
      });
      const nextOrder =
        existingChapters.length > 0 ? Math.max(...existingChapters.map((c) => c.order)) + 1 : 1;

      // 新资源已创建 → 刷新上下文缓存
      this.invalidateContextCache(bookId);
      const context = await this.loadContext(bookId);

      for (let i = 0; i < plan.chapterOutlines.length; i++) {
        const outline = plan.chapterOutlines[i];
        try {
          // 创建章节
          const chapter = await this.prisma.chapter.create({
            data: {
              bookId,
              volumeId: volumeId || null,
              title: outline.title,
              content: '',
              order: nextOrder + i,
              status: 'DRAFT',
            },
          });

          // 生成章节内容（每章需要 2000-3000 字，需要足够的 token）
          const chapterPrompt = this.buildChapterFromPlanPrompt(plan, outline, i, context);
          const genResult = await this.callAgent(AgentType.WRITER, chapterPrompt, 0.75, {
            maxTokens: 4000,
            timeoutMs: 120000,
          });

          if (genResult.result) {
            await this.prisma.chapter.update({
              where: { id: chapter.id },
              data: { content: genResult.result },
            });
          }

          result.chapterResults.push({
            chapterId: chapter.id,
            title: outline.title,
            wordCount: (genResult.result || '').length,
          });
          this.logger.log(
            `[CreativePlan] 章节已生成: ${outline.title} (${(genResult.result || '').length}字)`,
          );

          // 更新 context 用于后续章节（保持前情连贯）
          context.chapterSummary =
            (context.chapterSummary || '') + `\n第${i + 1}章 ${outline.title}: ${outline.summary}`;
        } catch (err: any) {
          this.logger.warn(`[CreativePlan] 章节生成失败 ${outline.title}: ${err.message}`);
        }
      }

      await this.logSession(
        bookId,
        undefined,
        'CREATIVE_PLAN_EXEC',
        JSON.stringify({ plan: plan.title }),
        JSON.stringify(result),
        'COMPLETED',
        Date.now() - startTime,
      );

      return result;
    } catch (error: any) {
      await this.logSession(
        bookId,
        undefined,
        'CREATIVE_PLAN_EXEC',
        JSON.stringify({ plan: plan.title }),
        JSON.stringify({ error: error.message }),
        'FAILED',
        Date.now() - startTime,
      );
      throw error;
    }
  }

  /**
   * 流式 AI 对话 — 实时推送回复 token
   * 支持传入当前章节 ID 和内容，让 AI 了解用户正在编辑的上下文
   */
  async streamChat(
    bookId: string,
    message: string,
    chatHistory: Array<{ role: string; content: string }>,
    onChunk: (chunk: string) => void,
    chapterId?: string,
    currentContent?: string,
    modelId?: string,
  ): Promise<{ reply: string; suggestedActions?: any[] }> {
    const context = await this.loadContext(bookId, chapterId);

    // == 构建章节列表概要 ==
    const allChapters = await this.prisma.chapter.findMany({
      where: { bookId },
      orderBy: { order: 'asc' },
      select: { id: true, title: true, order: true, wordCount: true, status: true },
    });
    const chaptersOverview = allChapters.length
      ? allChapters
          .map(
            (c: any) =>
              `${c.order}. ${c.title} (${c.wordCount}字${c.id === chapterId ? ' ← 当前编辑' : ''})`,
          )
          .join('\n')
      : '尚无章节';

    // == 构建角色（含详细信息） ==
    const characterDetails =
      (context.characters || [])
        .map((c: any) => {
          const profile = c.profile;
          const parts = [`「${c.name}」(${c.role || 'supporting'})`];
          if (profile?.personality) parts.push(`性格: ${profile.personality}`);
          if (profile?.currentGoal) parts.push(`目标: ${profile.currentGoal}`);
          return parts.join(' | ');
        })
        .join('\n') || '尚无角色';

    // == 当前编辑内容摘要 ==
    const contentSnippet = currentContent
      ? currentContent.length > 800
        ? `...${currentContent.slice(-800)}`
        : currentContent
      : '';

    const currentChapter = chapterId ? allChapters.find((c: any) => c.id === chapterId) : null;

    // == 世界观详情 ==
    const worldDetail =
      (context.worldSettings || [])
        .map((ws: any) => {
          const parts: string[] = [];
          if (ws.genre) parts.push(`类型: ${ws.genre}`);
          if (ws.theme) parts.push(`主题: ${ws.theme}`);
          if (ws.tone) parts.push(`基调: ${ws.tone}`);
          if (ws.timePeriod) parts.push(`时代: ${ws.timePeriod}`);
          if (ws.location) parts.push(`地点: ${ws.location}`);
          return parts.join(' | ');
        })
        .join('; ') || '未设定';

    // == 伏笔详情 ==
    const foreshadowingDetail =
      (context.foreshadowings || [])
        .map((f: any) => `「${f.title}」: ${(f.content || '').slice(0, 60)}`)
        .join('\n') || '无';

    // == 剧情线详情 ==
    const plotlineDetail =
      (context.plotLines || [])
        .map((pl: any) => `[${pl.type}]「${pl.title}」: ${(pl.description || '').slice(0, 80)}`)
        .join('\n') || '无';

    const systemPrompt = `你是一个专业的AI小说创作助手。你不仅提供分析和建议，更要**主动执行操作**帮助用户完成创作。

══════ 当前书籍全貌 ══════
📚 世界观: ${worldDetail}
👥 角色 (${(context.characters || []).length}):
${characterDetails}
📖 剧情线 (${(context.plotLines || []).length}):
${plotlineDetail}
🔮 伏笔 (${(context.foreshadowings || []).length}):
${foreshadowingDetail}

📋 章节列表 (${allChapters.length}章):
${chaptersOverview}
${context.chapterSummary ? `\n📝 当前章节摘要: ${context.chapterSummary}` : ''}
${currentChapter ? `\n✏️ 用户正在编辑: 第${currentChapter.order}章「${currentChapter.title}」(${currentChapter.wordCount}字)` : ''}
${contentSnippet ? `\n--- 编辑器末尾内容 ---\n${contentSnippet}\n---` : ''}

══════ 行为规则 ══════
1. **智能路由**：根据用户意图选择最合适的操作。判断标准：
   - 提到"写小说/创作计划/大纲/设定/世界观+角色/开始写/前N章" → creative_plan
   - 提到"续写/继续写/接着写/往下写" → 先用1-2句话描述你计划续写的剧情走向(格式: "接下来续写的内容为：XXX")，再添加 agent_command(continue)
   - 提到"改进/润色/分段/优化" → agent_command(improve)
   - 提到"扩写/详细/展开/丰富" → agent_command(expand)
   - 提到"改写/重写/修改" → agent_command(edit)
   - 提到设计/创建角色 → create_character
   - 提到剧情线/故事线 → create_plotline
   - 提到伏笔/暗示/线索 → create_foreshadowing
   - 提到"分析全文/通读全书/检查伏笔/角色弧线/节奏分析/找问题" → analyze_text
   - 纯粹提问/讨论 → 不添加ACTIONS，仅回复文字

2. **回复格式**：
   - **续写请求**：必须先说明续写方向，格式为「接下来续写的内容为：（简要描述续写情节走向，1-3句话概括）」，然后添加ACTIONS
   - **其他请求**：正文简短（2-4句），说明你判断了什么意图、将执行什么。不需要展开细节。
3. 必须在回复末尾添加 <!--ACTIONS:[...]-->，否则操作不会执行。
4. 可用ACTIONS类型：

A) 创作计划（创建完整设定/大纲，或创作多个新章节）：
<!--ACTIONS:[{"type":"creative_plan","label":"描述","data":{"prompt":"用户请求完整描述","chapterCount":数字}}]-->

B) 对当前章节内容操作（续写/改进/扩写/改写/润色等需要打开章节）：
<!--ACTIONS:[{"type":"agent_command","label":"描述","data":{"command":"continue或improve或expand或edit"}}]-->

C) 创建角色：
<!--ACTIONS:[{"type":"create_character","label":"创建角色: XXX","data":{"name":"角色名","role":"protagonist/antagonist/supporting","personality":"性格描述","background":"背景","goal":"目标","strength":"优势","weakness":"弱点"}}]-->

D) 创建剧情线：
<!--ACTIONS:[{"type":"create_plotline","label":"创建剧情线: XXX","data":{"title":"剧情线标题","type":"MAIN或SUB或HIDDEN","description":"详细描述"}}]-->

E) 创建伏笔：
<!--ACTIONS:[{"type":"create_foreshadowing","label":"植入伏笔: XXX","data":{"title":"伏笔标题","content":"伏笔内容描述"}}]-->

F) 全文分析（读取全部章节内容，分析伏笔/角色/节奏等，给出建议）：
<!--ACTIONS:[{"type":"analyze_text","label":"分析描述","data":{"analysisType":"foreshadowing或character_arc或pacing或comprehensive"}}]-->
analysisType 说明: foreshadowing=伏笔分析, character_arc=角色弧线, pacing=节奏分析, comprehensive=全面分析

G) 多个操作可以组合为一个数组。

5. label字段写具体描述，不要写"执行操作"。
6. creative_plan 的 data.prompt 需包含用户完整意图描述。
7. 如果用户的请求需要当前章节内容但未打开任何章节，先提醒用户打开章节。`;

    const messages = [
      { role: 'system', content: systemPrompt },
      ...chatHistory.slice(-10),
      { role: 'user', content: message },
    ];

    try {
      const fullReply = await this.streamCallAgent(
        AgentType.WRITER,
        message,
        0.8,
        { maxTokens: 2000, timeoutMs: 120000, systemPrompt, modelOverride: modelId },
        onChunk,
      );

      let reply = fullReply;
      let suggestedActions: any[] | undefined;
      const actionsMatch = fullReply.match(/<!--ACTIONS:([\s\S]*?)-->/);
      if (actionsMatch) {
        reply = fullReply.replace(/<!--ACTIONS:[\s\S]*?-->/, '').trim();
        try {
          suggestedActions = JSON.parse(actionsMatch[1]);
        } catch {}
      }

      return { reply, suggestedActions };
    } catch (error: any) {
      this.logger.error(`StreamChat 调用失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 深度思考流式对话 — 先输出"思考过程"（thinking），再输出最终回复（reply）
   * SSE 事件类型：thinking_token / token / done / error
   */
  async streamDeepThinkChat(
    bookId: string,
    message: string,
    chatHistory: Array<{ role: string; content: string }>,
    onEvent: (event: { type: string; data: any }) => void,
    chapterId?: string,
    currentContent?: string,
    contextScope?: 'chapter' | 'fullBook' | 'custom',
    modelId?: string,
  ): Promise<{ thinking: string; reply: string; suggestedActions?: any[] }> {
    const context = await this.loadContext(bookId, chapterId);

    // 构建上下文信息
    const allChapters = await this.prisma.chapter.findMany({
      where: { bookId },
      orderBy: { order: 'asc' },
      select: { id: true, title: true, order: true, wordCount: true, status: true },
    });
    const chaptersOverview = allChapters.length
      ? allChapters
          .map(
            (c: any) =>
              `${c.order}. ${c.title} (${c.wordCount}字${c.id === chapterId ? ' ← 当前编辑' : ''})`,
          )
          .join('\n')
      : '尚无章节';

    const characterDetails =
      (context.characters || [])
        .map((c: any) => {
          const profile = c.profile;
          const parts = [`「${c.name}」(${c.role || 'supporting'})`];
          if (profile?.personality) parts.push(`性格: ${profile.personality}`);
          if (profile?.currentGoal) parts.push(`目标: ${profile.currentGoal}`);
          return parts.join(' | ');
        })
        .join('\n') || '尚无角色';

    const contentSnippet = currentContent
      ? currentContent.length > 1200
        ? `...${currentContent.slice(-1200)}`
        : currentContent
      : '';

    const currentChapter = chapterId ? allChapters.find((c: any) => c.id === chapterId) : null;

    const worldDetail =
      (context.worldSettings || [])
        .map((ws: any) => {
          const parts: string[] = [];
          if (ws.genre) parts.push(`类型: ${ws.genre}`);
          if (ws.theme) parts.push(`主题: ${ws.theme}`);
          if (ws.tone) parts.push(`基调: ${ws.tone}`);
          return parts.join(' | ');
        })
        .join('; ') || '未设定';

    const plotlineDetail =
      (context.plotLines || [])
        .map((pl: any) => `[${pl.type}]「${pl.title}」: ${(pl.description || '').slice(0, 80)}`)
        .join('\n') || '无';

    const foreshadowingDetail =
      (context.foreshadowings || [])
        .map((f: any) => `「${f.title}」: ${(f.content || '').slice(0, 60)}`)
        .join('\n') || '无';

    // === Phase 1: 深度思考（分析用户意图、梳理上下文）— 使用快速模型 ===
    onEvent({ type: 'thinking_start', data: {} });

    const thinkingSystemPrompt = `你是一个专业的小说创作分析师。你的任务是分析用户的创作请求并输出详细的思考过程。

══════ 当前书籍全貌 ══════
📚 世界观: ${worldDetail}
👥 角色 (${(context.characters || []).length}): ${characterDetails}
📖 剧情线: ${plotlineDetail}
🔮 伏笔: ${foreshadowingDetail}
📋 章节: ${chaptersOverview}
${currentChapter ? `✏️ 当前章节: 第${currentChapter.order}章「${currentChapter.title}」` : ''}
${contentSnippet ? `--- 编辑器内容 ---\n${contentSnippet}\n---` : ''}

请按以下结构输出思考过程：
1. 用户意图分析：用户想要什么？
2. 上下文关联：哪些已有设定/角色/剧情线与此相关？
3. 潜在风险：是否有设定冲突、角色不一致、逻辑漏洞？
4. 最佳策略：推荐的执行方案及理由

要求：简洁、结构化，不超过300字。`;

    let thinkingText = '';
    try {
      thinkingText = await this.streamCallAgent(
        AgentType.WRITER,
        `分析以下用户请求:\n「${message}」`,
        0.4,
        { maxTokens: 600, timeoutMs: 30000, systemPrompt: thinkingSystemPrompt, useFastModel: true },
        (chunk) => {
          onEvent({ type: 'thinking_token', data: { text: chunk } });
        },
      );
    } catch (err: any) {
      this.logger.warn(`深度思考阶段失败: ${err.message}，跳过思考直接回复`);
      thinkingText = '(思考过程不可用)';
    }
    onEvent({ type: 'thinking_done', data: { thinking: thinkingText } });

    // === Phase 2: 正式回复（基于思考结果） ===
    onEvent({ type: 'reply_start', data: {} });

    const replySystemPrompt = `你是一个专业的AI小说创作助手。你不仅提供分析和建议，更要**主动执行操作**帮助用户完成创作。

══════ 当前书籍全貌 ══════
📚 世界观: ${worldDetail}
👥 角色 (${(context.characters || []).length}):
${characterDetails}
📖 剧情线 (${(context.plotLines || []).length}):
${plotlineDetail}
🔮 伏笔 (${(context.foreshadowings || []).length}):
${foreshadowingDetail}
📋 章节列表 (${allChapters.length}章):
${chaptersOverview}
${currentChapter ? `✏️ 用户正在编辑: 第${currentChapter.order}章「${currentChapter.title}」(${currentChapter.wordCount}字)` : ''}
${contentSnippet ? `--- 编辑器末尾内容 ---\n${contentSnippet}\n---` : ''}

══════ 深度思考结果 ══════
${thinkingText}

══════ 行为规则 ══════
1. **智能路由**：根据用户意图及深度思考分析选择最合适的操作。判断标准：
   - 提到"写小说/创作计划/大纲/设定/世界观+角色/开始写/前N章" → creative_plan
   - 提到"续写/继续写/接着写/往下写" → 先描述续写走向，再 agent_command(continue)
   - 提到"改进/润色/分段/优化" → agent_command(improve)
   - 提到"扩写/详细/展开/丰富" → agent_command(expand)
   - 提到"改写/重写/修改" → agent_command(edit)
   - 提到设计/创建角色 → create_character
   - 提到剧情线/故事线 → create_plotline
   - 提到伏笔/暗示/线索 → create_foreshadowing
   - 提到"分析全文/通读全书/检查伏笔/角色弧线/节奏分析/找问题" → analyze_text
   - 纯粹提问/讨论 → 不添加ACTIONS，仅回复文字
2. **回复格式**：正文简短，利用深度思考结果给出更精准的建议。
3. 必须在回复末尾添加 <!--ACTIONS:[...]-->，否则操作不会执行。
4. 可用ACTIONS类型：
A) creative_plan: {"type":"creative_plan","label":"描述","data":{"prompt":"完整描述","chapterCount":数字}}
B) agent_command: {"type":"agent_command","label":"描述","data":{"command":"continue|improve|expand|edit"}}
C) create_character: {"type":"create_character","label":"创建角色: XXX","data":{...}}
D) create_plotline: {"type":"create_plotline","label":"创建剧情线: XXX","data":{...}}
E) create_foreshadowing: {"type":"create_foreshadowing","label":"植入伏笔: XXX","data":{...}}
F) analyze_text: {"type":"analyze_text","label":"分析描述","data":{"analysisType":"..."}}`;

    let fullReply = '';
    try {
      fullReply = await this.streamCallAgent(
        AgentType.WRITER,
        message,
        0.8,
        { maxTokens: 2000, timeoutMs: 120000, systemPrompt: replySystemPrompt, modelOverride: modelId },
        (chunk) => {
          onEvent({ type: 'token', data: { text: chunk } });
        },
      );
    } catch (err: any) {
      this.logger.error(`深度思考回复阶段失败: ${err.message}`);
      throw err;
    }

    let reply = fullReply;
    let suggestedActions: any[] | undefined;
    const actionsMatch = fullReply.match(/<!--ACTIONS:([\s\S]*?)-->/);
    if (actionsMatch) {
      reply = fullReply.replace(/<!--ACTIONS:[\s\S]*?-->/, '').trim();
      try {
        suggestedActions = JSON.parse(actionsMatch[1]);
      } catch {}
    }

    return { thinking: thinkingText, reply, suggestedActions };
  }

  /**
   * 内联润色 — 逐条流式返回修改建议，前端可逐一审阅 accept/reject
   * 每条建议作为独立 SSE 事件发出，用户无需等待全部分析完成
   */
  async streamInlinePolish(
    bookId: string,
    content: string,
    onEvent: (event: { type: string; data: any }) => void,
    chapterId?: string,
    chapterTitle?: string,
  ): Promise<void> {
    const context = await this.loadContext(bookId, chapterId);
    const characterNames = (context.characters || []).map((c: any) => c.name).join('、') || '无';
    const chapterInfo = chapterTitle ? `章节「${chapterTitle}」` : '当前章节';

    const systemPrompt = `你是一名专业的中文文学编辑。你的任务是逐一找出文本中可以改进的地方，每处修改用固定格式输出。

重要规则：
1. FIND 字段必须是原文中的「精确子串」——从原文中原样复制，不得添加、删减或修改任何字符（包括标点）
2. 每处修改应该是独立的、局部的，通常 5-60 个字。不要把整段作为一处修改
3. REPLACE 字段是你建议的修改版本，可以与原文长度不同
4. 修改类型包括：错别字、标点遗漏、语序不当、用词不当、修辞改进、节奏优化、叙述增强
5. 按在原文中出现的先后顺序输出
6. 每条修改之间只用空行分隔，不要输出多余的总结或解释文字
7. 如果原文已经很好，可以只输出少量建议甚至不输出

作品信息：角色 ${characterNames}，${chapterInfo}

输出格式（严格遵守，每条一个块）：
<<<FIND>>>
需要修改的原文精确片段
<<<REPLACE>>>
修改后的文本
<<<REASON>>>
简短修改原因`;

    const userPrompt = `请对以下内容逐条给出润色建议：

${content}`;

    let buffer = '';
    let suggestionIndex = 0;

    const parseBlock = (block: string): { original: string; replacement: string; reason: string } | null => {
      const findStart = block.indexOf('<<<FIND>>>');
      const replaceStart = block.indexOf('<<<REPLACE>>>');
      const reasonStart = block.indexOf('<<<REASON>>>');
      if (findStart === -1 || replaceStart === -1 || reasonStart === -1) return null;
      if (!(findStart < replaceStart && replaceStart < reasonStart)) return null;

      const original = block.slice(findStart + 10, replaceStart).trim();
      const replacement = block.slice(replaceStart + 13, reasonStart).trim();
      const reasonRaw = block.slice(reasonStart + 12).trim();
      const reason =
        reasonRaw
          .split('\n')
          .map((line) => line.trim())
          .find((line) => line.length > 0 && !line.includes('<<<')) || '表达优化';

      if (!original || !replacement) return null;
      // 防御性过滤：若模型把标签串进字段，直接丢弃，避免污染正文
      if (original.includes('<<<') || replacement.includes('<<<') || reason.includes('<<<')) return null;

      return { original, replacement, reason };
    };

    try {
      await this.streamCallAgent(
        AgentType.WRITER,
        userPrompt,
        0.3,
        {
          maxTokens: 3000,
          timeoutMs: 120000,
          systemPrompt,
        },
        (chunk: string) => {
          buffer += chunk;
          // 仅在“当前块已经遇到下一个 FIND”时解析，避免半截 REASON 被误解析
          while (true) {
            const findStart = buffer.indexOf('<<<FIND>>>');
            if (findStart === -1) {
              // 清理无效前缀，避免 buffer 无限制增长
              if (buffer.length > 4096) buffer = buffer.slice(-1024);
              break;
            }

            const nextFind = buffer.indexOf('<<<FIND>>>', findStart + 10);
            if (nextFind === -1) {
              // 保留从当前 FIND 开始的未完成块，等待更多流数据
              if (findStart > 0) buffer = buffer.slice(findStart);
              break;
            }

            const block = buffer.slice(findStart, nextFind);
            const parsed = parseBlock(block);
            if (parsed) {
              onEvent({
                type: 'suggestion',
                data: {
                  index: suggestionIndex++,
                  original: parsed.original,
                  replacement: parsed.replacement,
                  reason: parsed.reason,
                },
              });
            }

            // 消费到下一个块起点
            buffer = buffer.slice(nextFind);
          }
        },
      );

      // 最终冲刷——解析 buffer 中残留的最后一个完整块
      if (buffer.includes('<<<FIND>>>')) {
        const findStart = buffer.indexOf('<<<FIND>>>');
        const tail = findStart >= 0 ? buffer.slice(findStart) : '';
        const parsed = parseBlock(tail);
        if (parsed) {
          onEvent({
            type: 'suggestion',
            data: {
              index: suggestionIndex++,
              original: parsed.original,
              replacement: parsed.replacement,
              reason: parsed.reason,
            },
          });
        }
      }
    } catch (err: any) {
      this.logger.error(`内联润色失败: ${err.message}`);
      throw err;
    }
  }

  /**
   * 工具分析 - 校对/拼字/灵感/妙笔 流式端点
   */
  async streamToolAnalysis(
    bookId: string,
    tool: 'proofread' | 'spelling' | 'inspiration' | 'writing',
    content: string,
    onEvent: (event: { type: string; data: any }) => void,
    chapterId?: string,
    chapterTitle?: string,
  ): Promise<string> {
    const context = await this.loadContext(bookId, chapterId);

    const characterNames = (context.characters || []).map((c: any) => c.name).join('、') || '无';
    const worldInfo =
      (context.worldSettings || [])
        .map((ws: any) => {
          const parts: string[] = [];
          if (ws.genre) parts.push(ws.genre);
          if (ws.tone) parts.push(ws.tone);
          return parts.join('/');
        })
        .join('; ') || '未设定';

    const chapterInfo = chapterTitle ? `章节「${chapterTitle}」` : '当前章节';
    const contentPreview =
      content.length > 6000
        ? content.slice(0, 3000) + '\n\n...(中间省略)...\n\n' + content.slice(-3000)
        : content;

    const toolPrompts: Record<string, string> = {
      proofread: `你是一名专业的中文文学编辑。请对以下小说内容进行全面校对，找出所有问题。

══════ 作品信息 ══════
世界观: ${worldInfo}
角色: ${characterNames}
${chapterInfo}

══════ 待校对内容 ══════
${contentPreview}
══════════════════════

请按以下类别逐项列出问题，每条用 Markdown 列表格式：

**语法和标点问题**
- **问题描述**: 详细说明 → 建议修改为「...」

**逻辑一致性问题**
- **问题描述**: 详细说明

**叙事节奏问题**
- **问题描述**: 优化建议

**角色行为一致性**
- **问题描述**: 详细说明

最后给出总体评价（1-2句话）和总分（满分100分）。
如果没有问题，也请明确说明"未发现显著问题"。`,

      spelling: `你是一名中文文字校正专家。请仔细检查以下小说文本中的错别字、用词不当和拼写问题。

══════ 作品信息 ══════
风格: ${worldInfo}
角色名: ${characterNames}
${chapterInfo}

══════ 待检查内容 ══════
${contentPreview}
══════════════════════

请严格按照以下格式列出所有拼写和用词问题：

- [错误] **"原文错误"** → 应为「正确写法」（位于第X段，原因：...）
- [疑似] **"疑似错误"** → 建议改为「推荐写法」（位于第X段，原因：...）

注意检查：
1. 同音字/形近字混淆
2. 成语用法是否正确
3. 角色名是否前后一致
4. 量词使用是否恰当
5. 标点符号是否规范

最后给出错误统计：确定错误 X 处，疑似问题 X 处。`,

      inspiration: `你是一个充满创意的小说创作灵感生成器。基于当前的故事背景和已有内容，为作者提供丰富的灵感建议。

══════ 作品背景 ══════
世界观: ${worldInfo}
角色: ${characterNames}
${chapterInfo}

══════ 当前内容（最后部分） ══════
${content.length > 2000 ? content.slice(-2000) : content}
══════════════════════

请从以下维度提供创意灵感（每项 2-3 条）：

**情节走向建议**
- **建议标题**: 具体描述这个情节走向如何发展...

**角色发展空间**
- **角色名 - 发展方向**: 具体描述...

**世界观扩展点**
- **扩展标题**: 可以在世界观中加入什么新元素...

**精彩场景构思**
- **场景标题**: 描述一个可以写得很精彩的场景...

**伏笔与悬念**
- **伏笔标题**: 可以在这里埋下什么伏笔...

请确保建议具体、可操作、与当前故事契合。`,

      writing: `你是一名资深文学润色师。请对以下内容进行精准的文笔提升，给出**局部修改建议**。

⚠️ 核心原则：
- 你不是重写者，你是润色顾问。绝不要重写或缩减原文
- 只在原文基础上做局部微调，保留全部内容和结构
- 每个建议必须明确标注原文位置和修改前后对比

══════ 作品信息 ══════
风格: ${worldInfo}
角色: ${characterNames}
${chapterInfo}

══════ 待分析内容 ══════
${contentPreview}
══════════════════════

请按以下结构输出（不要输出完整润色版本，只给逐条建议）：

**整体文笔评价**
简要评价当前文笔水平和风格特点（2-3句）。

**逐条润色建议**（选取 5-8 个可优化之处）

每条建议格式：
1. **第X段 / "原文关键句摘录"**
   - 原文：「摘录需修改的原句」
   - 建议改为：「润色后的句子」
   - 改进点：说明为什么这样改更好

**修辞增强建议**
- 指出 2-3 处可加入比喻、排比、通感等修辞手法的位置

**总结**
一句话概括主要提升方向。`,
    };

    const systemPrompt = toolPrompts[tool] || toolPrompts.proofread;

    let fullResult = '';
    try {
      fullResult = await this.streamCallAgent(
        AgentType.WRITER,
        `请对${chapterInfo}的内容进行${tool === 'proofread' ? '校对分析' : tool === 'spelling' ? '拼写检查' : tool === 'inspiration' ? '灵感生成' : '文笔润色'}。`,
        tool === 'inspiration' ? 0.9 : 0.3,
        {
          maxTokens: tool === 'inspiration' ? 2000 : 2500,
          timeoutMs: 120000,
          systemPrompt,
        },
        (chunk) => {
          onEvent({ type: 'token', data: { text: chunk } });
        },
      );
    } catch (err: any) {
      this.logger.error(`工具分析失败 [${tool}]: ${err.message}`);
      throw err;
    }

    return fullResult;
  }

  /**
   * AI 对话接口 - 自然语言交互，返回文本回复 + 可选动作建议
   */
  async chat(
    bookId: string,
    message: string,
    chatHistory: Array<{ role: string; content: string }> = [],
  ): Promise<{
    reply: string;
    suggestedActions?: Array<{ type: string; label: string; data: any }>;
  }> {
    const context = await this.loadContext(bookId);

    const systemPrompt = `你是一个专业的AI小说创作助手。你可以帮助用户进行小说创作的各个方面。
当前书籍的上下文信息：
- 世界观: ${(context.worldSettings || []).map((ws: any) => `${ws.genre || ''}/${ws.theme || ''}/${ws.tone || ''}`).join(', ') || '未设定'}
- 角色数量: ${(context.characters || []).length}
- 剧情线数量: ${(context.plotLines || []).length}
- 伏笔数量: ${(context.foreshadowings || []).length}

角色列表: ${(context.characters || []).map((c: any) => c.name).join(', ') || '无'}
剧情线: ${(context.plotLines || []).map((pl: any) => `[${pl.type}]${pl.title}`).join(', ') || '无'}

你的回复应当直接、专业、有建设性。如果用户的请求涉及创作计划（如创建设定、大纲、角色等），请在回复末尾添加一个JSON标记：
<!--ACTIONS:[{"type":"creative_plan","label":"生成创作计划","data":{"prompt":"用户原始请求"}}]-->
如果用户要求续写、改进等操作，添加：
<!--ACTIONS:[{"type":"agent_command","label":"执行操作","data":{"command":"continue/improve/expand/summarize"}}]-->
如果不需要特殊操作，不添加标记。`;

    const messages = [
      { role: 'system', content: systemPrompt },
      ...chatHistory.slice(-10),
      { role: 'user', content: message },
    ];

    try {
      const response = await axios.post(
        this.apiUrl,
        {
          model: this.model,
          messages,
          temperature: 0.8,
          max_tokens: 2000,
        },
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 120000,
          httpAgent: this.httpAgent,
          httpsAgent: this.httpsAgent,
        },
      );

      const fullReply = response.data.choices[0].message.content;

      // 解析 actions 标记
      let reply = fullReply;
      let suggestedActions: any[] | undefined;

      const actionsMatch = fullReply.match(/<!--ACTIONS:([\s\S]*?)-->/);
      if (actionsMatch) {
        reply = fullReply.replace(/<!--ACTIONS:[\s\S]*?-->/, '').trim();
        try {
          suggestedActions = JSON.parse(actionsMatch[1]);
        } catch {}
      }

      return { reply, suggestedActions };
    } catch (error: any) {
      this.logger.error(`Chat 调用失败`, error.message);
      return { reply: '抱歉，AI 暂时无法响应，请稍后重试。' };
    }
  }

  // ==================== 带规划的完整流程 ====================

  private async generateWithPlanning(request: AgentRequest, context: any): Promise<AgentResponse> {
    const { bookId, chapterId, content } = request;

    // 1. Planner Agent
    const planningResult = await this.callAgent(
      AgentType.PLANNER,
      this.buildPlannerPrompt(bookId, content, context),
    );

    // 2. Writer Agent（多候选 — 并行生成）
    const candidateCount = request.candidateCount || 3;
    const generatePromises = Array.from({ length: candidateCount }, (_, i) =>
      this.callAgent(
        AgentType.WRITER,
        this.buildWriterPrompt(bookId, content, planningResult.result, context, 'generate'),
        0.7 + i * 0.1,
      ),
    );
    const settled = await Promise.allSettled(generatePromises);
    const candidates: string[] = [];
    for (const r of settled) {
      if (r.status === 'fulfilled' && r.value.result) candidates.push(r.value.result);
    }

    // 3. Consistency Agent（使用快速模型）
    let diagnostics: any[] = [];
    let warnings: string[] = [];
    if (candidates.length > 0) {
      const consistencyResult = await this.callAgent(
        AgentType.CONSISTENCY,
        this.buildConsistencyPrompt(bookId, candidates[0], context),
        0.3,
        { useFastModel: true },
      );
      const parsed = this.parseConsistencyResult(consistencyResult.result);
      diagnostics = parsed.issues;
      warnings = parsed.issues
        .filter((i: any) => i.severity !== 'INFO')
        .map((i: any) => i.description);
    }

    return {
      type: AgentType.WRITER,
      result: candidates[0] || '',
      candidates,
      diagnostics,
      warnings: warnings.length > 0 ? warnings : undefined,
      suggestions: [planningResult.result?.slice(0, 200)],
      status: candidates.length > 0 ? 'success' : 'failed',
    };
  }

  // ==================== 简化流程 ====================

  private async generateWithAgents(request: AgentRequest, context: any): Promise<AgentResponse> {
    const { bookId, content, command } = request;

    const writerPrompt = this.buildWriterPrompt(bookId, content, '', context, command);
    const result = await this.callAgent(AgentType.WRITER, writerPrompt);

    const consistencyPrompt = this.buildConsistencyPrompt(bookId, result.result, context);
    const consistencyResult = await this.callAgent(AgentType.CONSISTENCY, consistencyPrompt, 0.3, {
      useFastModel: true,
    });

    const parsed = this.parseConsistencyResult(consistencyResult.result);

    return {
      type: AgentType.WRITER,
      result: result.result,
      diagnostics: parsed.issues,
      warnings: parsed.issues
        .filter((i: any) => i.severity !== 'INFO')
        .map((i: any) => i.description),
      status: result.status,
    };
  }

  // ==================== 全文分析 ====================

  /**
   * 流式全文分析 — 读取全书内容，分析伏笔/角色弧线/节奏等，给出具体建议
   * SSE 推送 token + 最终结构化建议
   */
  async streamAnalyzeFullText(
    bookId: string,
    analysisType: 'foreshadowing' | 'character_arc' | 'pacing' | 'comprehensive',
    onChunk: (chunk: string) => void,
  ): Promise<{ analysis: string; suggestions: any[] }> {
    // 1. 加载所有章节内容
    const chapters = await this.prisma.chapter.findMany({
      where: { bookId },
      orderBy: { order: 'asc' },
      select: { id: true, title: true, content: true, order: true, wordCount: true },
    });

    if (chapters.length === 0) {
      return { analysis: '暂无章节内容可分析。请先创建或导入章节。', suggestions: [] };
    }

    // 2. 加载已有的伏笔、角色、剧情线
    const context = await this.loadContext(bookId);

    // 3. 构建全文（限制 token，取每章前 2000 字）
    const fullText = chapters
      .map((ch: any) => {
        const excerpt =
          ch.content && ch.content.length > 2000
            ? ch.content.slice(0, 2000) + '...(已省略)'
            : ch.content || '(空章节)';
        return `=== 第${ch.order}章「${ch.title}」(${ch.wordCount}字) ===\n${excerpt}`;
      })
      .join('\n\n');

    // 4. 构建已有伏笔信息
    const existingForeshadowings =
      (context.foreshadowings || [])
        .map((f: any) => `[${f.status}] 「${f.title}」: ${f.content}`)
        .join('\n') || '尚无伏笔';

    // 5. 角色列表
    const characterList =
      (context.characters || [])
        .map((c: any) => {
          const p = c.profile;
          const parts = [`「${c.name}」(${c.role || 'supporting'})`];
          if (p?.personality) parts.push(`性格: ${p.personality}`);
          if (p?.currentGoal) parts.push(`目标: ${p.currentGoal}`);
          if (p?.arc) parts.push(`弧线: ${p.arc}`);
          return parts.join(' | ');
        })
        .join('\n') || '无角色';

    // 6. 剧情线
    const plotlineList =
      (context.plotLines || [])
        .map((pl: any) => `[${pl.type}]「${pl.title}」: ${(pl.description || '').slice(0, 100)}`)
        .join('\n') || '无剧情线';

    // 7. 根据分析类型构建特化的 system prompt
    const analysisPrompts: Record<string, string> = {
      foreshadowing: `你是一个专业的小说伏笔分析师。请仔细阅读全文，分析以下内容：

1. **已有伏笔检查**: 检查已记录的伏笔是否在文中有对应的铺垫，是否需要加强
2. **新伏笔建议**: 找出适合植入伏笔的位置（具体到第几章、哪段内容附近），说明什么类型的伏笔适合在此处植入
3. **伏笔回收建议**: 如果前文有暗示但后文未呼应的地方，建议在哪里回收
4. **伏笔网络**: 分析各伏笔之间是否能形成关联网络，增强故事深度

对每个建议，请给出：
- **位置**: 第几章、哪段内容附近
- **类型**: 角色伏笔/剧情伏笔/世界观伏笔/情感伏笔
- **内容**: 具体建议内容
- **优先级**: 高/中/低

最后请以 JSON 格式输出建议列表：
\`\`\`json
[{"chapter": 数字, "location": "位置描述", "type": "类型", "title": "伏笔标题", "content": "建议内容", "priority": "高/中/低"}]
\`\`\``,

      character_arc: `你是一个专业的角色弧线分析师。请阅读全文并分析每个角色的成长轨迹：

1. **弧线完整性**: 每个角色是否有明确的起点→转折→成长？
2. **动机一致性**: 角色行为是否与其动机/目标一致？有无矛盾之处？
3. **关系发展**: 角色间的关系是否有合理的发展和变化？
4. **建议**: 在哪些章节可以加强角色的内心戏、关键抉择或情感转折？

最后以 JSON 输出：
\`\`\`json
[{"character": "角色名", "chapter": 数字, "issue": "问题描述", "suggestion": "改进建议", "priority": "高/中/低"}]
\`\`\``,

      pacing: `你是一个专业的小说节奏分析师。请阅读全文，分析故事节奏：

1. **张力曲线**: 各章节的紧张程度变化，哪里可能过于平淡或过于紧凑
2. **信息密度**: 哪些章节信息过载或过于空洞
3. **转折点**: 关键转折是否安排得当
4. **建议**: 哪里需要加速/减速/增加冲突/增加喘息

最后以 JSON 输出：
\`\`\`json
[{"chapter": 数字, "issue": "节奏问题", "suggestion": "调整建议", "priority": "高/中/低"}]
\`\`\``,

      comprehensive: `你是一个全方位的小说顾问编辑。请阅读全文，从以下维度进行分析：

1. **伏笔**: 适合植入或回收伏笔的位置
2. **角色**: 角色弧线中需要加强的节点
3. **节奏**: 节奏过快/过慢的段落
4. **剧情**: 剧情逻辑的漏洞或可强化的地方
5. **文笔**: 可以提升的描写细节

对每条建议标明类别和优先级。最后以 JSON 输出：
\`\`\`json
[{"category": "foreshadowing/character/pacing/plot/style", "chapter": 数字, "title": "建议标题", "content": "详细建议", "priority": "高/中/低"}]
\`\`\``,
    };

    const systemPrompt = analysisPrompts[analysisType] || analysisPrompts.comprehensive;

    const userPrompt = `══════ 书籍全文 ══════
${fullText}

══════ 已有伏笔 ══════
${existingForeshadowings}

══════ 角色信息 ══════
${characterList}

══════ 剧情线 ══════
${plotlineList}

══════ 共 ${chapters.length} 章，约 ${chapters.reduce((sum: number, ch: any) => sum + (ch.wordCount || 0), 0)} 字 ══════

请基于以上全文内容进行专业分析，给出具体、可操作的建议。`;

    try {
      const fullReply = await this.streamCallAgent(
        AgentType.CONSISTENCY,
        userPrompt,
        0.5,
        { maxTokens: 4096, timeoutMs: 300000, systemPrompt },
        onChunk,
      );

      // 尝试从回复中提取 JSON 建议列表
      let suggestions: any[] = [];
      const jsonMatch = fullReply.match(/```json\s*([\s\S]*?)```/);
      if (jsonMatch) {
        try {
          suggestions = JSON.parse(jsonMatch[1].trim());
        } catch {
          this.logger.warn('[analyzeFullText] 无法解析建议 JSON');
        }
      }

      return { analysis: fullReply.replace(/```json[\s\S]*?```/, '').trim(), suggestions };
    } catch (error: any) {
      this.logger.error(`全文分析失败: ${error.message}`);
      throw error;
    }
  }

  // ==================== 加载上下文 ====================

  /**
   * AI 辅助编辑——非流式调用，返回 JSON 形式的字段建议
   */
  async assistContent(
    bookId: string,
    type: 'character' | 'world_setting' | 'outline',
    currentData: Record<string, any>,
  ): Promise<Record<string, string>> {
    const context = await this.loadContext(bookId);
    const bookChars =
      (context.characters || [])
        .map((c: any) => {
          const p = c.profile;
          return p ? `${c.name}(${p.role || '未设定'})` : c.name;
        })
        .join('、') || '无';
    const bookPlots =
      (context.plotLines || [])
        .map(
          (p: any) =>
            `[${p.type}] ${p.title}${p.description ? ': ' + p.description.slice(0, 60) : ''}`,
        )
        .join('\n') || '无';
    const ws0 = context.worldSettings[0] as any;
    const genre = ws0?.genre || '未设定';
    const theme = ws0?.theme || '';
    const tone = ws0?.tone || '';
    const foreshadowings =
      (context.foreshadowings || []).map((f: any) => f.title).join('、') || '无';

    let systemPrompt = '';
    let userPrompt = '';

    if (type === 'character') {
      const fieldMap: Record<string, string> = {
        name: '角色姓名',
        role: '角色定位(主角/配角/反派/龙套)',
        personality: '性格特征(至少3个维度)',
        background: '背景故事(100-200字)',
        motivation: '核心动机(驱动行动的根本原因)',
        fear: '内心恐惧(最深层的恐惧或心理阴影)',
        strength: '能力优势(独特技能或性格优势)',
        weakness: '致命弱点(影响决策的性格/能力缺陷)',
        currentGoal: '当前目标(本阶段追求)',
        longTermGoal: '终极目标(贯穿全书的追求)',
        arc: '角色弧光(成长变化轨迹)',
        appearance: '外貌特征(辨识度高的2-3个特征)',
        catchphrase: '口头禅(体现性格的标志性台词)',
      };
      const fields = Object.keys(fieldMap);
      const existing = fields
        .map((f) => `- ${fieldMap[f]}(${f}): ${currentData[f] || '(空)'}`)
        .join('\n');
      const emptyFields = fields.filter((f) => !currentData[f] || currentData[f] === '');

      systemPrompt = `你是资深小说角色设计师，擅长创建立体、有深度的虚构人物。

【作品背景】
- 题材: ${genre}${theme ? '，主题: ' + theme : ''}${tone ? '，风格: ' + tone : ''}
- 已有角色: ${bookChars}
- 剧情线:\n${bookPlots}
- 伏笔: ${foreshadowings}

【输出约束】
1. 返回纯 JSON 对象（不要 markdown 代码块、不要注释）
2. key 必须是上述英文字段名，value 是中文建议内容
3. 优先补全空字段：${emptyFields.join(', ') || '无空字段'}
4. 对已有内容只在明显可以改进时才返回（更生动、更具体、更有戏剧张力）
5. 新角色需确保与已有角色形成差异化（互补或对立）
6. 性格描述避免脸谱化，需有内在矛盾（如"表面冷漠实则重情"）
7. 背景故事需与核心动机逻辑自洽
8. 所有文本使用中文`;

      userPrompt = `当前角色数据：
${existing}

请根据作品背景和已有角色关系网，为这个角色提供高质量的补全和优化建议。直接返回 JSON。`;
    } else if (type === 'world_setting') {
      const fieldMap: Record<string, string> = {
        genre: '题材类型',
        theme: '主题思想(作品的核心表达)',
        tone: '叙事风格/基调',
        targetWordCount: '目标总字数',
        powerSystem: '力量体系(修炼/科技/魔法体系的层级与规则)',
        geography: '地理环境(世界地图、重要地点及其特色)',
        society: '社会结构(政治体制、阶层划分、主要势力)',
        history: '历史背景(影响当前剧情的重大历史事件)',
        rules: '特殊规则(世界独有的物理法则/禁忌/契约)',
      };
      const existing = Object.keys(fieldMap)
        .map((k) => `- ${fieldMap[k]}(${k}): ${currentData[k] || '(空)'}`)
        .join('\n');
      const emptyFields = Object.keys(fieldMap).filter(
        (k) => !currentData[k] || currentData[k] === '' || currentData[k] === 0,
      );

      systemPrompt = `你是资深小说世界观架构师，擅长构建自洽、有深度的虚构世界。

【已有信息】
- 角色: ${bookChars}
- 剧情线:\n${bookPlots}
- 伏笔: ${foreshadowings}

【输出约束】
1. 返回纯 JSON 对象（不要 markdown 代码块、不要注释）
2. key 必须是上述英文字段名，value 是中文建议内容（targetWordCount 返回数字字符串）
3. 优先补全空字段：${emptyFields.join(', ') || '无空字段'}
4. 世界观元素需内在逻辑自洽（力量体系影响社会结构，地理影响势力分布等）
5. 力量体系需有清晰层级（至少3-5个等级），避免过于简单
6. 地理描述需包含2-3个有故事潜力的标志性地点
7. 社会结构需自然产生有利于冲突的矛盾点
8. 历史背景需铺设可被剧情利用的历史遗留问题
9. 所有文本使用中文，描述具体且有想象空间`;

      userPrompt = `当前世界观设定：
${existing}

请根据已有角色和剧情线，构建一个自洽且充满故事可能性的世界观。直接返回 JSON。`;
    } else {
      // outline type
      const existing = Object.entries(currentData)
        .map(([k, v]) => `- ${k}: ${v || '(空)'}`)
        .join('\n');

      systemPrompt = `你是资深小说大纲设计师，擅长构建引人入胜的故事结构。

【作品背景】
- 题材: ${genre}${theme ? '，主题: ' + theme : ''}${tone ? '，风格: ' + tone : ''}
- 角色: ${bookChars}
- 剧情线:\n${bookPlots}
- 伏笔: ${foreshadowings}

【输出约束】
1. 返回纯 JSON 对象（不要 markdown 代码块、不要注释）
2. key 为字段名，value 为建议内容
3. 只返回需要补全或改进的字段
4. 大纲需符合三幕/四幕叙事结构，有明确的起承转合
5. 每个阶段的内容概要需具体（出现哪些角色、发生什么事件、解决什么问题）
6. 确保剧情线和伏笔在大纲中得到合理编排
7. 所有文本使用中文`;

      userPrompt = `当前大纲数据：
${existing}

请补全并优化上述大纲，确保故事结构完整、节奏合理。直接返回 JSON。`;
    }

    const agentResp = await this.callAgent(AgentType.WRITER, userPrompt, 0.7, {
      maxTokens: 3000,
      timeoutMs: 60000,
      systemPrompt,
    });

    if (!agentResp.result) return {};

    // 提取 JSON
    try {
      const cleaned = agentResp.result
        .replace(/```(?:json)?\s*/g, '')
        .replace(/```/g, '')
        .trim();
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (jsonMatch) return JSON.parse(jsonMatch[0]);
    } catch (e) {
      this.logger.warn('[assistContent] JSON 解析失败: ' + (e as Error).message);
    }
    return {};
  }

  /**
   * AI 建议角色关系——分析已有角色，给出缺失关系的建议
   */
  async suggestRelationships(bookId: string): Promise<
    Array<{
      fromName: string;
      toName: string;
      type: string;
      description: string;
      status: string;
    }>
  > {
    const context = await this.loadContext(bookId);
    const chars = (context.characters || []) as any[];
    if (chars.length < 2) return [];

    // 构建角色摘要
    const charSummaries = chars
      .map((c: any) => {
        const p = c.profile || {};
        return `- ${c.name}(${p.role || '未设定'}): 性格=${p.personality || '未设定'}, 动机=${p.motivation || '未设定'}, 目标=${p.currentGoal || '未设定'}`;
      })
      .join('\n');

    // 构建已有关系
    const existingRels = await this.prisma.characterRelationship.findMany({
      where: { bookId },
      include: { fromChar: true, toChar: true },
    });
    const existingRelStr =
      existingRels.length > 0
        ? existingRels
            .map((r: any) => `- ${r.fromChar.name} → ${r.type} → ${r.toChar.name} (${r.status})`)
            .join('\n')
        : '无';

    const ws0 = context.worldSettings[0] as any;
    const genre = ws0?.genre || '未设定';
    const plots =
      (context.plotLines || []).map((p: any) => `[${p.type}] ${p.title}`).join('、') || '无';

    const systemPrompt = `你是资深小说角色关系设计师，擅长构建复杂而有张力的人物关系网。

【作品背景】
- 题材: ${genre}
- 剧情线: ${plots}

【已有角色】
${charSummaries}

【已有关系】
${existingRelStr}

【输出约束】
1. 返回 JSON 数组，每个元素是一个关系建议对象
2. 每个对象的格式: {"fromName": "角色A名", "toName": "角色B名", "type": "关系类型", "description": "关系描述(30-60字)", "status": "POSITIVE|NEGATIVE|NEUTRAL|COMPLEX"}
3. type 常用值: 朋友、恋人、敌人、师生、亲人、同伴、上下级、对手、盟友、宿敌
4. 不要重复已有关系，只建议缺失但对故事有推动力的关系
5. 关系应服务于剧情冲突和角色成长：
   - 主角需要至少一个对手/宿敌制造压力
   - 配角应与主角有情感纽带（知己/恋人/师长）
   - 反派与主角的关系应复杂（不只是单纯敌对）
6. description 要点明这段关系对剧情的潜在推动作用
7. 建议 3-6 条关系，不要过多
8. 不要包含 markdown 代码块标记`;

    const userPrompt = `请分析上述角色，推荐缺失但对故事发展至关重要的角色关系。直接返回 JSON 数组。`;

    const agentResp = await this.callAgent(AgentType.WRITER, userPrompt, 0.8, {
      maxTokens: 2000,
      timeoutMs: 60000,
      systemPrompt,
    });

    if (!agentResp.result) return [];

    try {
      const cleaned = agentResp.result
        .replace(/```(?:json)?\s*/g, '')
        .replace(/```/g, '')
        .trim();
      const arrMatch = cleaned.match(/\[[\s\S]*\]/);
      if (arrMatch) {
        const arr = JSON.parse(arrMatch[0]);
        return Array.isArray(arr) ? arr : [];
      }
    } catch (e) {
      this.logger.warn('[suggestRelationships] JSON 解析失败: ' + (e as Error).message);
    }
    return [];
  }

  private async loadContext(bookId: string, chapterId?: string) {
    // 内存缓存：bookId 级别（不含 chapterId，章节摘要单独查）
    const cacheKey = bookId;
    let base: { worldSettings: any; plotLines: any; characters: any; foreshadowings: any };

    const cached = this.contextCache.get(cacheKey);
    if (this.contextCacheTtlMs > 0 && cached && cached.expireAt > Date.now()) {
      base = cached.data;
    } else {
      const [worldSettings, plotLines, characters, foreshadowings] = await Promise.all([
        this.prisma.worldSetting.findMany({ where: { bookId } }),
        this.prisma.plotLine.findMany({ where: { bookId }, orderBy: { order: 'asc' } }),
        this.prisma.character.findMany({
          where: { bookId },
          include: {
            profile: true,
            fromRels: { include: { toChar: true } },
            toRels: { include: { fromChar: true } },
          },
        }),
        this.prisma.foreshadowing.findMany({ where: { bookId, status: 'PENDING' } }),
      ]);
      base = { worldSettings, plotLines, characters, foreshadowings };

      if (this.contextCacheTtlMs > 0) {
        this.contextCache.set(cacheKey, {
          data: base,
          expireAt: Date.now() + this.contextCacheTtlMs,
        });
      }
    }

    let chapterSummary = '';
    if (chapterId) {
      const summary = await this.prisma.chapterSummary.findUnique({ where: { chapterId } });
      chapterSummary = summary?.summary || '';
    }

    return { ...base, chapterSummary, ragContext: '' };
  }

  /** 手动使指定书籍的上下文缓存失效（创建/更新资源后调用） */
  invalidateContextCache(bookId: string) {
    this.contextCache.delete(bookId);
  }

  // ==================== Agent 调用 ====================

  private async callAgent(
    type: AgentType,
    prompt: string,
    temperature?: number,
    options?: { maxTokens?: number; timeoutMs?: number; systemPrompt?: string; useFastModel?: boolean; modelOverride?: string },
  ): Promise<AgentResponse> {
    const maxTokens = options?.maxTokens ?? 2000;
    const timeoutMs = options?.timeoutMs ?? 120000;
    const useFast = options?.useFastModel && this.fastModel;
    const selectedModel = options?.modelOverride
      ? this.resolveModel(options.modelOverride)
      : useFast
        ? this.fastModel
        : this.model;

    this.logger.log(
      `[callAgent] ${type} | model=${selectedModel} | maxTokens=${maxTokens} | timeout=${timeoutMs}ms | prompt=${prompt.length}chars`,
    );

    // 最多重试 2 次（共 3 次尝试），仅对瞬态错误重试
    const MAX_RETRIES = 2;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const startTime = Date.now();
        const response = await axios.post(
          this.apiUrl,
          {
            model: selectedModel,
            messages: [
              { role: 'system', content: options?.systemPrompt ?? this.getSystemPrompt(type) },
              { role: 'user', content: prompt },
            ],
            temperature: temperature ?? this.getTemperature(type),
            max_tokens: maxTokens,
          },
          {
            headers: {
              Authorization: `Bearer ${this.apiKey}`,
              'Content-Type': 'application/json',
            },
            timeout: timeoutMs,
            httpAgent: this.httpAgent,
            httpsAgent: this.httpsAgent,
          },
        );

        const result = response.data.choices[0].message.content;
        const finishReason = response.data.choices[0].finish_reason;

        if (finishReason === 'length') {
          this.logger.warn(
            `[callAgent] ${type} 输出被截断 (finish_reason=length)，当前 max_tokens=${maxTokens}`,
          );
        }

        this.logger.log(
          `[callAgent] ${type} 完成 | ${result?.length || 0}chars | ${Date.now() - startTime}ms`,
        );

        return {
          type,
          result,
          status: 'success',
          duration: Date.now() - startTime,
        };
      } catch (error: any) {
        const status = error.response?.status;
        const isRetryable = !status || status === 429 || status >= 500;

        if (isRetryable && attempt < MAX_RETRIES) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 4000);
          this.logger.warn(
            `[callAgent] ${type} 第${attempt + 1}次失败 (status=${status || 'timeout'})，${delay}ms 后重试`,
          );
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }

        this.logger.error(`Agent ${type} 调用失败: ${error.message}`);
        if (error.response?.data) {
          this.logger.error(`API 错误详情: ${JSON.stringify(error.response.data).slice(0, 500)}`);
        }
        return {
          type,
          result: '',
          status: 'failed',
        };
      }
    }

    // 不可达，但 TS 需要
    return { type, result: '', status: 'failed' };
  }

  /**
   * 流式调用 Agent — 通过 SiliconFlow stream API 逐 token 返回
   * 每收到一个 chunk 回调 onChunk(text)，结束后返回完整结果
   */
  async streamCallAgent(
    type: AgentType,
    prompt: string,
    temperature: number,
    options: { maxTokens?: number; timeoutMs?: number; systemPrompt?: string; useFastModel?: boolean; modelOverride?: string },
    onChunk: (chunk: string) => void,
  ): Promise<string> {
    const maxTokens = options.maxTokens ?? 2000;
    const timeoutMs = options.timeoutMs ?? 120000;
    const useFast = options.useFastModel && this.fastModel;
    const selectedModel = options.modelOverride
      ? this.resolveModel(options.modelOverride)
      : useFast
        ? this.fastModel
        : this.model;

    this.logger.log(`[streamCallAgent] ${type} | model=${selectedModel} | maxTokens=${maxTokens} | timeout=${timeoutMs}ms`);

    const response = await axios.post(
      this.apiUrl,
      {
        model: selectedModel,
        messages: [
          { role: 'system', content: options.systemPrompt ?? this.getSystemPrompt(type) },
          { role: 'user', content: prompt },
        ],
        temperature,
        max_tokens: maxTokens,
        stream: true,
      },
      {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: timeoutMs,
        responseType: 'stream',
        httpAgent: this.httpAgent,
        httpsAgent: this.httpsAgent,
      },
    );

    return new Promise((resolve, reject) => {
      let fullText = '';
      const stream = response.data;

      stream.on('data', (buf: Buffer) => {
        const lines = buf
          .toString()
          .split('\n')
          .filter((l: string) => l.trim().startsWith('data:'));
        for (const line of lines) {
          const json = line.replace(/^data:\s*/, '').trim();
          if (json === '[DONE]') continue;
          try {
            const parsed = JSON.parse(json);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              fullText += delta;
              onChunk(delta);
            }
          } catch {
            /* 忽略解析错误 */
          }
        }
      });

      stream.on('end', () => {
        this.logger.log(`[streamCallAgent] ${type} 流式完成 | ${fullText.length}chars`);
        resolve(fullText);
      });

      stream.on('error', (err: Error) => {
        this.logger.error(`[streamCallAgent] ${type} 流式错误: ${err.message}`);
        reject(err);
      });
    });
  }

  /**
   * 流式生成创意计划 — 边生成边推送 token 给前端，最终返回完整 plan
   */
  async streamCreativePlan(
    bookId: string,
    userPrompt: string,
    chapterCount: number,
    onEvent: (event: { type: string; data: any }) => void,
  ): Promise<any> {
    const prompt = this.buildCreativePlanPrompt(userPrompt, chapterCount);
    const planSystemPrompt = `你是一个资深的网络小说策划大师，擅长从简短的描述中构思出完整的小说企划。
你必须严格以纯JSON格式返回结果。
规则：不要添加任何 markdown 代码块标记、不要在JSON前后添加文字说明、直接以 { 开头以 } 结尾。
你的JSON必须完整、可解析，绝不能截断。`;

    onEvent({ type: 'status', data: { step: '正在构思创作计划...' } });

    try {
      const rawText = await this.streamCallAgent(
        AgentType.PLANNER,
        prompt,
        0.85,
        { maxTokens: 4096, timeoutMs: 300000, systemPrompt: planSystemPrompt },
        (chunk) => onEvent({ type: 'token', data: { text: chunk } }),
      );

      onEvent({ type: 'status', data: { step: '正在解析计划...' } });
      const plan = this.parseCreativePlan(rawText, chapterCount);

      await this.logSession(
        bookId,
        undefined,
        'CREATIVE_PLAN',
        JSON.stringify({ userPrompt, chapterCount }),
        JSON.stringify(plan),
        'COMPLETED',
        0,
      );

      onEvent({ type: 'plan', data: plan });
      return plan;
    } catch (err: any) {
      onEvent({ type: 'error', data: { message: err.message } });
      throw err;
    }
  }

  /**
   * 流式执行创意计划 — 每完成一步推送进度事件，章节内容逐 token 推送
   */
  async streamExecuteCreativePlan(
    bookId: string,
    plan: any,
    volumeId: string | undefined,
    onEvent: (event: { type: string; data: any }) => void,
  ): Promise<any> {
    const result: any = {
      characterIds: [],
      plotLineIds: [],
      foreshadowingIds: [],
      chapterResults: [],
    };
    const totalSteps =
      1 +
      plan.characters.length +
      plan.plotLines.length +
      plan.foreshadowings.length +
      plan.chapterOutlines.length;

    // 1. 世界观
    onEvent({ type: 'progress', data: { step: '创建世界观', current: 0, total: totalSteps } });
    const ws = await this.plannerService.createWorldSetting(bookId, {
      genre: plan.genre,
      theme: `${plan.theme}\n${plan.worldSetting.background}`,
      tone: plan.tone,
    });
    result.worldSettingId = ws.id;
    onEvent({ type: 'progress', data: { step: '世界观已创建', current: 1, total: totalSteps } });

    // 2. 角色
    for (let i = 0; i < plan.characters.length; i++) {
      const charDef = plan.characters[i];
      onEvent({
        type: 'progress',
        data: { step: `创建角色: ${charDef.name}`, current: 1 + i, total: totalSteps },
      });
      try {
        const char = await this.prisma.character.create({
          data: {
            bookId,
            name: charDef.name,
            role: charDef.role,
            bio: `${charDef.personality}\n背景: ${charDef.background}\n目标: ${charDef.goal}`,
          },
        });
        await this.characterService.upsertCharacterProfile(char.id, {
          personality: charDef.personality,
          background: charDef.background,
          currentGoal: charDef.goal,
          strength: charDef.strength || '',
          weakness: charDef.weakness || '',
        });
        result.characterIds.push(char.id);
      } catch (err: any) {
        this.logger.warn(`角色创建失败 ${charDef.name}: ${err.message}`);
      }
    }

    // 3. 剧情线
    const charsDone = plan.characters.length;
    for (let i = 0; i < plan.plotLines.length; i++) {
      onEvent({
        type: 'progress',
        data: {
          step: `创建剧情线: ${plan.plotLines[i].title}`,
          current: 1 + charsDone + i,
          total: totalSteps,
        },
      });
      try {
        const pl = await this.plannerService.createPlotLine(bookId, {
          title: plan.plotLines[i].title,
          description:
            plan.plotLines[i].description + '\n关键事件: ' + plan.plotLines[i].keyEvents.join(', '),
          type: plan.plotLines[i].type as any,
        });
        result.plotLineIds.push(pl.id);
      } catch (err: any) {
        this.logger.warn(`剧情线创建失败: ${err.message}`);
      }
    }

    // 4. 伏笔
    const plotsDone = charsDone + plan.plotLines.length;
    for (let i = 0; i < plan.foreshadowings.length; i++) {
      onEvent({
        type: 'progress',
        data: {
          step: `创建伏笔: ${plan.foreshadowings[i].title}`,
          current: 1 + plotsDone + i,
          total: totalSteps,
        },
      });
      try {
        const created = await this.plannerService.createForeshadowing(bookId, {
          title: plan.foreshadowings[i].title,
          content: plan.foreshadowings[i].content,
        });
        result.foreshadowingIds.push(created.id);
      } catch (err: any) {
        this.logger.warn(`伏笔创建失败: ${err.message}`);
      }
    }

    // 5. 章节（流式逐 token 推送）
    const fsDone = plotsDone + plan.foreshadowings.length;
    const existingChapters = await this.prisma.chapter.findMany({
      where: { bookId },
      orderBy: { order: 'asc' },
    });
    const nextOrder =
      existingChapters.length > 0 ? Math.max(...existingChapters.map((c) => c.order)) + 1 : 1;
    const context = await this.loadContext(bookId);

    for (let i = 0; i < plan.chapterOutlines.length; i++) {
      const outline = plan.chapterOutlines[i];
      onEvent({
        type: 'progress',
        data: { step: `生成章节: ${outline.title}`, current: 1 + fsDone + i, total: totalSteps },
      });

      try {
        const chapter = await this.prisma.chapter.create({
          data: {
            bookId,
            volumeId: volumeId || null,
            title: outline.title,
            content: '',
            order: nextOrder + i,
            status: 'DRAFT',
          },
        });

        const chapterPrompt = this.buildChapterFromPlanPrompt(plan, outline, i, context);
        const chapterText = await this.streamCallAgent(
          AgentType.WRITER,
          chapterPrompt,
          0.75,
          { maxTokens: 4000, timeoutMs: 120000 },
          (chunk) =>
            onEvent({
              type: 'chapter_token',
              data: { chapterIndex: i, title: outline.title, text: chunk },
            }),
        );

        await this.prisma.chapter.update({
          where: { id: chapter.id },
          data: { content: chapterText },
        });

        result.chapterResults.push({
          chapterId: chapter.id,
          title: outline.title,
          wordCount: chapterText.length,
        });
        onEvent({
          type: 'chapter_done',
          data: { chapterIndex: i, title: outline.title, wordCount: chapterText.length },
        });

        context.chapterSummary =
          (context.chapterSummary || '') + `\n第${i + 1}章 ${outline.title}: ${outline.summary}`;
      } catch (err: any) {
        this.logger.warn(`章节生成失败 ${outline.title}: ${err.message}`);
        onEvent({
          type: 'chapter_error',
          data: { chapterIndex: i, title: outline.title, error: err.message },
        });
      }
    }

    onEvent({ type: 'done', data: result });
    return result;
  }

  // ==================== Session 日志 ====================

  private async logSession(
    bookId: string,
    chapterId: string | undefined,
    agentType: AgentType | string,
    input: string,
    output: string,
    status: string,
    duration: number,
  ) {
    return this.prisma.agentSession.create({
      data: {
        bookId,
        chapterId,
        agentType: String(agentType),
        input: input.slice(0, 5000),
        output: output.slice(0, 5000),
        status,
        duration,
      },
    });
  }

  // ==================== Agent Sessions 查询 ====================

  async getSessions(bookId: string, limit = 20) {
    return this.prisma.agentSession.findMany({
      where: { bookId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  // ==================== Prompt 构建 ====================

  private buildFIMPrompt(
    prefix: string,
    suffix: string,
    context: any,
    userInstructions?: string,
  ): string {
    const { characters, foreshadowings, chapterSummary, ragContext } = context;

    let prompt = `# 任务：续写小说\n\n`;

    if (ragContext) {
      prompt += `## 相关上下文\n${ragContext}\n\n`;
    }

    prompt += `## 角色状态\n`;
    (characters || []).slice(0, 5).forEach((c: any) => {
      const profile = c.profile || {};
      prompt += `- ${c.name}: ${profile.currentGoal || '无当前目标'} (性格: ${profile.personality || '未设定'})\n`;
    });

    prompt += `\n## 待处理伏笔\n`;
    (foreshadowings || []).slice(0, 3).forEach((f: any) => {
      prompt += `- ${f.title}: ${f.content}\n`;
    });

    if (chapterSummary) {
      prompt += `\n## 前情摘要\n${chapterSummary}\n`;
    }

    prompt += `\n## 已有内容\n${prefix.slice(-2000)}\n`;

    if (suffix) {
      prompt += `\n## 后续内容\n${suffix.slice(0, 500)}\n`;
      prompt += `\n请在已有内容和后续内容之间插入合理的过渡段落。`;
    } else {
      prompt += `\n请续写以上内容。`;
    }

    if (userInstructions) {
      prompt += `\n\n## 用户要求\n${userInstructions}`;
    }

    prompt += `\n\n## 写作规范\n1. **必须合理分段**：每个自然段200-400字，段落之间用空行（两个换行符）分隔\n2. 对话和叙述交替，避免大段独白\n3. 适当穿插环境描写、心理活动、动作描写\n4. 保持文风一致，角色行为符合设定，情节衔接自然\n5. 直接输出小说正文，不要添加任何标记、注释、章节标题或"续写如下"等元描述\n6. 段落之间必须有空行，确保可读性\n7. 每段聚焦一个场景片段或情绪节点，避免一段内跳跃过多内容`;
    return prompt;
  }

  private buildPlannerPrompt(bookId: string, content: string | undefined, context: any): string {
    const { worldSettings, plotLines, characters } = context;

    let prompt = `# 任务：章节规划\n\n`;
    prompt += `## 世界观设定\n`;
    (worldSettings || []).forEach((ws: any) => {
      prompt += `- 题材: ${ws.genre || '未设定'}, 主题: ${ws.theme || '未设定'}, 风格: ${ws.tone || '未设定'}\n`;
    });

    prompt += `\n## 剧情线\n`;
    (plotLines || []).forEach((pl: any) => {
      prompt += `- [${pl.type}] ${pl.title}: ${pl.description || ''}\n`;
    });

    prompt += `\n## 角色\n`;
    (characters || []).forEach((c: any) => {
      prompt += `- ${c.name} (${c.role || '未设定'})\n`;
    });

    if (content) {
      prompt += `\n## 当前内容\n${content.slice(-2000)}\n`;
    }

    prompt += `\n请根据以上上下文，提供章节规划建议，包括：
1. 本章情节目标
2. 情绪节奏建议
3. 需要推进的伏笔
4. 角色互动安排`;

    return prompt;
  }

  private buildWriterPrompt(
    bookId: string,
    content: string | undefined,
    planning: string,
    context: any,
    command: string = 'continue',
  ): string {
    const { characters, foreshadowings, chapterSummary, plotLines, ragContext } = context;

    let prompt = `# 任务：写作生成\n## 指令: ${command}\n\n`;

    if (ragContext) {
      prompt += `## 检索上下文\n${ragContext}\n\n`;
    }

    if (planning) {
      prompt += `## 规划要点\n${planning}\n\n`;
    }

    prompt += `## 角色状态\n`;
    (characters || []).slice(0, 5).forEach((c: any) => {
      const profile = c.profile || {};
      prompt += `- ${c.name}: ${profile.currentGoal || '无'} (性格：${profile.personality || '未设定'})\n`;
    });

    prompt += `\n## 伏笔\n`;
    (foreshadowings || []).slice(0, 3).forEach((f: any) => {
      prompt += `- ${f.title}: ${f.content}\n`;
    });

    prompt += `\n## 主线剧情\n`;
    (plotLines || [])
      .filter((pl: any) => pl.type === 'MAIN')
      .slice(0, 2)
      .forEach((pl: any) => {
        prompt += `- ${pl.title}: ${pl.description || ''}\n`;
      });

    if (chapterSummary) {
      prompt += `\n## 前情摘要\n${chapterSummary}\n`;
    }

    prompt += `\n## 当前文本\n${(content || '').slice(-3000)}\n\n`;

    const commandInstructions: Record<string, string> = {
      continue: `请续写以上内容。要求：
1. 字数约500-1000字
2. 必须合理分段，每段200-400字，段落之间用空行分隔
3. 对话独立成段，叙述与对话交替
4. 保持文风一致，情节衔接自然
5. 适当加入心理描写、环境描写或动作细节
6. 直接输出正文，不要添加标题、编号或任何元描述文字`,
      improve: `请改进以上内容。要求：
1. 【严禁删除】不得删除任何段落、情节、对话或描写。改进仅限于在原文基础上润色语句
2. 输出字数必须 >= 原文字数，绝不能缩减内容
3. 保持所有角色对话、情节进展、场景描写完整不变
4. 仅优化：语句通顺度、词汇表达、修辞运用、段落过渡
5. 合理分段，每段200-400字，段落之间用空行分隔
6. 对话独立成段，增加对话的个性化表达
7. 加强场景转换的过渡描写
8. 直接输出改进后的完整正文，不要添加任何标记或元描述
9. 如果原文有N个段落，输出也必须至少有N个段落`,
      expand: `请扩展以上内容。要求：
1. 【严禁删除】原文所有段落、情节、对话必须完整保留
2. 字数扩展约50%，只能增加不能减少
3. 在原文段落之间或段落内部增加细节描写、心理活动、环境氛围描写
4. 丰富角色对话，增加动作描写和神态描写
5. 合理分段，每段200-400字，段落之间用空行分隔
6. 直接输出扩展后的完整正文，不要添加任何标记或元描述`,
      summarize: '请用简洁的语言总结以上内容，200字以内。',
      generate: `请根据规划要点和上下文，生成新的章节内容。要求：
1. 字数约1000-2000字
2. 必须合理分段，每段200-400字，段落之间用空行分隔
3. 对话独立成段，叙述与对话交替
4. 直接输出正文，不要添加章节标题或任何元描述`,
    };

    prompt += commandInstructions[command] || commandInstructions.continue;

    return prompt;
  }

  private buildConsistencyPrompt(bookId: string, content: string, context: any): string {
    const { characters, foreshadowings, worldSettings } = context;

    let prompt = `# 任务：一致性检查\n\n## 角色设定\n`;
    (characters || []).forEach((c: any) => {
      const profile = c.profile || {};
      prompt += `- ${c.name}: 能力=${profile.strength || '未设定'}, 弱点=${profile.weakness || '未设定'}, 性格=${profile.personality || '未设定'}\n`;
    });

    prompt += `\n## 世界观规则\n`;
    (worldSettings || []).forEach((ws: any) => {
      prompt += `- 题材=${ws.genre || ''}, 风格=${ws.tone || ''}\n`;
    });

    prompt += `\n## 待回收伏笔\n`;
    (foreshadowings || []).forEach((f: any) => {
      prompt += `- ${f.title}: ${f.content}\n`;
    });

    prompt += `\n## 待检查内容\n${content.slice(0, 4000)}\n\n`;

    prompt += `请按以下JSON格式返回检查结果：
{
  "issues": [
    {"type": "timeline|character_ability|character_personality|world_rule|foreshadowing|logic", "severity": "ERROR|WARNING|INFO", "description": "...", "suggestion": "..."}
  ]
}
如果没有问题，返回 {"issues": []}`;

    return prompt;
  }

  // ==================== 解析 ====================

  private parseConsistencyResult(text: string): { issues: any[] } {
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.issues && Array.isArray(parsed.issues)) {
          return parsed;
        }
      }
    } catch {}

    // 如果无法解析JSON，尝试从文本中提取问题
    if (text.includes('检查通过') || text.includes('没有发现')) {
      return { issues: [] };
    }

    return {
      issues: [
        {
          type: 'logic',
          severity: 'INFO',
          description: text.slice(0, 200),
        },
      ],
    };
  }

  // ==================== 创意计划 Prompt ====================

  private buildCreativePlanPrompt(userPrompt: string, chapterCount: number): string {
    return `你是一位资深网络小说策划专家。请根据用户描述，构思一部精彩的小说，并严格以纯JSON格式返回完整的创作方案。

注意：
- 不要使用 markdown 代码块
- 不要在 JSON 前后添加任何文字说明
- 直接以 { 开头，以 } 结尾
- 确保 JSON 完整且可解析

用户描述：${userPrompt}

请按以下JSON结构返回：
{
  "title": "小说标题",
  "genre": "题材类型（如：修仙、都市、科幻、奇幻、悬疑等）",
  "theme": "核心主题（一句话）",
  "tone": "基调风格（如：黑暗、热血、温馨、史诗等）",
  "worldSetting": {
    "background": "世界背景设定（200-400字详细描述）",
    "powerSystem": "力量/修炼体系（如有）",
    "geography": "地理环境",
    "socialStructure": "社会结构",
    "rules": "特殊规则"
  },
  "characters": [
    {
      "name": "角色名",
      "role": "PROTAGONIST/ANTAGONIST/SUPPORTING/MINOR",
      "personality": "性格特征",
      "background": "角色背景",
      "goal": "角色目标",
      "strength": "能力/优势",
      "weakness": "缺陷/弱点"
    }
  ],
  "plotLines": [
    {
      "title": "剧情线名称",
      "type": "MAIN/SUB/HIDDEN",
      "description": "剧情线描述",
      "keyEvents": ["关键事件1", "关键事件2"]
    }
  ],
  "chapterOutlines": [
    {
      "title": "章节标题",
      "summary": "章节内容概要（100-200字）",
      "keyScenes": ["关键场景1", "关键场景2"],
      "involvedCharacters": ["角色名1", "角色名2"]
    }
  ],
  "foreshadowings": [
    {
      "title": "伏笔名称",
      "content": "伏笔内容描述",
      "plantChapter": 1,
      "resolveChapter": 5
    }
  ]
}

要求：
1. 角色至少3个，必须包含主角(PROTAGONIST)和反派(ANTAGONIST)
2. 剧情线包含1条主线(MAIN)和1条副线(SUB)
3. 章节大纲数量为 ${chapterCount} 个，每章summary50-100字
4. 伏笔至少2个
5. 所有内容互相呼应、逻辑自洽
6. worldSetting.background 100-200字
7. 每个角色的personality和background各30-50字
8. 保持紧凑，不要冗余描述

再次强调：直接返回纯JSON，不要markdown代码块，不要任何额外文字。以 { 开头，以 } 结尾。`;
  }

  private buildChapterFromPlanPrompt(
    plan: CreativePlan,
    outline: CreativePlan['chapterOutlines'][0],
    chapterIndex: number,
    context: any,
  ): string {
    let prompt = `# 任务：根据创作计划生成章节正文\n\n`;

    prompt += `## 小说概况\n`;
    prompt += `- 标题: ${plan.title}\n`;
    prompt += `- 题材: ${plan.genre}\n`;
    prompt += `- 风格: ${plan.tone}\n`;
    prompt += `- 主题: ${plan.theme}\n\n`;

    prompt += `## 世界背景\n${plan.worldSetting.background}\n`;
    if (plan.worldSetting.powerSystem) prompt += `修炼体系: ${plan.worldSetting.powerSystem}\n`;
    prompt += `\n`;

    prompt += `## 本章涉及角色\n`;
    for (const charName of outline.involvedCharacters) {
      const charDef = plan.characters.find((c) => c.name === charName);
      if (charDef) {
        prompt += `- ${charDef.name} (${charDef.role}): ${charDef.personality}，目标: ${charDef.goal}\n`;
      }
    }
    prompt += `\n`;

    prompt += `## 主线剧情\n`;
    plan.plotLines
      .filter((pl) => pl.type === 'MAIN')
      .forEach((pl) => {
        prompt += `- ${pl.title}: ${pl.description}\n`;
      });
    prompt += `\n`;

    if (chapterIndex > 0 && context.chapterSummary) {
      prompt += `## 前情提要\n${context.chapterSummary}\n\n`;
    }

    // 需要在本章埋设的伏笔
    const chapterForeshadowings = plan.foreshadowings.filter(
      (f) => f.plantChapter === chapterIndex + 1,
    );
    if (chapterForeshadowings.length > 0) {
      prompt += `## 需在本章埋设的伏笔\n`;
      chapterForeshadowings.forEach((f) => {
        prompt += `- ${f.title}: ${f.content}\n`;
      });
      prompt += `\n`;
    }

    prompt += `## 本章大纲\n`;
    prompt += `标题: ${outline.title}\n`;
    prompt += `梗概: ${outline.summary}\n`;
    prompt += `关键场景: ${outline.keyScenes.join('、')}\n\n`;

    prompt += `## 写作要求\n`;
    prompt += `1. 字数: 2000-3000字\n`;
    prompt += `2. 紧扣大纲，自然展开关键场景\n`;
    prompt += `3. 角色对话符合性格设定，每句对话独立成段\n`;
    prompt += `4. 适当融入伏笔，自然不突兀\n`;
    prompt += `5. 保持"${plan.tone}"的整体基调\n`;
    prompt += `6. 直接输出正文，不要标注章节号和标题\n`;
    prompt += `7. **必须合理分段**：每段200-400字，段落之间用空行分隔，绝不允许输出一整段不分段的文本\n`;
    prompt += `8. 叙述、对话、心理描写、环境描写交替进行，节奏紧凑有变化\n`;
    prompt += `9. 不要在正文中添加编号、标记或元描述文字\n`;

    return prompt;
  }

  private parseCreativePlan(text: string, defaultChapterCount: number): CreativePlan {
    this.logger.log(`[parseCreativePlan] 输入文本长度: ${text?.length || 0}`);

    // 多种策略提取 JSON
    const extractors = [
      // 策略1: 提取 ```json ... ``` 代码块
      () => {
        const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
        return m ? m[1].trim() : null;
      },
      // 策略2: 找到最外层的 { ... } 配对
      () => {
        const start = text.indexOf('{');
        if (start === -1) return null;
        let depth = 0;
        for (let i = start; i < text.length; i++) {
          if (text[i] === '{') depth++;
          else if (text[i] === '}') {
            depth--;
            if (depth === 0) return text.slice(start, i + 1);
          }
        }
        // 如果括号不完整，尝试补全
        return text.slice(start) + '}';
      },
      // 策略3: 正则贪婪匹配
      () => {
        const m = text.match(/\{[\s\S]*\}/);
        return m ? m[0] : null;
      },
    ];

    for (let idx = 0; idx < extractors.length; idx++) {
      try {
        const jsonStr = extractors[idx]();
        if (!jsonStr) continue;

        // 多轮清理 JSON 格式问题
        const cleaned = this.repairJson(jsonStr);

        const parsed = JSON.parse(cleaned);
        this.logger.log(
          `[parseCreativePlan] 策略${idx + 1}成功解析，title=${parsed.title}，` +
            `characters=${parsed.characters?.length || 0}，plotLines=${parsed.plotLines?.length || 0}`,
        );

        // 验证并填充默认值
        return {
          title: parsed.title || '未命名小说',
          genre: parsed.genre || '未分类',
          theme: parsed.theme || '',
          tone: parsed.tone || '标准',
          worldSetting: {
            background:
              parsed.worldSetting?.background || parsed.world_setting?.background || '未设定',
            powerSystem:
              parsed.worldSetting?.powerSystem ||
              parsed.world_setting?.powerSystem ||
              parsed.worldSetting?.power_system,
            geography: parsed.worldSetting?.geography || parsed.world_setting?.geography,
            socialStructure:
              parsed.worldSetting?.socialStructure ||
              parsed.world_setting?.socialStructure ||
              parsed.worldSetting?.social_structure,
            rules: parsed.worldSetting?.rules || parsed.world_setting?.rules,
          },
          characters: Array.isArray(parsed.characters)
            ? parsed.characters.map((c: any) => ({
                name: c.name || '未命名',
                role: c.role || 'SUPPORTING',
                personality: c.personality || '',
                background: c.background || '',
                goal: c.goal || '',
                strength: c.strength || '',
                weakness: c.weakness || '',
              }))
            : [],
          plotLines: Array.isArray(parsed.plotLines || parsed.plot_lines)
            ? (parsed.plotLines || parsed.plot_lines).map((pl: any) => ({
                title: pl.title || '未命名线',
                type: ['MAIN', 'SUB', 'HIDDEN'].includes(pl.type) ? pl.type : 'MAIN',
                description: pl.description || '',
                keyEvents: Array.isArray(pl.keyEvents || pl.key_events)
                  ? pl.keyEvents || pl.key_events
                  : [],
              }))
            : [],
          chapterOutlines: Array.isArray(parsed.chapterOutlines || parsed.chapter_outlines)
            ? (parsed.chapterOutlines || parsed.chapter_outlines)
                .slice(0, defaultChapterCount)
                .map((co: any) => ({
                  title: co.title || '未命名章节',
                  summary: co.summary || '',
                  keyScenes: Array.isArray(co.keyScenes || co.key_scenes)
                    ? co.keyScenes || co.key_scenes
                    : [],
                  involvedCharacters: Array.isArray(co.involvedCharacters || co.involved_characters)
                    ? co.involvedCharacters || co.involved_characters
                    : [],
                }))
            : [],
          foreshadowings: Array.isArray(parsed.foreshadowings)
            ? parsed.foreshadowings.map((f: any) => ({
                title: f.title || '未命名伏笔',
                content: f.content || '',
                plantChapter: f.plantChapter || f.plant_chapter || 1,
                resolveChapter: f.resolveChapter || f.resolve_chapter,
              }))
            : [],
        };
      } catch (e: any) {
        this.logger.warn(`[parseCreativePlan] 策略${idx + 1}解析失败: ${e.message}`);
      }
    }

    // 所有策略都失败 - 抛错而不是降级
    this.logger.error(
      `[parseCreativePlan] 所有JSON解析策略均失败，原始文本: ${text?.slice(0, 500)}`,
    );
    throw new Error('AI 返回的创意计划格式无法解析，请重试');
  }

  // ==================== JSON 修复 ====================

  /**
   * 修复 AI 返回的不规范 JSON
   * 处理: 未引号的 key/value、尾逗号、单引号、控制字符等
   */
  private repairJson(raw: string): string {
    let s = raw;

    // 1. 移除尾逗号
    s = s.replace(/,\s*([}\]])/g, '$1');

    // 2. 单引号 → 双引号
    s = s.replace(/'/g, '"');

    // 3. 尝试直接解析，如果成功就直接返回
    try {
      JSON.parse(s);
      return s;
    } catch {}

    // 4. 逐行修复未引号的 value
    const lines = s.split('\n');
    const repairedLines = lines.map((line) => {
      // 匹配 "key": value 模式（value 未被引号包裹，且不是 数字/true/false/null/[/{）
      const match = line.match(
        /^(\s*"[^"]+"\s*:\s*)([^"{\[\d\-\s][^,}\]]*[^,}\]\s])\s*([,}\]]?\s*)$/,
      );
      if (match) {
        const [, prefix, value, suffix] = match;
        // 排除 true/false/null
        if (!/^(true|false|null)$/.test(value.trim())) {
          // 引号包裹 value 并转义内部引号
          const escaped = value.trim().replace(/"/g, '\\"');
          return `${prefix}"${escaped}"${suffix}`;
        }
      }
      return line;
    });

    s = repairedLines.join('\n');

    // 5. 再次移除尾逗号（修复后可能产生新的）
    s = s.replace(/,\s*([}\]])/g, '$1');

    // 6. 未引号的 key
    s = s.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');

    return s;
  }

  // ==================== System Prompts ====================

  private getSystemPrompt(type: AgentType): string {
    const prompts = {
      [AgentType.PLANNER]: `你是一个专业的小说大纲规划师。根据世界观、角色和已有剧情，设计合理的章节结构和情节发展。
输出要求：结构清晰，包含情节目标、情绪曲线建议、伏笔安排。`,
      [AgentType.CHARACTER]: `你是一个专业的角色分析师。根据角色设定和剧情发展，分析角色行为的合理性。
输出要求：标注人物性格、动机、行为一致性。`,
      [AgentType.WRITER]: `你是一个专业的网络小说作家。根据给定上下文生成高质量正文内容。

核心要求：
1. **分段格式**：每个自然段200-400字，段落之间必须用空行（两个换行符）分隔，绝不允许输出整段不分段的文本
2. 人物对话用独立段落，每句对话单独成段
3. 人物语言符合其性格设定，对话生动有个性
4. 情节推进自然流畅，场景转换有过渡
5. 保持前后文风一致
6. 适当融入伏笔和悬念
7. 注意场景描写和节奏控制：叙述-对话-心理-环境交替
8. 直接输出小说正文，不要添加任何章节标题、编号、注释或"以下是续写内容"等元描述
9. 不要在段落开头使用数字编号或项目符号`,
      [AgentType.CONSISTENCY]: `你是一个专业的写作编辑，负责检查文本一致性。
请严格按JSON格式返回检查结果。
检查项：角色设定冲突(OOC)、时间线错误、伏笔遗漏、世界观违背、逻辑漏洞。`,
    };
    return prompts[type] || prompts[AgentType.WRITER];
  }

  private getTemperature(type: AgentType): number {
    const temps = {
      [AgentType.PLANNER]: 0.8,
      [AgentType.CHARACTER]: 0.7,
      [AgentType.WRITER]: 0.7,
      [AgentType.CONSISTENCY]: 0.3,
    };
    return temps[type] || 0.7;
  }
}
