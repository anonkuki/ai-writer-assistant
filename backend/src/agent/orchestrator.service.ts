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
  /** MiniMax 付费直连配置 */
  private readonly minimaxApiKey: string;
  private readonly minimaxApiUrl: string;
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
    this.minimaxApiKey = this.configService.get<string>('MINIMAX_API_KEY') || '';
    this.minimaxApiUrl = this.configService.get<string>('MINIMAX_API_URL') || 'https://api.minimaxi.com/v1/chat/completions';
    this.contextCacheTtlMs = this.configService.get<number>('CONTEXT_CACHE_TTL_MS') ?? 30000;

    if (this.minimaxApiKey) {
      this.logger.log('✅ MiniMax 付费直连已启用');
    }

    // 构建可用模型列表
    this.availableModels = [
      { id: 'Pro/deepseek-ai/DeepSeek-V3.2', label: 'DeepSeek V3.2', description: '旗舰模型，质量最高', speed: 'normal' },
      { id: 'Pro/zhipuai/GLM-5', label: 'GLM-5', description: '智谱高质量模型', speed: 'normal' },
      { id: 'Pro/MiniMaxAI/MiniMax-M2.5', label: 'MiniMax M2.5', description: '付费直连，快速响应', speed: 'fast' },
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

  /** 判断模型是否为 MiniMax 系列 */
  private isMiniMaxModel(modelId: string): boolean {
    return modelId.includes('MiniMax');
  }

  /**
   * 根据模型 ID 解析实际的 API 端点、密钥和模型名称。
   * MiniMax 走付费直连，其余走硅基流动。
   */
  private resolveEndpoint(modelId: string): { url: string; key: string; model: string } {
    if (this.isMiniMaxModel(modelId) && this.minimaxApiKey) {
      return {
        url: this.minimaxApiUrl,
        key: this.minimaxApiKey,
        model: 'MiniMax-M2.5',            // MiniMax 直连 API 使用短名称
      };
    }
    return {
      url: this.apiUrl,
      key: this.apiKey,
      model: modelId,
    };
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
    const chaptersOverview = this.buildChaptersOverview(allChapters, chapterId);

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

    // == 章纲详情 ==
    const outlineDetail =
      (context.outlines || [])
        .map((o: any) => `「${o.title}」: ${(o.content || '').slice(0, 80)}`)
        .join('\n') || '无';

    const systemPrompt = `你是一个专业的AI小说创作助手。你不仅提供分析和建议，更要**主动执行操作**帮助用户完成创作。

【核心原则——内外在联动】
章节内容是"外在"，世界观/角色/剧情线/章纲/伏笔是"内在"。
实现外在需求（写章节）前，必须先确保内在完整；写完后，内在也要同步更新。
当内在缺失时，先从现有章节内容中提取补全，再让内外保持自洽。

══════ 当前书籍全貌 ══════
📚 世界观: ${worldDetail}
👥 角色 (${(context.characters || []).length}):
${characterDetails}
📖 剧情线 (${(context.plotLines || []).length}):
${plotlineDetail}
🔮 伏笔 (${(context.foreshadowings || []).length}):
${foreshadowingDetail}
📝 章纲 (${(context.outlines || []).length}):
${outlineDetail}

📋 章节列表 (${allChapters.length}章):
${chaptersOverview}
${context.chapterSummary ? `\n📝 当前章节摘要: ${context.chapterSummary}` : ''}
${currentChapter ? `\n✏️ 用户正在编辑: 第${currentChapter.order}章「${currentChapter.title}」(${currentChapter.wordCount}字)` : ''}
${contentSnippet ? `\n--- 编辑器末尾内容 ---\n${contentSnippet}\n---` : ''}

══════ 行为规则 ══════
1. **智能路由**：先分析用户意图，再选择最合适的操作。判断标准（按优先级）：
   - 提到"根据当前内容/已有章节+编写/写最新/下一章"需要扫描全书上下文 → **orchestrate**（多步编排：先分析→补全设定→更新章纲→写章节）
   - 提到"补全/填补/补充/完善+设定/世界观/角色/章纲/大纲/伏笔/金手指"或"先分析再写" → **orchestrate**
   - 提到"根据现有内容/已有内容/当前内容+填补/补全/补充/完善" → **orchestrate**（从现有章节中提取信息补全内在设定）
   - 提到"编写/写/开始写+第N章" 或 "新建章节并写内容" → **create_chapter**（新建指定章节并生成内容）
   - 提到从零"写小说/写一本/创作一部新小说/前N章"等明确从零开始 → creative_plan（仅限全新创作）
   - 提到"续写/继续写/接着写/往下写"（对当前章节追加内容） → 先描述续写走向，再 agent_command(continue)
   - 提到"改进/润色/分段/优化" → agent_command(improve)
   - 提到"扩写/详细/展开/丰富" → agent_command(expand)
   - 提到"改写/重写/修改" → agent_command(edit)
   - 提到设计/创建角色 → create_character
   - 提到剧情线/故事线 → create_plotline
   - 提到伏笔/暗示/线索 → create_foreshadowing
   - 提到"分析全文/通读全书/检查伏笔/角色弧线/节奏分析/找问题" → analyze_text
   - 提到"给出/设计/规划/列出+大纲/章纲/三幕式"或"基于当前剧情+大纲" → 在回复中输出章纲内容 + **必须附带 save_outline 操作**
   - 提到"将此/把这个+大纲/章纲+保存/应用"或"保存到章纲维度" → 从对话历史提取章纲内容 + save_outline 操作
   - 纯粹提问/讨论 → 不添加ACTIONS，仅回复文字
- "编写第4章：标题" = 用户已明确标题和方向，简单新建 → **create_chapter**
- "继续写当前章节" = 在当前打开的章节后面追加内容 → agent_command(continue)
- "写一本关于XX的新小说" = 从零开始创建整部小说 → creative_plan
- **注意：如果书籍已有章节内容，用户要求补全/填补/完善设定类信息，绝对不要使用 creative_plan，必须使用 orchestrate**

2. **回复格式**：
   - **多步编排请求**：说明将启动多步编排流程，简述预计步骤（如：先分析→补全设定→编写章纲→写正文）
   - **新建章节请求**：说明将创建哪一章，简述章节内容方向
   - **续写请求**：必须先说明续写方向，格式为「接下来续写的内容为：（简要描述续写情节走向，1-3句话概括）」，然后添加ACTIONS
   - **其他请求**：正文简短（2-4句），说明你判断了什么意图、将执行什么。不需要展开细节。
3. 必须在回复末尾添加 <!--ACTIONS:[...]-->，否则操作不会执行。
4. 可用ACTIONS类型：

A) 多步编排（复杂请求：需要扫描上下文、补全缺失设定、更新章纲、写最新章等）：
<!--ACTIONS:[{"type":"orchestrate","label":"描述","data":{"message":"用户原始请求"}}]-->
适用：编写最新章、根据内容写下一章、补全设定后写章节等需要多步协同的请求。

B) 创作计划（仅限从零创建全新小说，绝不用于已有章节内容的补全/填补）：
<!--ACTIONS:[{"type":"creative_plan","label":"描述","data":{"prompt":"用户请求完整描述","chapterCount":数字}}]-->
注意：如果书籍已有章节内容，不论用户怎么说，都不要用 creative_plan，而应该用 orchestrate。

C) 对当前章节内容操作（续写/改进/扩写/改写/润色等需要打开章节）：
<!--ACTIONS:[{"type":"agent_command","label":"描述","data":{"command":"continue或improve或expand或edit"}}]-->

D) 新建章节并生成内容（用户要求编写某一章、新建下一章等）：
<!--ACTIONS:[{"type":"create_chapter","label":"编写第N章: 章节标题","data":{"title":"章节标题","generateContent":true,"prompt":"基于已有内容的章节写作方向描述"}}]-->
注意：title 格式应为"第N章 标题"，prompt 应包含你对这章剧情的构思（基于已有章节和设定）。

E) 创建角色：
<!--ACTIONS:[{"type":"create_character","label":"创建角色: XXX","data":{"name":"角色名","role":"protagonist/antagonist/supporting","personality":"性格描述","background":"背景","goal":"目标","strength":"优势","weakness":"弱点"}}]-->

F) 创建剧情线：
<!--ACTIONS:[{"type":"create_plotline","label":"创建剧情线: XXX","data":{"title":"剧情线标题","type":"MAIN或SUB或HIDDEN","description":"详细描述"}}]-->

G) 创建伏笔：
<!--ACTIONS:[{"type":"create_foreshadowing","label":"植入伏笔: XXX","data":{"title":"伏笔标题","content":"伏笔内容描述"}}]-->

H) 全文分析（读取全部章节内容，分析伏笔/角色/节奏等，给出建议）：
<!--ACTIONS:[{"type":"analyze_text","label":"分析描述","data":{"analysisType":"foreshadowing或character_arc或pacing或comprehensive"}}]-->
analysisType 说明: foreshadowing=伏笔分析, character_arc=角色弧线, pacing=节奏分析, comprehensive=全面分析

I) 保存/应用章纲到大纲维度：
<!--ACTIONS:[{"type":"save_outline","label":"保存章纲: 第N章","data":{"title":"第N章 标题","content":"完整章纲文本"}}]-->
当用户要求"把章纲应用/保存到大纲"、"更新第X章章纲"、"保存到章纲部分"时使用。
data.content 必须填入完整章纲文本（不是摘要）。如果用户引用了之前对话中生成的章纲，从对话历史中提取完整内容。

J) 多个操作可以组合为一个数组。

5. label字段写具体描述，不要写"执行操作"。
6. creative_plan 的 data.prompt 需包含用户完整意图描述。仅限从零创建新小说时才用。
7. 如果用户的请求需要当前章节内容但未打开任何章节，先提醒用户打开章节。
8. **新建章节** vs **续写当前章节** vs **多步编排**：
   - 用户说"编写第X章"时用 create_chapter
   - 说"继续写/接着写"时用 agent_command(continue)
   - 说"根据当前内容写最新章/补全设定后写/填补世界观角色大纲伏笔"时用 orchestrate
9. **重要**：当书籍已有${allChapters.length}个章节时，"补全/填补/完善世界观/角色/大纲/伏笔"等请求必须用 orchestrate（不是 creative_plan）
10. **🔴 关键规则：当你在回复中生成了章纲/大纲内容时，必须同时附带 save_outline 操作**
   例如用户说"给出下一章的大纲"、"设计第16章章纲"、"基于当前剧情给出三幕式大纲"，你应该：
   (a) 在回复正文中输出章纲内容
   (b) 在末尾附带 save_outline 操作，data.content 填入你生成的完整章纲文本
   (c) 回复末尾询问"已为您生成章纲，点击下方按钮可直接保存到章纲维度。"
   这样用户只需一键确认，无需再单独输入"保存到章纲"。
11. **当用户引用之前的对话内容**（如"把这个章纲应用到..."、"保存到章纲维度"、"用上面的..."），你**必须**从对话历史中找到完整的章纲/大纲内容，放入 save_outline 的 data.content 中执行。绝不允许返回空内容。
12. **绝不允许返回空内容**。如果不确定用户意图，至少回复一段文字询问或给出建议。`;

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
        { maxTokens: 2000, timeoutMs: 120000, systemPrompt, modelOverride: modelId, chatHistory: chatHistory.slice(-10) },
        onChunk,
      );

      const { reply: parsedReply, suggestedActions: parsedActions } = this.parseReplyAndActions(fullReply);
      let reply = parsedReply;
      let suggestedActions = parsedActions;

      // 场景1: 有操作但回复文本为空 → 补充默认说明文本
      if (!reply && suggestedActions?.length) {
        const actionLabels = suggestedActions.map((a: any) => a.label).join('、');
        reply = `已分析您的需求，将执行以下操作：${actionLabels}`;
        onChunk(reply);
      }

      // 场景2: 完全无回复也无操作 → 通用意图分类器回退
      if (!reply && !suggestedActions?.length) {
        this.logger.warn(`StreamChat 回复为空，启动通用意图分类回退`);
        const fallback = this.classifyIntentAndFallback(message, chatHistory, allChapters.length);
        reply = fallback.reply;
        suggestedActions = fallback.suggestedActions;
        onChunk(reply);
      }

      // 场景3: 有回复但无操作 → 推断用户意图自动补充操作（AI 忘记/截断 ACTIONS 标签的兜底）
      if (reply && !suggestedActions?.length) {
        const inferred = this.inferMissingActions(message, allChapters.length);
        if (inferred) {
          suggestedActions = inferred;
          this.logger.log(`[streamChat] AI 回复有文本但缺少 ACTIONS，自动推断: ${inferred.map((a: any) => a.type).join(', ')}`);
        }
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
    const chaptersOverview = this.buildChaptersOverview(allChapters, chapterId);

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
1. 用户意图分析：用户想要什么？是从零创建新小说，还是基于已有内容进行补全/完善？
2. 上下文关联：哪些已有设定/角色/剧情线与此相关？当前书籍已有多少章节内容？
3. 操作路由判断：
   - 如果已有章节内容且用户要求补全/填补/完善世界观/大纲/角色/伏笔等 → 应使用"orchestrate"（多步编排，从现有内容中提取补全）
   - 如果是全新创作、从零开始 → 应使用"creative_plan"
   - 其他情况根据具体意图判断
4. 潜在风险：是否有设定冲突、角色不一致、逻辑漏洞？
5. 最佳策略：推荐的执行方案及理由

要求：简洁、结构化，不超过400字。`;

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
1. **智能路由**：根据用户意图及深度思考分析选择最合适的操作。判断标准（按优先级）：
   - 提到"根据当前内容/已有章节+编写/写最新/下一章"需要扫描全书上下文 → **orchestrate**（多步编排：先分析→补全设定→更新章纲→写章节）
   - 提到"补全/填补/完善/补充+设定/世界观/角色/章纲/大纲/伏笔/金手指"或"先分析再写" → **orchestrate**
   - 提到"根据现有内容/已有内容+填补/补全/完善" → **orchestrate**（从现有章节中提取信息补全内在设定）
   - 当已有多个章节但内在设定（世界观/角色/大纲等）明显缺失时，补全请求 → **orchestrate**
   - 提到"编写/写/开始写+第N章" 或 "新建章节并写内容" → **create_chapter**
   - 提到从零"写小说/写一本/创作一部新小说"或"从头开始写" → creative_plan（仅限从零创建新小说）
   - 提到"续写/继续写/接着写/往下写"（对当前章节追加） → 先描述续写走向，再 agent_command(continue)
   - 提到"改进/润色/分段/优化" → agent_command(improve)
   - 提到"扩写/详细/展开/丰富" → agent_command(expand)
   - 提到"改写/重写/修改" → agent_command(edit)
   - 提到设计/创建角色 → create_character
   - 提到剧情线/故事线 → create_plotline
   - 提到伏笔/暗示/线索 → create_foreshadowing
   - 提到"分析全文/通读全书/检查伏笔/角色弧线/节奏分析/找问题" → analyze_text
   - 提到"给出/设计/规划/列出+大纲/章纲/三幕式"或"基于当前剧情+大纲" → 在回复中输出章纲内容 + **必须附带 save_outline 操作**
   - 提到"将此/把这个+大纲/章纲+保存/应用"或"保存到章纲维度" → 从对话历史提取章纲内容 + save_outline 操作
   - 纯粹提问/讨论 → 不添加ACTIONS，仅回复文字

**关键区分**：
- "根据当前内容填补世界观/大纲/角色/伏笔" = 已有章节，需要从中提取补全内在设定 → **orchestrate**（这不是创建新小说！）
- "根据当前内容编写第四章" = 需要综合上下文 → **orchestrate**
- "编写第4章：标题" = 用户已明确标题 → create_chapter
- "继续写当前章节" = 追加内容 → agent_command(continue)
- "写一本关于XX的新小说" = 从零创建 → creative_plan
- **注意：如果书籍已有章节内容，用户要求补全/填补/完善设定类信息，绝对不要使用 creative_plan，必须使用 orchestrate**

2. **回复格式**：正文简短，利用深度思考结果给出更精准的建议。说明将执行什么操作。
3. 必须在回复末尾添加 <!--ACTIONS:[...]-->，否则操作不会执行。如果无法确定操作类型，至少输出文字回复（不要返回空内容）。
4. 可用ACTIONS类型：

A) 多步编排（复杂请求：需要扫描上下文、补全缺失设定、从现有内容提取信息等）：
{"type":"orchestrate","label":"描述","data":{"message":"用户原始请求"}}
适用：根据当前内容填补/补全世界观/大纲/角色/伏笔、编写最新章、补全设定后写章节等。

B) 创作计划（仅限从零创建完整新小说）：
{"type":"creative_plan","label":"描述","data":{"prompt":"完整描述","chapterCount":数字}}
注意：仅当用户明确要求创建一本全新的小说时才用此类型。

C) agent_command: {"type":"agent_command","label":"描述","data":{"command":"continue|improve|expand|edit"}}
D) create_chapter: {"type":"create_chapter","label":"编写第N章: 标题","data":{"title":"第N章 标题","generateContent":true,"prompt":"章节写作方向描述"}}
E) create_character: {"type":"create_character","label":"创建角色: XXX","data":{...}}
F) create_plotline: {"type":"create_plotline","label":"创建剧情线: XXX","data":{...}}
G) create_foreshadowing: {"type":"create_foreshadowing","label":"植入伏笔: XXX","data":{...}}
H) analyze_text: {"type":"analyze_text","label":"分析描述","data":{"analysisType":"..."}}
I) save_outline（保存/应用章纲到大纲维度）：
{"type":"save_outline","label":"保存章纲: 第N章","data":{"title":"第N章 标题","content":"完整章纲文本"}}
适用场景：
- 用户要求将之前生成的章纲保存/应用到章纲维度
- 用户让你给出某章章纲并应用
- **你在回复中生成了章纲/大纲内容时，必须自动附带此操作**
data.content 必须填入完整章纲文本（不是摘要），如果引用对话历史中的内容，需要完整提取。

5. label字段写具体描述，不要写"执行操作"。
6. **再次强调**：已有章节内容的情况下，"填补/补全/完善世界观/大纲/角色/伏笔"等请求必须用 orchestrate，不是 creative_plan。
7. **🔴 关键规则：当你在回复中生成了章纲/大纲内容时，必须同时附带 save_outline 操作**
   例如用户说"给出下一章的大纲"、"设计第16章章纲"、"基于当前剧情给出三幕式大纲"，你应该：
   (a) 在回复正文中输出完整章纲内容
   (b) 在末尾附带 save_outline 操作，data.content 填入你刚生成的完整章纲文本
   (c) 回复末尾加一句"已为您生成章纲，点击下方按钮可直接保存到章纲维度。"
   这样用户一键即可保存，无需再额外输入"保存到章纲"。
8. **当用户引用之前的对话内容**（如"把这个章纲保存到..."、"将此大纲保存到章纲维度"、"用上面的..."），你**必须**从对话历史中找到完整的章纲/大纲内容，放入 save_outline 的 data.content 中。绝不允许返回空内容。
9. **绝不允许返回空内容**。如果不确定用户意图，至少回复一段文字询问或给出建议。`;

    let fullReply = '';
    try {
      fullReply = await this.streamCallAgent(
        AgentType.WRITER,
        message,
        0.8,
        { maxTokens: 2000, timeoutMs: 120000, systemPrompt: replySystemPrompt, modelOverride: modelId, chatHistory: chatHistory.slice(-10) },
        (chunk) => {
          onEvent({ type: 'token', data: { text: chunk } });
        },
      );
    } catch (err: any) {
      this.logger.error(`深度思考回复阶段失败: ${err.message}`);
      throw err;
    }

    const { reply: parsedReply, suggestedActions: parsedActions } = this.parseReplyAndActions(fullReply);
    let reply = parsedReply;
    let suggestedActions = parsedActions;

    // 场景1: 有操作但回复文本为空 → 补充默认说明文本
    if (!reply && suggestedActions?.length) {
      const actionLabels = suggestedActions.map((a: any) => a.label).join('、');
      reply = `已分析您的需求，将执行以下操作：${actionLabels}`;
      onEvent({ type: 'token', data: { text: reply } });
    }

    // 场景2: 完全无回复也无操作 → 通用意图分类器回退（结合思考结果）
    if (!reply && !suggestedActions?.length) {
      this.logger.warn(`深度思考回复为空，启动通用意图分类回退`);
      const combinedMsg = thinkingText ? `${message}\n[思考分析: ${thinkingText}]` : message;
      const fallback = this.classifyIntentAndFallback(combinedMsg, chatHistory, allChapters.length);
      reply = fallback.reply;
      suggestedActions = fallback.suggestedActions;
      onEvent({ type: 'token', data: { text: reply } });
    }

    // 场景3: 有回复但无操作 → 推断用户意图自动补充操作（AI 忘记/截断 ACTIONS 标签的兜底）
    if (reply && !suggestedActions?.length) {
      const inferred = this.inferMissingActions(message, allChapters.length);
      if (inferred) {
        suggestedActions = inferred;
        this.logger.log(`[streamDeepThinkChat] AI 回复有文本但缺少 ACTIONS，自动推断: ${inferred.map((a: any) => a.type).join(', ')}`);
      }
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
    const { bookId, chapterId, content, userInstructions } = request;

    // 1. Planner Agent — 传入章纲和用户指令
    const planningResult = await this.callAgent(
      AgentType.PLANNER,
      this.buildPlannerPrompt(bookId, content, context, userInstructions),
    );

    // 2. Writer Agent（多候选 — 并行生成）— 传入章纲和用户指令
    const candidateCount = request.candidateCount || 3;
    const generatePromises = Array.from({ length: candidateCount }, (_, i) =>
      this.callAgent(
        AgentType.WRITER,
        this.buildWriterPrompt(bookId, content, planningResult.result, context, 'generate', userInstructions),
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
    const { bookId, content, command, userInstructions } = request;

    const writerPrompt = this.buildWriterPrompt(bookId, content, '', context, command, userInstructions);
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

  /**
   * 构建章节列表概要 — 章节过多时自动截断，避免系统提示词过大
   */
  private buildChaptersOverview(
    allChapters: Array<{ id: string; title: string; order: number; wordCount: number; status?: string }>,
    currentChapterId?: string,
  ): string {
    if (!allChapters.length) return '尚无章节';
    let chaptersToShow = allChapters;
    let prefix = '';
    if (allChapters.length > 15) {
      const currentIdx = currentChapterId ? allChapters.findIndex(c => c.id === currentChapterId) : -1;
      const head = allChapters.slice(0, 5);
      const tail = allChapters.slice(-5);
      const current = currentIdx >= 5 && currentIdx < allChapters.length - 5
        ? [allChapters[currentIdx]]
        : [];
      chaptersToShow = [...head, ...(current.length ? [{ id: '...', title: '...', order: -1, wordCount: 0 } as any, ...current] : []), ...tail];
      prefix = `(共${allChapters.length}章，仅列出关键章节)\n`;
    }
    return prefix + chaptersToShow.map((c: any) =>
      c.id === '...' ? '  ...' :
      `${c.order}. ${c.title} (${c.wordCount}字${c.id === currentChapterId ? ' ← 当前编辑' : ''})`,
    ).join('\n');
  }

  /**
   * 统一解析 AI 回复中的文本和 ACTIONS 操作
   * 处理：正常 ACTIONS、JSON 格式错误、未闭合标签、多个 ACTIONS 块
   */
  private parseReplyAndActions(raw: string): { reply: string; suggestedActions: any[] | undefined } {
    if (!raw || !raw.trim()) {
      return { reply: '', suggestedActions: undefined };
    }

    let text = raw;
    const allActions: any[] = [];

    // 1) 匹配所有完整的 <!--ACTIONS:[...]-->
    const completeRegex = /<!--ACTIONS:([\s\S]*?)-->/g;
    let match: RegExpExecArray | null;
    while ((match = completeRegex.exec(text)) !== null) {
      try {
        const parsed = JSON.parse(match[1].trim());
        if (Array.isArray(parsed)) {
          allActions.push(...parsed);
        }
      } catch (e) {
        this.logger.warn(`ACTIONS JSON 解析失败: ${(e as Error).message}, 原始内容: ${match[1].slice(0, 200)}`);
        // 尝试宽松解析：提取 {...} 对象
        const objRegex = /\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g;
        let objMatch: RegExpExecArray | null;
        while ((objMatch = objRegex.exec(match[1])) !== null) {
          try {
            allActions.push(JSON.parse(objMatch[0]));
          } catch { /* 跳过不可修复的片段 */ }
        }
      }
    }
    // 移除完整的 ACTIONS 标签
    text = text.replace(completeRegex, '');

    // 2) 处理未闭合的 <!--ACTIONS:... （流式截断导致）
    const incompleteIdx = text.indexOf('<!--ACTIONS:');
    if (incompleteIdx !== -1) {
      const partial = text.slice(incompleteIdx);
      this.logger.warn(`检测到未闭合 ACTIONS 标签，已移除: ${partial.slice(0, 100)}...`);
      text = text.slice(0, incompleteIdx);
    }

    text = text.trim();
    const suggestedActions = allActions.length > 0 ? allActions : undefined;
    return { reply: text, suggestedActions };
  }

  /**
   * 意图推断 — 当 AI 回复有文本但缺少 ACTIONS 时，根据用户消息自动补充操作
   * 场景：AI 深度思考后返回分析文本但忘记/截断 ACTIONS 标签
   */
  private inferMissingActions(
    message: string,
    chapterCount: number,
  ): any[] | undefined {
    const msg = message.trim();

    // 「编写/写/创作/生成 + 第N章」→ create_chapter
    const chapterMatch = msg.match(/(编写|写|生成|创作).{0,10}第(\d+|[一二三四五六七八九十百]+)章[：:\s]*(.*)?/);
    if (chapterMatch) {
      const chapterNum = chapterMatch[2];
      const titleSuffix = chapterMatch[3]?.trim();
      const title = titleSuffix ? `第${chapterNum}章 ${titleSuffix}` : `第${chapterNum}章`;
      this.logger.log(`[inferMissingActions] 推断 create_chapter: ${title}`);
      return [{
        type: 'create_chapter',
        label: `编写${title}`,
        data: { title, generateContent: true, prompt: message },
      }];
    }

    // 「续写/继续写/接着写」→ agent_command(continue)
    if (/^(续写|继续写|接着写|往下写|接下来)/.test(msg)) {
      return [{ type: 'agent_command', label: '续写当前章节', data: { command: 'continue' } }];
    }

    // 「润色/改进/优化」→ agent_command(improve)
    if (/(润色|改进|优化|提升|打磨).{0,6}(文本|内容|章节|段落|文笔|表达|语句|当前)/.test(msg)) {
      return [{ type: 'agent_command', label: '润色内容', data: { command: 'improve' } }];
    }

    // 「扩写/展开/丰富」→ agent_command(expand)
    if (/(扩写|展开|丰富|详细|充实).{0,6}(文本|内容|章节|段落|当前)/.test(msg)) {
      return [{ type: 'agent_command', label: '扩写内容', data: { command: 'expand' } }];
    }

    // 「补全/填补设定」→ orchestrate
    if (/(填补|补全|补充|完善|丰富).{0,6}(世界观|角色|章纲|设定|大纲|伏笔|剧情)/.test(msg)) {
      return [{ type: 'orchestrate', label: '智能补全设定', data: { message } }];
    }

    return undefined;
  }

  /**
   * 通用意图分类器 — 当 AI 返回空回复时，根据用户消息推断意图并生成回退操作
   * 覆盖所有常见用户意图模式
   */
  private classifyIntentAndFallback(
    message: string,
    chatHistory: Array<{ role: string; content: string }>,
    chapterCount: number,
  ): { reply: string; suggestedActions?: any[] } {
    const msg = message.trim();

    // ── 1. 保存/应用章纲到大纲维度 ──
    if (/(保存|应用|存入|写入|录入).{0,6}(章纲|大纲|纲要).{0,6}(维度|面板|设定|数据)|将.{0,4}(章纲|大纲).{0,6}(保存|应用)/.test(msg)) {
      const outline = this.extractOutlineFromHistory(chatHistory);
      if (outline) {
        return {
          reply: '已从对话历史中提取章纲内容，点击下方按钮保存到章纲维度。',
          suggestedActions: [{
            type: 'save_outline',
            label: `保存章纲到大纲维度`,
            data: { title: '章纲', content: outline },
          }],
        };
      }
      return { reply: '未在近期对话中找到章纲/大纲内容。请先让我生成章纲，然后再保存。' };
    }

    // ── 2. 生成章纲/大纲 ──
    if (/(给出|生成|设计|写|创建|规划|拟定|制定).{0,6}(章纲|大纲|三幕式|纲要|提纲)/.test(msg) ||
        /(章纲|大纲|三幕式|纲要|提纲).{0,4}(给|写|生成|设计)/.test(msg)) {
      const nextChapter = chapterCount + 1;
      return {
        reply: `好的，我将为您生成第 ${nextChapter} 章的三幕式章纲。请稍候，我来深入分析当前剧情线索。\n\n*提示：建议使用"深度思考"模式生成更高质量的章纲。*`,
        suggestedActions: [{
          type: 'agent_command',
          label: `生成第${nextChapter}章三幕式章纲`,
          data: { command: `请基于当前所有已知剧情线索和伏笔，给出第${nextChapter}章的三幕式章纲，包含起承转合、冲突点、悬念设计和角色行动。` },
        }],
      };
    }

    // ── 3. 补全/完善世界观、角色、伏笔、大纲等设定 ──
    if (/(填补|补全|补充|完善|丰富|扩展|展开|充实|增加|添加).{0,6}(世界观|大纲|角色|伏笔|设定|背景|人物|剧情线|情节)/.test(msg)) {
      return {
        reply: '正在为您编排补全任务…',
        suggestedActions: [{
          type: 'orchestrate',
          label: '智能补全设定',
          data: { instruction: msg },
        }],
      };
    }

    // ── 4. 写/续写章节 ──
    if (/(写|续写|撰写|起草|创作|开始写).{0,4}(第.{1,6}章|下一章|新章节|章节)/.test(msg) ||
        /第.{1,6}章.{0,4}(写|开始|创作)/.test(msg)) {
      const targetMatch = msg.match(/第(\d+|[一二三四五六七八九十百]+)章/);
      const label = targetMatch ? `写作第${targetMatch[1]}章` : '续写下一章';
      return {
        reply: `好的，我将为您${label}。点击下方按钮开始。`,
        suggestedActions: [{
          type: 'agent_command',
          label,
          data: { command: msg },
        }],
      };
    }

    // ── 5. 创建角色 ──
    if (/(创建|新建|添加|设计|构思).{0,4}(角色|人物|配角|主角|反派)/.test(msg)) {
      return {
        reply: '正在为您构思角色…',
        suggestedActions: [{
          type: 'orchestrate',
          label: '创建角色',
          data: { instruction: msg },
        }],
      };
    }

    // ── 6. 创建剧情线/伏笔 ──
    if (/(创建|新建|添加|设计|构思|植入|埋设).{0,4}(剧情线|伏笔|线索|暗线)/.test(msg)) {
      return {
        reply: '正在为您规划…',
        suggestedActions: [{
          type: 'orchestrate',
          label: '创建剧情线/伏笔',
          data: { instruction: msg },
        }],
      };
    }

    // ── 7. 分析/点评文本 ──
    if (/(分析|点评|评价|审阅|诊断|检查).{0,6}(文本|内容|章节|段落|文笔|风格)/.test(msg)) {
      return {
        reply: '好的，我来为您分析。',
        suggestedActions: [{
          type: 'analyze_text',
          label: '分析文本',
          data: { analysisType: 'comprehensive' },
        }],
      };
    }

    // ── 8. 润色/修改 ──
    if (/(润色|修改|优化|改进|提升|打磨|编辑).{0,6}(文本|内容|章节|段落|文笔|表达|语句)/.test(msg)) {
      return {
        reply: '好的，我来为您润色当前内容。',
        suggestedActions: [{
          type: 'agent_command',
          label: '润色内容',
          data: { command: msg },
        }],
      };
    }

    // ── 9. 继续/展开/扩写 ──
    if (/^(继续|接着写|展开|扩写|往下写|接下来)/.test(msg)) {
      return {
        reply: '好的，我来继续。',
        suggestedActions: [{
          type: 'agent_command',
          label: '继续创作',
          data: { command: msg },
        }],
      };
    }

    // ── 10. 整体规划/从零开始 ──
    if (/(从零|从头|整体规划|全书规划|重新规划|系统规划|创意方案)/.test(msg)) {
      return {
        reply: '好的，我来为您制定整体创意方案。',
        suggestedActions: [{
          type: 'creative_plan',
          label: '整体创意规划',
          data: { instruction: msg },
        }],
      };
    }

    // ── 默认回退：给出友好提示而非空回复 ──
    this.logger.warn(`classifyIntentAndFallback 未匹配到意图: "${msg.slice(0, 100)}"`);
    return {
      reply: `抱歉，我暂时无法理解您的具体需求。您可以试试以下指令：\n\n` +
        `• "给出下一章的三幕式章纲"\n` +
        `• "补全世界观设定"\n` +
        `• "续写第N章"\n` +
        `• "分析当前章节内容"\n` +
        `• "润色当前段落"\n` +
        `• "创建一个新角色"\n` +
        `• "将章纲保存到大纲维度"\n\n` +
        `请告诉我您想做什么，我会尽力帮助您。`,
    };
  }

  /**
   * 从对话历史中提取最近的章纲/大纲内容
   * 搜索 assistant 消息中包含三幕式/大纲/章纲结构化内容的最后一条
   */
  private extractOutlineFromHistory(chatHistory: Array<{ role: string; content: string }>): string | null {
    // 从后往前搜索 assistant 消息
    for (let i = chatHistory.length - 1; i >= 0; i--) {
      const msg = chatHistory[i];
      if (msg.role !== 'assistant') continue;
      const content = msg.content || '';
      // 检测是否包含章纲/大纲特征内容
      const hasOutlineKeywords = /(三幕式|起[：:—\-]|承[：:—\-]|转[：:—\-]|第一幕|第二幕|第三幕|冲突点|悬念|开端|发展|高潮|结局|章纲|大纲概要)/.test(content);
      const hasStructure = content.length > 100 && (content.includes('\n') || content.includes('。'));
      if (hasOutlineKeywords && hasStructure) {
        // 清理掉 ACTIONS 标签和尾部提示
        let cleaned = content.replace(/<!--ACTIONS:[\s\S]*?-->/g, '').trim();
        // 去掉末尾的"是否保存"类提示句
        cleaned = cleaned.replace(/[\n\r]*(需要我将|是否将|要不要|点击下方|已为您生成)[\s\S]{0,100}$/, '').trim();
        if (cleaned.length > 50) return cleaned;
      }
    }
    return null;
  }

  private async loadContext(bookId: string, chapterId?: string) {
    // 内存缓存：bookId 级别（不含 chapterId，章节摘要单独查）
    const cacheKey = bookId;
    let base: { worldSettings: any; plotLines: any; characters: any; foreshadowings: any; outlines: any };

    const cached = this.contextCache.get(cacheKey);
    if (this.contextCacheTtlMs > 0 && cached && cached.expireAt > Date.now()) {
      base = cached.data;
    } else {
      const [worldSettings, plotLines, characters, foreshadowings, outlines] = await Promise.all([
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
        this.prisma.outline.findMany({ where: { bookId }, orderBy: { order: 'asc' } }),
      ]);
      base = { worldSettings, plotLines, characters, foreshadowings, outlines };

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

  /** 将纯文本转换为 HTML 段落格式（供 TipTap 编辑器正确渲染） */
  private plainTextToHtml(text: string): string {
    if (!text) return '';
    // 已是 HTML 则直接返回
    if (/<(?:p|div|h[1-6])\b/i.test(text)) return text;
    const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    // 按双换行分段
    const paragraphs = text.split(/\n{2,}/).filter(p => p.trim());
    if (paragraphs.length === 0) return '<p></p>';
    const result: string[] = [];
    for (const p of paragraphs) {
      const lines = p.trim().split('\n').filter(l => l.trim());
      for (const line of lines) {
        result.push(`<p>${escape(line.trim())}</p>`);
      }
    }
    return result.join('');
  }

  // ==================== Agent 调用 ====================

  private async callAgent(
    type: AgentType,
    prompt: string,
    temperature?: number,
    options?: { maxTokens?: number; timeoutMs?: number; systemPrompt?: string; useFastModel?: boolean; modelOverride?: string; chatHistory?: Array<{ role: string; content: string }> },
  ): Promise<AgentResponse> {
    const maxTokens = options?.maxTokens ?? 2000;
    const timeoutMs = options?.timeoutMs ?? 120000;
    const useFast = options?.useFastModel && this.fastModel;
    const selectedModel = options?.modelOverride
      ? this.resolveModel(options.modelOverride)
      : useFast
        ? this.fastModel
        : this.model;

    const endpoint = this.resolveEndpoint(selectedModel);

    this.logger.log(
      `[callAgent] ${type} | model=${endpoint.model} | endpoint=${endpoint.url} | maxTokens=${maxTokens} | timeout=${timeoutMs}ms | prompt=${prompt.length}chars`,
    );

    // 最多重试 2 次（共 3 次尝试），仅对瞬态错误重试
    const MAX_RETRIES = 2;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const startTime = Date.now();
        const messages: Array<{ role: string; content: string }> = [
          { role: 'system', content: options?.systemPrompt ?? this.getSystemPrompt(type) },
          ...(options?.chatHistory || []),
          { role: 'user', content: prompt },
        ];
        const response = await axios.post(
          endpoint.url,
          {
            model: endpoint.model,
            messages,
            temperature: temperature ?? this.getTemperature(type),
            max_tokens: maxTokens,
          },
          {
            headers: {
              Authorization: `Bearer ${endpoint.key}`,
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

  // ==================== 多步编排执行引擎 ====================

  /**
   * 多步编排流式执行 — 模仿 Copilot 的任务分解→逐步思考→确认→执行流程
   *
   * SSE 事件协议：
   * - step_plan:     { steps: [{ id, title, description, type }] }           — 任务分解结果
   * - step_start:    { stepId, title, description }                          — 开始执行某步
   * - step_thinking: { stepId, text }                                        — 该步的流式思考内容
   * - step_result:   { stepId, summary, data?, needsConfirm? }               — 步骤结果/预览
   * - step_done:     { stepId, success, message }                            — 步骤完成
   * - done:          { summary, createdIds }                                 — 全部完成
   * - error:         { message }                                             — 异常
   */
  async streamOrchestrate(
    bookId: string,
    message: string,
    onEvent: (event: { type: string; data: any }) => void,
    chapterId?: string,
    currentContent?: string,
    modelId?: string,
    approvedSteps?: Array<{ id: string; title: string; description: string; type: string }>,
  ): Promise<void> {
    const startTime = Date.now();

    // 1. 加载全量上下文
    this.invalidateContextCache(bookId);
    const context = await this.loadContext(bookId, chapterId);

    const allChapters = await this.prisma.chapter.findMany({
      where: { bookId },
      orderBy: { order: 'asc' },
      select: { id: true, title: true, order: true, wordCount: true, status: true, content: true },
    });

    // 构建上下文摘要
    const chaptersOverview = this.buildChaptersOverview(allChapters as any, chapterId);

    const chapterContents = allChapters
      .filter((c: any) => c.content && c.content.length > 0)
      .map((c: any) => `【第${c.order}章 ${c.title}】\n${typeof c.content === 'string' ? c.content.slice(0, 3000) : ''}`)
      .join('\n\n---\n\n');

    const characterDetails = (context.characters || []).map((c: any) => {
      const profile = c.profile;
      const parts = [`「${c.name}」(${c.role || 'supporting'})`];
      if (profile?.personality) parts.push(`性格: ${profile.personality}`);
      if (profile?.currentGoal) parts.push(`目标: ${profile.currentGoal}`);
      if (profile?.background) parts.push(`背景: ${(profile.background || '').slice(0, 80)}`);
      if (profile?.strength) parts.push(`优势: ${profile.strength}`);
      if (profile?.weakness) parts.push(`弱点: ${profile.weakness}`);
      return parts.join(' | ');
    }).join('\n') || '尚无角色';

    const worldDetail = (context.worldSettings || []).map((ws: any) => {
      const parts: string[] = [];
      if (ws.genre) parts.push(`类型: ${ws.genre}`);
      if (ws.theme) parts.push(`主题/背景: ${ws.theme}`);
      if (ws.tone) parts.push(`基调: ${ws.tone}`);
      return parts.join(' | ');
    }).join('; ') || '未设定';

    const plotlineDetail = (context.plotLines || []).map((pl: any) =>
      `[${pl.type}]「${pl.title}」: ${(pl.description || '').slice(0, 120)}`
    ).join('\n') || '无';

    const foreshadowingDetail = (context.foreshadowings || []).map((f: any) =>
      `「${f.title}」(${f.status}): ${(f.content || '').slice(0, 80)}`
    ).join('\n') || '无';

    const outlineDetail = (context.outlines || []).map((o: any) =>
      `${o.order}. 「${o.title}」: ${(o.content || '').slice(0, 150)}`
    ).join('\n') || '无';

    const contentSnippet = currentContent
      ? (currentContent.length > 1500 ? `...${currentContent.slice(-1500)}` : currentContent)
      : '';

    const currentChapter = chapterId ? allChapters.find((c: any) => c.id === chapterId) : null;

    // 2. Phase 1 — 使用 AI 分解任务为多步执行计划
    onEvent({ type: 'phase', data: { phase: 'planning', message: '正在分析任务并制定执行计划...' } });

    const planSystemPrompt = `你是一个专业的AI小说创作编排器。你的任务是将用户的创作请求分解为具体可执行的子任务清单。

══════ 当前书籍完整状态 ══════
📚 世界观: ${worldDetail}
👥 角色 (${(context.characters || []).length}):
${characterDetails}
📖 剧情线 (${(context.plotLines || []).length}):
${plotlineDetail}
🔮 伏笔 (${(context.foreshadowings || []).length}):
${foreshadowingDetail}
📝 章纲/大纲 (${(context.outlines || []).length}):
${outlineDetail}
📋 章节列表 (${allChapters.length}章):
${chaptersOverview}
${currentChapter ? `✏️ 当前编辑: 第${currentChapter.order}章「${currentChapter.title}」` : ''}
${contentSnippet ? `--- 近期内容 ---\n${contentSnippet.slice(0, 600)}\n---` : ''}

══════ 输出要求 ══════
请将用户请求分解为 3-8 个有序子任务，每个子任务是一个具体可执行的步骤。

规则：
1. 第一步必须是"阅读与分析当前状态"（读取相关设定/章节/角色）
2. 【前置补全规则——用外在补全内在】分析步骤完成后，检查以下要素是否缺失或不完整：
   - 如果世界观为空（"未设定"或0条），必须添加 update_world 步骤来根据现有章节内容提取、补全世界观
   - 如果角色为空（0个）或角色数量明显少于章节内容中出场角色，必须添加 update_character 步骤来从现有章节中提取和创建角色
   - 如果剧情线为空（0条），必须添加 update_plotline 步骤来从现有章节中梳理剧情线
   - 如果伏笔为空（0条），必须添加 update_foreshadowing 步骤来从现有章节中提取和创建伏笔
   - 如果章纲/大纲为空或不含即将编写的章节大纲，必须添加 create_outline 步骤
3. 如果用户要求编写新章节，必须在 write_chapter 之前安排 create_outline 步骤来编写该章节的章纲
4. 【后置同步规则——内外在自洽】如果计划中包含 write_chapter，其后必须安排一个 sync_internals 步骤。此步骤会根据新写章节内容反向更新内在设定（角色状态、剧情线进展、伏笔植入/回收、章纲标注），确保内外在始终一致。
5. 最后一步推荐为 consistency_check 做一致性验证
6. 每步需有具体目标，不能过于笼统
7. 每一步都会让用户确认后才执行，所以请大胆分解
8. 【纯补全模式】如果用户只是要求补全/填补设定（世界观、角色、大纲、伏笔等）而没有要求写新章节，则不需要 write_chapter 和 sync_internals 步骤，只需要 read + 对应的 update_* / create_outline 步骤 + consistency_check

你的输出必须严格为以下 JSON 格式，不要添加任何 markdown 标记或额外文字:
[
  {
    "id": "step_1",
    "title": "步骤标题（10字以内）",
    "description": "详细描述这一步要做什么（1-2句话）",
    "type": "read|update_world|update_character|update_plotline|update_foreshadowing|create_outline|write_chapter|consistency_check"
  }
]

type 说明:
- read: 阅读并综合分析现有内容
- update_world: 更新世界观设定（若缺失则从章节内容中提取补全）
- update_character: 创建/更新角色信息（若缺失则从章节内容中提取补全）
- update_plotline: 创建/更新剧情线（若缺失则从章节内容中梳理补全）
- update_foreshadowing: 处理伏笔（植入/回收）
- create_outline: 编写/更新章节大纲/章纲（会保存到数据库，写新章前必须先有章纲）
- write_chapter: 编写章节正文（会创建新章节）
- sync_internals: 写完章节后同步内在设定（根据新章节内容更新角色状态、剧情线进展、标注伏笔、更新章纲完成状态）
- consistency_check: 一致性检查

【典型步骤顺序】read → update_world → update_character → update_plotline → create_outline → write_chapter → sync_internals → consistency_check
缺少的内在要素才需要补全步骤，已有的可跳过。write_chapter 后的 sync_internals 不可省略。`;

    let steps: Array<{ id: string; title: string; description: string; type: string }> = [];

    // ---- 判断是规划模式还是执行模式 ----
    if (approvedSteps?.length) {
      // 执行模式：用户已确认计划，直接执行
      steps = approvedSteps;
      onEvent({ type: 'phase', data: { phase: 'executing', message: '开始执行已确认的步骤...' } });
      onEvent({ type: 'step_plan', data: { steps } });
    } else {
      // 规划模式：AI 分解任务
      try {
        const planRaw = await this.streamCallAgent(
          AgentType.PLANNER,
          `请分解以下创作请求为多步执行计划:\n\n「${message}」`,
          0.4,
          { maxTokens: 1500, timeoutMs: 60000, systemPrompt: planSystemPrompt, useFastModel: true },
          (_chunk) => {
            // content 是 JSON 输出，不推送给用户（仅内部累积）
          },
          (thinkChunk) => {
            // 仅推送 reasoning_content 作为思考过程
            onEvent({ type: 'plan_thinking', data: { text: thinkChunk } });
          },
        );

        // 提取 JSON
        const jsonMatch = planRaw.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          steps = JSON.parse(jsonMatch[0]);
        }
      } catch (err: any) {
        this.logger.error(`[Orchestrate] 任务分解失败: ${err.message}`);
        onEvent({ type: 'error', data: { message: `任务分解失败: ${err.message}` } });
        return;
      }

      if (!steps.length) {
        onEvent({ type: 'error', data: { message: '无法分解任务，请尝试更明确的描述' } });
        return;
      }

      // 推送任务计划并等待用户确认
      onEvent({ type: 'step_plan', data: { steps } });
      onEvent({ type: 'await_approval', data: { steps, message: '请确认执行计划后开始执行' } });
      return;  // 停止，等待用户确认后再次调用
    }

    // 3. Phase 2 — 逐步执行，每步包含思考+结果
    const executionContext: Record<string, any> = {
      bookId,
      chapterId,
      currentContent,
      allChapters,
      context,
      worldDetail,
      characterDetails,
      plotlineDetail,
      foreshadowingDetail,
      outlineDetail,
      chaptersOverview,
      chapterContents,
      accumulatedInsights: '',   // 前序步骤的累积发现
      createdIds: { characters: [] as string[], plotLines: [] as string[], foreshadowings: [] as string[], chapters: [] as string[], outlines: [] as string[] },
      updatedElements: [] as string[],
    };

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];

      // 推送步骤开始
      onEvent({ type: 'step_start', data: { stepId: step.id, stepIndex: i, title: step.title, description: step.description, type: step.type } });

      try {
        await this.executeOrchestrationStep(
          step,
          i,
          steps,
          executionContext,
          onEvent,
          modelId,
          message,
        );

        onEvent({ type: 'step_done', data: { stepId: step.id, stepIndex: i, success: true } });
      } catch (err: any) {
        this.logger.error(`[Orchestrate] 步骤 ${step.id} 执行失败: ${err.message}`);
        onEvent({ type: 'step_done', data: { stepId: step.id, stepIndex: i, success: false, message: err.message } });
        // 继续执行后续步骤而不中断
      }
    }

    // 4. 全部完成
    const duration = Date.now() - startTime;
    onEvent({ type: 'done', data: {
      summary: `多步编排完成，共 ${steps.length} 步，耗时 ${Math.round(duration / 1000)}s`,
      createdIds: executionContext.createdIds,
      updatedElements: executionContext.updatedElements,
    } });

    // 记录日志
    await this.logSession(
      bookId,
      chapterId,
      'ORCHESTRATE',
      JSON.stringify({ message, steps: steps.length }),
      JSON.stringify({ createdIds: executionContext.createdIds, updatedElements: executionContext.updatedElements }),
      'COMPLETED',
      duration,
    );
  }

  /**
   * 执行单个编排步骤 — 思考 + 执行 + 结果
   */
  private async executeOrchestrationStep(
    step: { id: string; title: string; description: string; type: string },
    stepIndex: number,
    allSteps: Array<{ id: string; title: string; description: string; type: string }>,
    ctx: Record<string, any>,
    onEvent: (event: { type: string; data: any }) => void,
    modelId?: string,
    userMessage?: string,
  ): Promise<void> {
    const stepsContext = allSteps.map((s, i) =>
      `${i + 1}. [${i < stepIndex ? '✅已完成' : i === stepIndex ? '▶当前' : '⏳待执行'}] ${s.title}: ${s.description}`
    ).join('\n');

    const baseContext = `
══════ 书籍状态 ══════
📚 世界观: ${ctx.worldDetail}
👥 角色: ${ctx.characterDetails}
📖 剧情线: ${ctx.plotlineDetail}
🔮 伏笔: ${ctx.foreshadowingDetail}
� 章纲/大纲: ${ctx.outlineDetail || '无'}
�📋 章节: ${ctx.chaptersOverview}
${ctx.accumulatedInsights ? `\n══════ 前序步骤的发现 ══════\n${ctx.accumulatedInsights}` : ''}

══════ 执行计划 ══════
${stepsContext}

用户原始请求: 「${userMessage}」
当前执行: 第${stepIndex + 1}步 - ${step.title}
步骤描述: ${step.description}`;

    switch (step.type) {
      case 'read': {
        // 阅读并综合分析
        const readPrompt = `你正在执行多步创作流程的第${stepIndex + 1}步：【阅读与分析】。

${baseContext}

${ctx.chapterContents ? `══════ 已有章节内容 ══════\n${ctx.chapterContents.slice(0, 8000)}\n` : ''}

请仔细阅读上述所有信息，输出你的分析：
1. 当前故事发展到什么阶段？关键情节线索？
2. 各角色的当前状态和发展方向？
3. 有哪些伏笔待回收？有哪些逻辑需注意？
4. 针对用户请求，需要特别关注什么？
5. 对后续步骤的建议（哪些设定需要调整/补充）

要求简洁有条理，不超过500字。`;

        const thinking = await this.streamCallAgent(
          AgentType.PLANNER,
          readPrompt,
          0.4,
          { maxTokens: 1000, timeoutMs: 60000, systemPrompt: '你是一个专业的小说分析师，负责阅读和梳理故事信息。', useFastModel: true },
          (chunk) => { onEvent({ type: 'step_thinking', data: { stepId: step.id, text: chunk } }); },
          (thinkChunk) => { onEvent({ type: 'step_thinking', data: { stepId: step.id, text: thinkChunk } }); },
        );

        ctx.accumulatedInsights += `\n[阅读分析] ${thinking.slice(0, 600)}`;
        onEvent({ type: 'step_result', data: { stepId: step.id, summary: thinking } });
        break;
      }

      case 'update_world': {
        const worldPrompt = `你正在执行多步创作流程的第${stepIndex + 1}步：【更新世界观设定】。

${baseContext}

${ctx.chapterContents ? `══════ 已有章节内容 ══════\n${ctx.chapterContents.slice(0, 6000)}\n` : ''}

请根据用户请求、前序分析和现有章节内容，从中提取并构建完整的世界观设定。

【要求】世界观必须包含以下维度的详细描述：
1. genre（题材分类）：如修仙、玄幻、科幻、都市等
2. theme（主题与世界背景）：必须是详尽的多段落描述（至少300字），包含：
   - 世界整体背景与时代设定
   - 力量体系/修炼体系/科技体系的详细规则和等级划分
   - 地理环境/重要地点/势力分布
   - 社会结构/门派体系/政治格局
   - 特殊规则/禁忌/世界运行法则
   - 重要的历史背景和传说
3. tone（基调/风格）：如热血、暗黑、轻松、严肃等

输出格式（严格 JSON，不要 markdown 标记）:
{"action":"create或update","genre":"准确的类型","theme":"详尽的世界背景描述（至少300字，包含力量体系、地理、势力、规则等多个方面）","tone":"基调描述","reasoning":"更新理由（1-2句）"}

如果不需要修改，输出: {"action":"skip","reasoning":"原因"}

【重要】theme 字段是世界观的核心，必须非常详细，涵盖上述所有维度。不要只写简单的一句话概括。`;

        const worldThinking = await this.streamCallAgent(
          AgentType.PLANNER,
          worldPrompt,
          0.5,
          { maxTokens: 800, timeoutMs: 60000, systemPrompt: '你是一个世界观设计专家。只输出 JSON。', useFastModel: true },
          (_chunk) => { /* JSON 输出不推送 */ },
          (thinkChunk) => { onEvent({ type: 'step_thinking', data: { stepId: step.id, text: thinkChunk } }); },
        );

        try {
          const jsonMatch = worldThinking.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const data = JSON.parse(jsonMatch[0]);
            if (data.action === 'skip') {
              onEvent({ type: 'step_result', data: { stepId: step.id, summary: `世界观保持不变: ${data.reasoning}` } });
            } else {
              const existingWs = (ctx.context.worldSettings || [])[0];
              if (existingWs) {
                await this.plannerService.updateWorldSetting(existingWs.id, {
                  ...(data.genre ? { genre: data.genre } : {}),
                  ...(data.theme ? { theme: data.theme } : {}),
                  ...(data.tone ? { tone: data.tone } : {}),
                });
                ctx.updatedElements.push(`世界观已更新`);
                onEvent({ type: 'step_result', data: { stepId: step.id, summary: `世界观已更新: ${data.reasoning}`, updated: true } });
              } else {
                const ws = await this.plannerService.createWorldSetting(ctx.bookId, {
                  genre: data.genre || '', theme: data.theme || '', tone: data.tone || '',
                });
                ctx.updatedElements.push(`世界观已创建`);
                onEvent({ type: 'step_result', data: { stepId: step.id, summary: `世界观已创建: ${data.genre} ${data.theme}`, created: true } });
              }
              this.invalidateContextCache(ctx.bookId);
            }
          }
        } catch { onEvent({ type: 'step_result', data: { stepId: step.id, summary: worldThinking } }); }
        ctx.accumulatedInsights += `\n[世界观] ${worldThinking.slice(0, 200)}`;
        break;
      }

      case 'update_character': {
        const charPrompt = `你正在执行多步创作流程的第${stepIndex + 1}步：【更新角色设定】。

${baseContext}

${ctx.chapterContents ? `══════ 已有章节内容 ══════\n${ctx.chapterContents.slice(0, 6000)}\n` : ''}

请根据用户请求、前序分析和现有章节内容，全面提取并构建角色设定。

【要求】每个角色必须包含以下维度的详细信息：
1. name: 角色名字
2. role: protagonist(主角)/antagonist(反派)/supporting(配角)
3. personality: 详细的性格描述（至少50字），包括核心性格特质、处事风格、情感表达方式
4. background: 完整的背景故事（至少80字），包括出身、经历、与其他角色的历史关系
5. goal: 当前目标（当前阶段角色想达成什么）
6. longTermGoal: 长期/终极目标
7. motivation: 核心驱动力（为什么追求这个目标）
8. strength: 优势/能力描述（包括战斗能力、特殊技能、性格优势等）
9. weakness: 弱点/短板（包括性格缺陷、能力限制、致命弱点）
10. fear: 恐惧/忌讳（角色最害怕什么、回避什么）
11. appearance: 外貌特征描述（身材、面容、标志性特征等）
12. arc: 成长弧线（角色从开始到现在的变化轨迹，或预期发展方向）

输出格式（严格 JSON 数组，不要 markdown 标记）:
[{"action":"create或update或skip","name":"角色名","role":"protagonist/antagonist/supporting","personality":"详细性格描述","background":"完整背景故事","goal":"当前目标","longTermGoal":"长期目标","motivation":"核心驱动力","strength":"优势能力","weakness":"弱点短板","fear":"恐惧忌讳","appearance":"外貌描述","arc":"成长弧线","reasoning":"操作理由"}]

不需要修改的角色不要列出。如果完全不需要角色操作，输出空数组: []
【重要】每个字段都必须有实质性内容，不要留空或只写简单几个字。从章节内容中提取具体细节。`;

        const charThinking = await this.streamCallAgent(
          AgentType.CHARACTER,
          charPrompt,
          0.5,
          { maxTokens: 1500, timeoutMs: 60000, systemPrompt: '你是一个角色设计专家。只输出 JSON。', useFastModel: true },
          (_chunk) => { /* JSON 输出不推送 */ },
          (thinkChunk) => { onEvent({ type: 'step_thinking', data: { stepId: step.id, text: thinkChunk } }); },
        );

        try {
          const jsonMatch = charThinking.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            const charOps = JSON.parse(jsonMatch[0]);
            for (const op of charOps) {
              if (op.action === 'skip') continue;
              if (op.action === 'create') {
                const char = await this.prisma.character.create({
                  data: { bookId: ctx.bookId, name: op.name, role: op.role || 'supporting', bio: `${op.personality || ''}\n${op.background || ''}` },
                });
                await this.characterService.upsertCharacterProfile(char.id, {
                  personality: op.personality || '',
                  background: op.background || '',
                  currentGoal: op.goal || '',
                  longTermGoal: op.longTermGoal || '',
                  motivation: op.motivation || '',
                  strength: op.strength || '',
                  weakness: op.weakness || '',
                  fear: op.fear || '',
                  appearance: op.appearance || '',
                  arc: op.arc || '',
                });
                ctx.createdIds.characters.push(char.id);
                ctx.updatedElements.push(`角色「${op.name}」已创建`);
              } else if (op.action === 'update') {
                const existing = (ctx.context.characters || []).find((c: any) => c.name === op.name);
                if (existing?.profile || existing) {
                  await this.characterService.upsertCharacterProfile(existing.id, {
                    ...(op.personality ? { personality: op.personality } : {}),
                    ...(op.background ? { background: op.background } : {}),
                    ...(op.goal ? { currentGoal: op.goal } : {}),
                    ...(op.longTermGoal ? { longTermGoal: op.longTermGoal } : {}),
                    ...(op.motivation ? { motivation: op.motivation } : {}),
                    ...(op.strength ? { strength: op.strength } : {}),
                    ...(op.weakness ? { weakness: op.weakness } : {}),
                    ...(op.fear ? { fear: op.fear } : {}),
                    ...(op.appearance ? { appearance: op.appearance } : {}),
                    ...(op.arc ? { arc: op.arc } : {}),
                  });
                  ctx.updatedElements.push(`角色「${op.name}」已更新`);
                }
              }
            }
            this.invalidateContextCache(ctx.bookId);
            const summary = charOps.filter((o: any) => o.action !== 'skip')
              .map((o: any) => `${o.action === 'create' ? '创建' : '更新'}「${o.name}」: ${o.reasoning}`)
              .join('\n') || '无需角色变更';
            onEvent({ type: 'step_result', data: { stepId: step.id, summary } });
          }
        } catch { onEvent({ type: 'step_result', data: { stepId: step.id, summary: charThinking } }); }
        ctx.accumulatedInsights += `\n[角色] ${charThinking.slice(0, 200)}`;
        break;
      }

      case 'update_plotline': {
        const plotPrompt = `你正在执行多步创作流程的第${stepIndex + 1}步：【更新剧情线】。

${baseContext}

${ctx.chapterContents ? `══════ 已有章节内容 ══════\n${ctx.chapterContents.slice(0, 6000)}\n` : ''}

请根据用户请求、前序分析和现有章节内容，全面梳理并构建剧情线。

【要求】每条剧情线必须包含以下详细信息：
1. title: 剧情线标题（简洁有力，体现核心冲突）
2. type: MAIN(主线)/SUB(副线)/HIDDEN(暗线)
3. description: 详细描述（至少100字），必须包含：
   - 剧情线的核心冲突和驱动力
   - 当前进展阶段（已发生的关键事件）
   - 涉及的主要角色及其立场
   - 悬念和未解之谜
   - 预期发展方向
   - 与其他剧情线的关联

输出格式（严格 JSON 数组）:
[{"action":"create或update或skip","title":"剧情线标题","type":"MAIN或SUB或HIDDEN","description":"详细描述（至少100字）","reasoning":"操作理由"}]

输出空数组表示无需操作: []
【重要】description 必须详细，要体现剧情的发展脉络，不要只写简单的一句话。`;

        const plotThinking = await this.streamCallAgent(
          AgentType.PLANNER,
          plotPrompt,
          0.5,
          { maxTokens: 1000, timeoutMs: 60000, systemPrompt: '你是一个剧情线设计专家。只输出 JSON。', useFastModel: true },
          (_chunk) => { /* JSON 输出不推送 */ },
          (thinkChunk) => { onEvent({ type: 'step_thinking', data: { stepId: step.id, text: thinkChunk } }); },
        );

        try {
          const jsonMatch = plotThinking.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            const plotOps = JSON.parse(jsonMatch[0]);
            for (const op of plotOps) {
              if (op.action === 'skip') continue;
              if (op.action === 'create') {
                const pl = await this.plannerService.createPlotLine(ctx.bookId, {
                  title: op.title, description: op.description, type: op.type || 'MAIN',
                });
                ctx.createdIds.plotLines.push(pl.id);
                ctx.updatedElements.push(`剧情线「${op.title}」已创建`);
              } else if (op.action === 'update') {
                const existing = (ctx.context.plotLines || []).find((p: any) => p.title === op.title);
                if (existing) {
                  await this.plannerService.updatePlotLine(existing.id, { description: op.description });
                  ctx.updatedElements.push(`剧情线「${op.title}」已更新`);
                }
              }
            }
            this.invalidateContextCache(ctx.bookId);
            const summary = plotOps.filter((o: any) => o.action !== 'skip')
              .map((o: any) => `${o.action === 'create' ? '创建' : '更新'}「${o.title}」`)
              .join('\n') || '无需剧情线变更';
            onEvent({ type: 'step_result', data: { stepId: step.id, summary } });
          }
        } catch { onEvent({ type: 'step_result', data: { stepId: step.id, summary: plotThinking } }); }
        ctx.accumulatedInsights += `\n[剧情线] ${plotThinking.slice(0, 200)}`;
        break;
      }

      case 'update_foreshadowing': {
        const fsPrompt = `你正在执行多步创作流程的第${stepIndex + 1}步：【处理伏笔】。

${baseContext}

${ctx.chapterContents ? `══════ 已有章节内容 ══════\n${ctx.chapterContents.slice(0, 6000)}\n` : ''}

请根据用户请求、前序分析和现有章节内容，全面提取和管理伏笔。

【要求】每个伏笔必须包含完整信息：
1. title: 伏笔名称（简洁有力）
2. content: 详细描述（至少80字），包含：
   - 伏笔在原文中的具体表现/暗示内容
   - 伏笔指向的可能真相或后续发展
   - 埋设在哪个章节/场景
   - 预期何时/如何回收
   - 与其他伏笔或剧情线的关联

输出格式（严格 JSON 数组）:
[{"action":"create或resolve或skip","title":"伏笔标题","content":"详细伏笔内容描述（至少80字）","reasoning":"操作理由"}]

输出空数组表示无需操作: []
【重要】content 必须详细，要包含伏笔的来龙去脉，不要只写一句话概括。`;

        const fsThinking = await this.streamCallAgent(
          AgentType.PLANNER,
          fsPrompt,
          0.5,
          { maxTokens: 1000, timeoutMs: 60000, systemPrompt: '你是一个伏笔设计专家。只输出 JSON。', useFastModel: true },
          (_chunk) => { /* JSON 输出不推送 */ },
          (thinkChunk) => { onEvent({ type: 'step_thinking', data: { stepId: step.id, text: thinkChunk } }); },
        );

        try {
          const jsonMatch = fsThinking.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            const fsOps = JSON.parse(jsonMatch[0]);
            for (const op of fsOps) {
              if (op.action === 'skip') continue;
              if (op.action === 'create') {
                const created = await this.plannerService.createForeshadowing(ctx.bookId, {
                  title: op.title, content: op.content,
                });
                ctx.createdIds.foreshadowings.push(created.id);
                ctx.updatedElements.push(`伏笔「${op.title}」已植入`);
              } else if (op.action === 'resolve') {
                const existing = (ctx.context.foreshadowings || []).find((f: any) => f.title === op.title);
                if (existing) {
                  await this.plannerService.resolveForeshadowing(existing.id, op.content);
                  ctx.updatedElements.push(`伏笔「${op.title}」已回收`);
                }
              }
            }
            this.invalidateContextCache(ctx.bookId);
            const summary = fsOps.filter((o: any) => o.action !== 'skip')
              .map((o: any) => `${o.action === 'create' ? '植入' : '回收'}「${o.title}」`)
              .join('\n') || '无需伏笔变更';
            onEvent({ type: 'step_result', data: { stepId: step.id, summary } });
          }
        } catch { onEvent({ type: 'step_result', data: { stepId: step.id, summary: fsThinking } }); }
        ctx.accumulatedInsights += `\n[伏笔] ${fsThinking.slice(0, 200)}`;
        break;
      }

      case 'create_outline': {
        // 获取已有章节内容以便AI参考
        let existingChapterText = ctx.chapterContents || '';
        if (!existingChapterText) {
          const chaps = await this.prisma.chapter.findMany({
            where: { bookId: ctx.bookId },
            orderBy: { order: 'asc' },
            select: { title: true, content: true, order: true },
          });
          existingChapterText = chaps
            .filter((c: any) => c.content)
            .map((c: any) => {
              const text = (c.content as string).replace(/<[^>]+>/g, '');
              return `【第${c.order}章 ${c.title}】\n${text.slice(0, 1500)}`;
            })
            .join('\n\n');
        }

        const outlinePrompt = `你正在执行多步创作流程的第${stepIndex + 1}步：【编写章节大纲/章纲】。

${baseContext}

${existingChapterText ? `══════ 已有章节内容摘要 ══════\n${existingChapterText.slice(0, 5000)}\n` : ''}

请为需要编写的章节构思详细的章纲（大纲），包含：
1. 章节标题（格式：第N章 标题）
2. 三幕式结构（起-承-转-合）
3. 主要场景和关键事件描述
4. 涉及的角色及其行为/对话要点
5. 情绪起伏曲线和节奏安排
6. 核心冲突与冲突解决
7. 需要呼应的伏笔和需要植入的新伏笔
8. 与前后章节的衔接点
9. 本章结尾悬念/钩子

【重要】你必须只输出一个 JSON 对象或 JSON 数组，不要输出任何其他文字、markdown 标记或代码块。

单章格式: {"title":"第N章 标题","content":"详细章纲（包含三幕结构、场景、角色行为、冲突点、伏笔、结尾悬念等，至少300字）"}
多章格式: [{"title":"第N章 标题","content":"..."},{"title":"第M章 标题","content":"..."}]`;

        const outlineThinking = await this.streamCallAgent(
          AgentType.PLANNER,
          outlinePrompt,
          0.7,
          { maxTokens: 2500, timeoutMs: 90000, systemPrompt: '你是一个资深小说策划，擅长构建引人入胜的章节大纲。只输出纯 JSON，不要任何 markdown 代码块标记。', modelOverride: modelId },
          (_chunk) => { /* JSON 输出不推送 */ },
          (thinkChunk) => { onEvent({ type: 'step_thinking', data: { stepId: step.id, text: thinkChunk } }); },
        );

        // 解析并持久化章纲到数据库
        let outlineSummary = outlineThinking;
        try {
          // 去除可能的 markdown 代码块标记
          const cleaned = outlineThinking.replace(/```(?:json)?\s*/gi, '').replace(/```\s*/g, '').trim();
          const arrMatch = cleaned.match(/\[\s*\{[\s\S]*\}\s*\]/);
          const objMatch = cleaned.match(/\{[\s\S]*\}/);
          const outlineItems: Array<{ title: string; content: string }> = arrMatch
            ? JSON.parse(arrMatch[0])
            : objMatch ? [JSON.parse(objMatch[0])] : [];

          const summaryParts: string[] = [];
          for (const item of outlineItems) {
            // 查找是否已有同名大纲
            const existing = await this.prisma.outline.findFirst({
              where: { bookId: ctx.bookId, title: item.title },
            });
            if (existing) {
              await this.prisma.outline.update({
                where: { id: existing.id },
                data: { content: item.content },
              });
              ctx.updatedElements.push(`章纲「${item.title}」已更新`);
              summaryParts.push(`更新章纲「${item.title}」`);
            } else {
              const maxOrder = await this.prisma.outline.aggregate({
                where: { bookId: ctx.bookId },
                _max: { order: true },
              });
              await this.prisma.outline.create({
                data: {
                  bookId: ctx.bookId,
                  title: item.title,
                  content: item.content,
                  order: (maxOrder._max.order || 0) + 1,
                },
              });
              ctx.updatedElements.push(`章纲「${item.title}」已创建`);
              summaryParts.push(`创建章纲「${item.title}」`);
            }
            // 缓存章纲内容用于后续写作步骤
            ctx.chapterOutline = (ctx.chapterOutline || '') + `\n【${item.title}】\n${item.content}`;
          }
          this.invalidateContextCache(ctx.bookId);
          outlineSummary = summaryParts.join('\n') + '\n\n' + outlineItems.map(i => `【${i.title}】\n${i.content}`).join('\n\n');
        } catch {
          // JSON 解析失败，尝试以纯文本方式保存
          const titleMatch = step.description.match(/第[\d一二三四五六七八九十百]+章/) || step.title.match(/第[\d一二三四五六七八九十百]+章/);
          const outlineTitle = titleMatch ? `${titleMatch[0]} 章纲` : `章纲 - ${step.title}`;
          const maxOrder = await this.prisma.outline.aggregate({
            where: { bookId: ctx.bookId },
            _max: { order: true },
          });
          await this.prisma.outline.create({
            data: {
              bookId: ctx.bookId,
              title: outlineTitle,
              content: outlineThinking,
              order: (maxOrder._max.order || 0) + 1,
            },
          });
          ctx.updatedElements.push(`章纲「${outlineTitle}」已创建`);
          ctx.chapterOutline = outlineThinking;
          this.invalidateContextCache(ctx.bookId);
        }

        ctx.accumulatedInsights += `\n[章纲] ${outlineSummary.slice(0, 400)}`;
        onEvent({ type: 'step_result', data: { stepId: step.id, summary: outlineSummary } });
        break;
      }

      case 'write_chapter': {
        // 刷新上下文以获取最新信息
        this.invalidateContextCache(ctx.bookId);
        const freshContext = await this.loadContext(ctx.bookId, ctx.chapterId);

        const recentChapters = ctx.allChapters
          .filter((c: any) => c.content && c.content.length > 0)
          .slice(-3)
          .map((c: any) => `【第${c.order}章 ${c.title}】\n${typeof c.content === 'string' ? c.content.slice(-2000) : ''}`)
          .join('\n\n---\n\n');

        const writePrompt = `你正在执行多步创作流程的最终步骤：【编写章节正文】。

${baseContext}

${ctx.chapterOutline ? `══════ 本章章纲 ══════\n${ctx.chapterOutline}\n` : ''}
${recentChapters ? `══════ 近几章内容（用于衔接） ══════\n${recentChapters}\n` : ''}

══════ 写作要求 ══════
1. 严格按照章纲编写，确保所有设定一致
2. 注意与前文的衔接，语言风格保持一致
3. 角色言行符合其性格设定
4. 适当呼应已有伏笔，植入新的悬念
5. 注意节奏张弛，场景切换自然
6. 字数要求：2000-4000字

【重要】直接输出小说正文，不要输出任何思考过程、分析、标记或元信息。不要以"用户让我"、"根据要求"等开头。第一个字就是小说正文内容。`;

        let chapterText = '';
        await this.streamCallAgent(
          AgentType.WRITER,
          writePrompt,
          0.75,
          { maxTokens: 6000, timeoutMs: 180000, systemPrompt: '你是一个资深网络小说作家，文笔流畅，擅长叙事和对话描写。你只输出小说正文，绝不输出任何分析、思考或元描述。', modelOverride: modelId },
          (chunk) => {
            chapterText += chunk;
            onEvent({ type: 'step_thinking', data: { stepId: step.id, text: chunk } });
          },
          (thinkChunk) => {
            // reasoning_content 仅展示给用户，不计入章节内容
            onEvent({ type: 'step_thinking', data: { stepId: step.id, text: thinkChunk } });
          },
        );

        // 清理内容：去除可能混入的 <think> 标签和 AI 元描述
        chapterText = chapterText
          .replace(/<think>[\s\S]*?<\/think>/g, '')
          .replace(/^(用户|根据用户|以下是|下面是|让我|好的|收到)[\s\S]*?\n\n/i, '')
          .trim();

        // 始终创建新章节（不覆盖当前编辑的章节）
        // 重新查询最新章节列表以获取正确的章节数
        const latestChapters = await this.prisma.chapter.findMany({
          where: { bookId: ctx.bookId },
          orderBy: { order: 'asc' },
          select: { id: true, title: true, order: true },
        });
        const nextOrder = latestChapters.length > 0
          ? Math.max(...latestChapters.map((c: any) => c.order)) + 1
          : 1;

        // 从步骤标题提取章节标题
        let chapterTitle = `第${nextOrder}章`;
        const titleMatch = step.title.match(/第[\d一二三四五六七八九十百]+章/);
        if (titleMatch) {
          chapterTitle = titleMatch[0];
        } else if (step.description) {
          const descMatch = step.description.match(/第[\d一二三四五六七八九十百]+章/);
          if (descMatch) chapterTitle = descMatch[0];
        }

        // 转换为 HTML 格式，确保编辑器能正确渲染分段
        const chapterHtml = this.plainTextToHtml(chapterText);

        const chapter = await this.prisma.chapter.create({
          data: {
            bookId: ctx.bookId,
            title: chapterTitle,
            content: chapterHtml,
            order: nextOrder,
            status: 'DRAFT',
            wordCount: chapterText.length,
          },
        });
        ctx.createdIds.chapters.push(chapter.id);
        ctx.updatedElements.push(`新章节「${chapterTitle}」已创建 (${chapterText.length}字)`);

        // 缓存新章节内容供 sync_internals 步骤使用
        ctx.newChapterContent = chapterText;
        ctx.newChapterTitle = chapterTitle;
        ctx.newChapterId = chapter.id;

        onEvent({ type: 'step_result', data: {
          stepId: step.id,
          summary: `新章节「${chapterTitle}」已创建 (${chapterText.length}字)`,
          content: chapterText,
          wordCount: chapterText.length,
        } });
        break;
      }

      case 'sync_internals': {
        // 写完章节后反向同步内在设定：角色状态、剧情线进展、伏笔、章纲标注
        this.invalidateContextCache(ctx.bookId);
        const freshCtx = await this.loadContext(ctx.bookId);

        const chapterContent = ctx.newChapterContent || '';
        const chapterTitle = ctx.newChapterTitle || '';

        if (!chapterContent) {
          onEvent({ type: 'step_result', data: { stepId: step.id, summary: '无新章节内容，跳过内在同步' } });
          break;
        }

        // 当角色/伏笔/章纲为空时，需要扫描所有章节内容来提取
        const needFullScan = (freshCtx.characters || []).length === 0
          || (freshCtx.foreshadowings || []).length === 0
          || (freshCtx.outlines || []).length === 0;
        let allChapterTexts = '';
        if (needFullScan) {
          const allChaps = await this.prisma.chapter.findMany({
            where: { bookId: ctx.bookId },
            orderBy: { order: 'asc' },
            select: { title: true, content: true, order: true },
          });
          allChapterTexts = allChaps
            .filter((c: any) => c.content)
            .map((c: any) => {
              // 去除 HTML 标签提取纯文本
              const text = (c.content as string).replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
              return `【第${c.order}章 ${c.title}】\n${text.slice(0, 2000)}`;
            })
            .join('\n\n');
        }

        // 获取当前所有内在设定的精简信息
        const existingChars = (freshCtx.characters || []).map((c: any) => {
          const p = c.profile;
          return `${c.name} (${c.id}) [${p?.role || c.role || 'supporting'}]: ${p?.personality || ''} | 目标: ${p?.currentGoal || '未设定'}`;
        }).join('\n') || '无';
        const existingPlots = (freshCtx.plotLines || []).map((p: any) =>
          `${p.title} (${p.id}) [${p.type}]: ${(p.description || '').slice(0, 100)}`
        ).join('\n') || '无';
        const existingFs = (freshCtx.foreshadowings || []).map((f: any) =>
          `${f.title} (${f.id}) [${f.status}]: ${(f.content || '').slice(0, 80)}`
        ).join('\n') || '无';
        const existingOutlines = (freshCtx.outlines || []).map((o: any) =>
          `${o.title} (${o.id}): ${(o.content || '').slice(0, 80)}`
        ).join('\n') || '无';
        const ws0 = (freshCtx.worldSettings || [])[0] as any;
        const worldInfo = ws0 ? `${ws0.genre || ''} | ${ws0.theme || ''} | ${ws0.tone || ''}` : '未设定';

        const syncPrompt = `你正在执行多步创作流程的第${stepIndex + 1}步：【内在设定同步】。

新写的章节「${chapterTitle}」内容如下：
---
${chapterContent.slice(0, 6000)}
---
${allChapterTexts ? `\n══════ 全部章节内容（用于提取缺失的角色/伏笔） ══════\n${allChapterTexts.slice(0, 12000)}\n` : ''}

══════ 当前内在设定 ══════
📚 世界观: ${worldInfo}
👥 角色:
${existingChars}
📖 剧情线:
${existingPlots}
🔮 伏笔 (待回收):
${existingFs}
📝 章纲:
${existingOutlines}

══════ 任务 ══════
请根据新章节内容，分析需要同步更新的内在设定。你需要确保内（设定）外（章节内容）完全自洽。

输出严格 JSON（不要 markdown 标记）:
{
  "characters": [
    {"action":"create或update","id":"已有角色的id或null","name":"角色名","updates":{"personality":"更新后的性格","currentGoal":"更新后的当前目标","background":"补充的背景"},"reasoning":"理由"}
  ],
  "plotlines": [
    {"action":"create或update","id":"已有剧情线的id或null","title":"标题","updates":{"description":"更新后的描述/进展"},"reasoning":"理由"}
  ],
  "foreshadowings": [
    {"action":"create或resolve","id":"待回收伏笔的id或null","title":"标题","content":"内容","reasoning":"理由"}
  ],
  "outline_update": {"title":"${chapterTitle}","summary":"本章实际内容概要（2-3句话）"},
  "world_update": null 或 {"genre":"","theme":"补充","tone":""}
}

规则：
1. 【重要】当角色为0个时，必须从所有章节内容中提取所有出场角色并 create（主角、重要配角、关键路人都要提取）
2. 当角色>0时，新出场角色 create，已有角色若有发展则 update
3. 剧情线若有推进或出现新支线，需 update 或 create
4. 本章中植入的新伏笔需 create；已呼应的旧伏笔需 resolve
5. 章纲 outline_update 需反映实际写了什么（用于对照计划和结果）
6. 世界观若本章揭示了新设定（如新地点、新势力），world_update 补充
7. 不需要变更的部分给空数组 [] 或 null
8. id 字段：更新已有元素时必须填对应的 id，新建时填 null
9. 即使角色很多，也要全部列出 create——宁多勿漏`;

        const syncThinking = await this.streamCallAgent(
          AgentType.PLANNER,
          syncPrompt,
          0.4,
          { maxTokens: 2000, timeoutMs: 90000, systemPrompt: '你是一个专业的小说设定管理员，负责保持故事设定与章节内容的一致性。只输出 JSON。', useFastModel: true },
          (_chunk) => { /* JSON 输出不推送 */ },
          (thinkChunk) => { onEvent({ type: 'step_thinking', data: { stepId: step.id, text: thinkChunk } }); },
        );

        const syncResults: string[] = [];
        try {
          const jsonMatch = syncThinking.match(/\{[\s\S]*\}/);
          if (!jsonMatch) throw new Error('No JSON found');
          const syncData = JSON.parse(jsonMatch[0]);

          // 1. 同步角色
          if (syncData.characters?.length) {
            for (const ch of syncData.characters) {
              if (ch.action === 'create' && ch.name) {
                const char = await this.prisma.character.create({
                  data: { bookId: ctx.bookId, name: ch.name, role: ch.updates?.role || 'supporting', bio: ch.updates?.personality || '' },
                });
                await this.characterService.upsertCharacterProfile(char.id, {
                  personality: ch.updates?.personality || '',
                  background: ch.updates?.background || '',
                  currentGoal: ch.updates?.currentGoal || '',
                  strength: ch.updates?.strength || '',
                  weakness: ch.updates?.weakness || '',
                });
                ctx.createdIds.characters.push(char.id);
                syncResults.push(`角色「${ch.name}」已从章节中提取并创建`);
              } else if (ch.action === 'update' && ch.id) {
                const updates: Record<string, string> = {};
                if (ch.updates?.personality) updates.personality = ch.updates.personality;
                if (ch.updates?.currentGoal) updates.currentGoal = ch.updates.currentGoal;
                if (ch.updates?.background) updates.background = ch.updates.background;
                if (ch.updates?.strength) updates.strength = ch.updates.strength;
                if (ch.updates?.weakness) updates.weakness = ch.updates.weakness;
                if (Object.keys(updates).length > 0) {
                  await this.characterService.upsertCharacterProfile(ch.id, updates);
                  syncResults.push(`角色「${ch.name}」状态已更新: ${ch.reasoning || ''}`);
                }
              }
            }
          }

          // 2. 同步剧情线
          if (syncData.plotlines?.length) {
            for (const pl of syncData.plotlines) {
              if (pl.action === 'create' && pl.title) {
                const created = await this.plannerService.createPlotLine(ctx.bookId, {
                  title: pl.title, description: pl.updates?.description || '', type: pl.updates?.type || 'SUB',
                });
                ctx.createdIds.plotLines.push(created.id);
                syncResults.push(`剧情线「${pl.title}」已从章节中提取并创建`);
              } else if (pl.action === 'update' && pl.id) {
                await this.plannerService.updatePlotLine(pl.id, { description: pl.updates?.description || '' });
                syncResults.push(`剧情线「${pl.title}」进展已更新`);
              }
            }
          }

          // 3. 同步伏笔
          if (syncData.foreshadowings?.length) {
            for (const fs of syncData.foreshadowings) {
              if (fs.action === 'create' && fs.title) {
                const created = await this.plannerService.createForeshadowing(ctx.bookId, {
                  title: fs.title, content: fs.content || '',
                });
                ctx.createdIds.foreshadowings.push(created.id);
                syncResults.push(`伏笔「${fs.title}」已植入`);
              } else if (fs.action === 'resolve' && fs.id) {
                await this.plannerService.resolveForeshadowing(fs.id, fs.content || '');
                syncResults.push(`伏笔「${fs.title}」已回收`);
              }
            }
          }

          // 4. 同步章纲（标注实际完成内容）
          if (syncData.outline_update?.title) {
            const existingOutline = await this.prisma.outline.findFirst({
              where: { bookId: ctx.bookId, title: { contains: syncData.outline_update.title.replace(/第[\d一二三四五六七八九十百]+章\s*/, '') || syncData.outline_update.title } },
            });
            const summaryNote = `\n\n【已完成】${syncData.outline_update.summary || ''}`;
            if (existingOutline) {
              await this.prisma.outline.update({
                where: { id: existingOutline.id },
                data: { content: (existingOutline.content || '') + summaryNote },
              });
              syncResults.push(`章纲「${existingOutline.title}」已标注完成状态`);
            }
          }

          // 5. 同步世界观
          if (syncData.world_update) {
            const existingWs = (freshCtx.worldSettings || [])[0] as any;
            if (existingWs) {
              const wu = syncData.world_update;
              await this.plannerService.updateWorldSetting(existingWs.id, {
                ...(wu.theme ? { theme: (existingWs.theme || '') + '\n' + wu.theme } : {}),
                ...(wu.tone ? { tone: wu.tone } : {}),
                ...(wu.genre ? { genre: wu.genre } : {}),
              });
              syncResults.push(`世界观设定已补充更新`);
            } else {
              const wu = syncData.world_update;
              await this.plannerService.createWorldSetting(ctx.bookId, {
                genre: wu.genre || '', theme: wu.theme || '', tone: wu.tone || '',
              });
              syncResults.push(`世界观设定已创建`);
            }
          }

          this.invalidateContextCache(ctx.bookId);
        } catch (err: any) {
          this.logger.warn(`[sync_internals] JSON 解析失败: ${err.message}`);
          syncResults.push(`设定同步分析完成（部分结果）: ${syncThinking.slice(0, 300)}`);
        }

        const summary = syncResults.length > 0
          ? `内在设定已同步:\n${syncResults.join('\n')}`
          : '内在设定无需更新';
        ctx.accumulatedInsights += `\n[内在同步] ${summary}`;
        ctx.updatedElements.push(...syncResults);
        onEvent({ type: 'step_result', data: { stepId: step.id, summary } });
        break;
      }

      case 'consistency_check': {
        const checkPrompt = `你正在执行多步创作流程的第${stepIndex + 1}步：【一致性检查】。

${baseContext}

${ctx.accumulatedInsights ? `══════ 本次执行的所有变更 ══════\n${ctx.updatedElements.join('\n')}\n` : ''}

请检查以下方面的一致性：
1. 新生成/修改的内容是否与世界观设定一致？
2. 角色言行是否符合性格描述？
3. 时间线是否有矛盾？
4. 伏笔是否有遗漏或矛盾？
5. 前后章节是否衔接得当？

输出检查报告，指出发现的问题和建议。简洁清晰，不超过400字。`;

        const checkResult = await this.streamCallAgent(
          AgentType.CONSISTENCY,
          checkPrompt,
          0.3,
          { maxTokens: 800, timeoutMs: 60000, systemPrompt: '你是一个严谨的内容审核编辑。', useFastModel: true },
          (chunk) => { onEvent({ type: 'step_thinking', data: { stepId: step.id, text: chunk } }); },
          (thinkChunk) => { onEvent({ type: 'step_thinking', data: { stepId: step.id, text: thinkChunk } }); },
        );

        onEvent({ type: 'step_result', data: { stepId: step.id, summary: checkResult } });
        break;
      }

      default: {
        // 通用步骤：让 AI 自由处理
        const genericPrompt = `你正在执行多步创作流程的第${stepIndex + 1}步：【${step.title}】。

${baseContext}

请执行: ${step.description}

输出你的分析和执行结果。`;

        const result = await this.streamCallAgent(
          AgentType.WRITER,
          genericPrompt,
          0.6,
          { maxTokens: 1500, timeoutMs: 90000, systemPrompt: '你是一个专业的小说创作助手。', modelOverride: modelId },
          (chunk) => { onEvent({ type: 'step_thinking', data: { stepId: step.id, text: chunk } }); },
          (thinkChunk) => { onEvent({ type: 'step_thinking', data: { stepId: step.id, text: thinkChunk } }); },
        );

        ctx.accumulatedInsights += `\n[${step.title}] ${result.slice(0, 200)}`;
        onEvent({ type: 'step_result', data: { stepId: step.id, summary: result } });
        break;
      }
    }
  }

  /**
   * 写完章节后自动同步内在设定（独立接口，供非编排路径使用）
   * 根据章节内容反向更新角色、剧情线、伏笔、章纲
   */
  async syncInternalsAfterWrite(
    bookId: string,
    chapterId: string,
    onEvent?: (event: { type: string; data: any }) => void,
  ): Promise<{ updates: string[] }> {
    const chapter = await this.prisma.chapter.findUnique({ where: { id: chapterId } });
    if (!chapter || !chapter.content) return { updates: [] };

    this.invalidateContextCache(bookId);
    const context = await this.loadContext(bookId);
    const updates: string[] = [];

    // 当角色/伏笔为空时，扫描所有章节内容
    const needFullScan = (context.characters || []).length === 0 || (context.foreshadowings || []).length === 0;
    let allChapterTexts = '';
    if (needFullScan) {
      const allChaps = await this.prisma.chapter.findMany({
        where: { bookId },
        orderBy: { order: 'asc' },
        select: { title: true, content: true, order: true },
      });
      allChapterTexts = allChaps
        .filter((c: any) => c.content)
        .map((c: any) => {
          const text = (c.content as string).replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
          return `【第${c.order}章 ${c.title}】\n${text.slice(0, 2000)}`;
        })
        .join('\n\n');
    }

    const chapterText = (chapter.content as string).replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

    const existingChars = (context.characters || []).map((c: any) => {
      const p = c.profile;
      return `${c.name} (${c.id}) [${p?.role || c.role || 'supporting'}]: ${p?.personality || ''} | 目标: ${p?.currentGoal || '未设定'}`;
    }).join('\n') || '无';
    const existingPlots = (context.plotLines || []).map((p: any) =>
      `${p.title} (${p.id}) [${p.type}]: ${(p.description || '').slice(0, 100)}`
    ).join('\n') || '无';
    const existingFs = (context.foreshadowings || []).map((f: any) =>
      `${f.title} (${f.id}) [${f.status}]: ${(f.content || '').slice(0, 80)}`
    ).join('\n') || '无';
    const ws0 = (context.worldSettings || [])[0] as any;
    const worldInfo = ws0 ? `${ws0.genre || ''} | ${ws0.theme || ''} | ${ws0.tone || ''}` : '未设定';

    const syncPrompt = `请分析章节内容，列出需要同步的内在设定。

章节「${chapter.title}」内容：
---
${chapterText.slice(0, 6000)}
---
${allChapterTexts ? `\n══════ 全部章节内容（用于提取缺失的角色/伏笔） ══════\n${allChapterTexts.slice(0, 10000)}\n` : ''}
当前内在设定：
- 世界观: ${worldInfo}
- 角色 (${(context.characters || []).length}个): ${existingChars}
- 剧情线: ${existingPlots}
- 伏笔: ${existingFs}

输出严格 JSON:
{
  "characters": [{"action":"create或update","id":"已有id或null","name":"角色名","updates":{"personality":"","currentGoal":"","background":""},"reasoning":""}],
  "plotlines": [{"action":"create或update","id":"已有id或null","title":"","updates":{"description":""},"reasoning":""}],
  "foreshadowings": [{"action":"create或resolve","id":"已有id或null","title":"","content":"","reasoning":""}],
  "world_update": null
}
【重要】当角色为0个时，必须从所有章节中提取所有出场角色并 create。不需变更的部分给空数组或null。新建角色时 id 填 null。`;

    try {
      const syncResult = await this.streamCallAgent(
        AgentType.PLANNER,
        syncPrompt,
        0.4,
        { maxTokens: 1500, timeoutMs: 60000, systemPrompt: '你是小说设定管理员，保持设定与内容一致。只输出 JSON。', useFastModel: true },
        (_chunk) => {},
        (thinkChunk) => { if (onEvent) onEvent({ type: 'thinking_token', data: thinkChunk }); },
      );

      const jsonMatch = syncResult.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return { updates };
      const data = JSON.parse(jsonMatch[0]);

      // 同步角色
      if (data.characters?.length) {
        for (const ch of data.characters) {
          if (ch.action === 'create' && ch.name) {
            const char = await this.prisma.character.create({
              data: { bookId, name: ch.name, role: ch.updates?.role || 'supporting', bio: ch.updates?.personality || '' },
            });
            await this.characterService.upsertCharacterProfile(char.id, {
              personality: ch.updates?.personality || '',
              background: ch.updates?.background || '',
              currentGoal: ch.updates?.currentGoal || '',
            });
            updates.push(`角色「${ch.name}」已创建`);
          } else if (ch.action === 'update' && ch.id) {
            const upd: Record<string, string> = {};
            if (ch.updates?.personality) upd.personality = ch.updates.personality;
            if (ch.updates?.currentGoal) upd.currentGoal = ch.updates.currentGoal;
            if (ch.updates?.background) upd.background = ch.updates.background;
            if (Object.keys(upd).length > 0) {
              await this.characterService.upsertCharacterProfile(ch.id, upd);
              updates.push(`角色「${ch.name}」已更新`);
            }
          }
        }
      }

      // 同步剧情线
      if (data.plotlines?.length) {
        for (const pl of data.plotlines) {
          if (pl.action === 'create' && pl.title) {
            await this.plannerService.createPlotLine(bookId, { title: pl.title, description: pl.updates?.description || '', type: 'SUB' });
            updates.push(`剧情线「${pl.title}」已创建`);
          } else if (pl.action === 'update' && pl.id) {
            await this.plannerService.updatePlotLine(pl.id, { description: pl.updates?.description || '' });
            updates.push(`剧情线「${pl.title}」已更新`);
          }
        }
      }

      // 同步伏笔
      if (data.foreshadowings?.length) {
        for (const fs of data.foreshadowings) {
          if (fs.action === 'create' && fs.title) {
            await this.plannerService.createForeshadowing(bookId, { title: fs.title, content: fs.content || '' });
            updates.push(`伏笔「${fs.title}」已植入`);
          } else if (fs.action === 'resolve' && fs.id) {
            await this.plannerService.resolveForeshadowing(fs.id, fs.content || '');
            updates.push(`伏笔「${fs.title}」已回收`);
          }
        }
      }

      // 同步世界观
      if (data.world_update) {
        const existingWs = (context.worldSettings || [])[0] as any;
        if (existingWs) {
          const wu = data.world_update;
          await this.plannerService.updateWorldSetting(existingWs.id, {
            ...(wu.theme ? { theme: (existingWs.theme || '') + '\n' + wu.theme } : {}),
            ...(wu.tone ? { tone: wu.tone } : {}),
          });
          updates.push(`世界观已补充`);
        }
      }

      this.invalidateContextCache(bookId);
    } catch (err: any) {
      this.logger.warn(`[syncInternals] 同步失败: ${err.message}`);
    }

    return { updates };
  }

  /**
   * 流式调用 Agent — 逐 token 返回
   * 每收到一个 chunk 回调 onChunk(text)，结束后返回完整结果
   */
  async streamCallAgent(
    type: AgentType,
    prompt: string,
    temperature: number,
    options: { maxTokens?: number; timeoutMs?: number; systemPrompt?: string; useFastModel?: boolean; modelOverride?: string; chatHistory?: Array<{ role: string; content: string }> },
    onChunk: (chunk: string) => void,
    onThinkingChunk?: (chunk: string) => void,
  ): Promise<string> {
    const maxTokens = options.maxTokens ?? 2000;
    const timeoutMs = options.timeoutMs ?? 120000;
    const useFast = options.useFastModel && this.fastModel;
    const selectedModel = options.modelOverride
      ? this.resolveModel(options.modelOverride)
      : useFast
        ? this.fastModel
        : this.model;

    const endpoint = this.resolveEndpoint(selectedModel);

    this.logger.log(`[streamCallAgent] ${type} | model=${endpoint.model} | endpoint=${endpoint.url} | maxTokens=${maxTokens} | timeout=${timeoutMs}ms`);

    // 截断过长的聊天历史消息，防止上下文溢出
    const truncatedHistory = (options.chatHistory || []).map(m => ({
      role: m.role,
      content: m.content.length > 800 ? m.content.slice(0, 800) + '...(已截断)' : m.content,
    }));

    const messages: Array<{ role: string; content: string }> = [
      { role: 'system', content: options.systemPrompt ?? this.getSystemPrompt(type) },
      ...truncatedHistory,
      { role: 'user', content: prompt },
    ];
    const response = await axios.post(
      endpoint.url,
      {
        model: endpoint.model,
        messages,
        temperature,
        max_tokens: maxTokens,
        stream: true,
      },
      {
        headers: {
          Authorization: `Bearer ${endpoint.key}`,
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
      let streamError: string | null = null;
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
            // 检测 API 返回的错误（某些提供商在流中返回错误对象而非 HTTP 错误码）
            if (parsed.error) {
              const errMsg = typeof parsed.error === 'string' ? parsed.error : (parsed.error.message || JSON.stringify(parsed.error));
              this.logger.warn(`[streamCallAgent] API 流式返回错误: ${errMsg.slice(0, 200)}`);
              streamError = errMsg;
              continue;
            }
            const delta = parsed.choices?.[0]?.delta;
            const reasoningContent = delta?.reasoning_content;
            const content = delta?.content;
            if (reasoningContent && onThinkingChunk) {
              onThinkingChunk(reasoningContent);
            }
            if (content) {
              fullText += content;
              onChunk(content);
            }
          } catch {
            /* 忽略解析错误 */
          }
        }
      });

      stream.on('end', () => {
        // 如果收到了流内错误且没有收到任何有效内容，则以错误方式结束
        if (streamError && !fullText) {
          this.logger.error(`[streamCallAgent] ${type} 流式结束但无有效内容，流内错误: ${streamError.slice(0, 200)}`);
          reject(new Error(`AI API 返回错误: ${streamError.slice(0, 100)}`));
          return;
        }
        this.logger.log(`[streamCallAgent] ${type} 流式完成 | ${fullText.length}chars${streamError ? ' (含流内错误)' : ''}`);
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

  private buildPlannerPrompt(bookId: string, content: string | undefined, context: any, userInstructions?: string): string {
    const { worldSettings, plotLines, characters, outlines } = context;

    let prompt = `# 任务：章节规划\n\n`;

    // 用户创作指令（如"根据第16章章纲编写第16章"）
    if (userInstructions) {
      prompt += `## 用户指令\n${userInstructions}\n\n`;
    }

    // 已有章纲/大纲（关键参考！用户可能要求"根据章纲编写"）
    if (outlines?.length) {
      prompt += `## 已有章纲/大纲\n`;
      (outlines as any[]).forEach((o: any) => {
        prompt += `### ${o.title}\n${(o.content || '').slice(0, 1500)}\n\n`;
      });
    }

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

    prompt += `\n请根据以上上下文（特别是已有章纲），提供章节规划建议，包括：
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
    userInstructions?: string,
  ): string {
    const { characters, foreshadowings, chapterSummary, plotLines, ragContext, outlines } = context;

    let prompt = `# 任务：写作生成\n## 指令: ${command}\n\n`;

    // 用户创作指令
    if (userInstructions) {
      prompt += `## 用户指令\n${userInstructions}\n\n`;
    }

    if (ragContext) {
      prompt += `## 检索上下文\n${ragContext}\n\n`;
    }

    if (planning) {
      prompt += `## 规划要点\n${planning}\n\n`;
    }

    // 已有章纲/大纲 — 写作时最重要的参考
    if (outlines?.length) {
      prompt += `## 章纲/大纲（请严格参照此章纲进行创作）\n`;
      (outlines as any[]).forEach((o: any) => {
        prompt += `### ${o.title}\n${(o.content || '').slice(0, 2000)}\n\n`;
      });
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
