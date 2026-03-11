import {
  Controller,
  Post,
  Put,
  Delete,
  Body,
  UseGuards,
  Get,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  BadRequestException,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { OrchestratorService, AgentRequest } from './orchestrator.service';
import { PlannerService } from '../planner/planner.service';
import { CharacterService } from '../character/character.service';
import { SceneService } from '../scene/scene.service';
import { RagService } from '../rag/rag.service';
import { ConsistencyService } from '../consistency/consistency.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  ProcessAgentDto,
  GenerateContinueDto,
  PlannerUpdateDto,
  CreateWorldSettingDto,
  UpdateWorldSettingDto,
  CreatePlotLineDto,
  UpdatePlotLineDto,
  CreateTimelineEventDto,
  CreateForeshadowingDto,
  ResolveForeshadowingDto,
  CreateOutlineDto,
  UpdateOutlineDto,
  UpsertCharacterProfileDto,
  CreateRelationshipDto,
  UpdateRelationshipDto,
  LogEmotionDto,
  LogGrowthDto,
  CreateSceneDto,
  UpdateSceneDto,
  ReorderScenesDto,
  AutoSplitScenesDto,
  ForeshadowingSuggestionDto,
  CheckConsistencyDto,
  CreateConsistencyRuleDto,
  UpdateConsistencyRuleDto,
  ToggleRuleDto,
  LogEventDto,
  CreativePlanDto,
  ExecuteCreativePlanDto,
  ChatMessageDto,
  AnalyzeFullTextDto,
  DeepThinkChatDto,
  ToolAnalysisDto,
  InlinePolishDto,
  AssistContentDto,
  OrchestrateDto,
} from './dto/agent.dto';

/**
 * Agent Controller - AI 写作代理 API
 *
 * 三层架构端点：
 * - L3 大纲层: world-settings, plot-lines, timeline-events, foreshadowings
 * - L2 角色层: characters, relationships, emotions, growth
 * - L1 执行层: scenes, generate, consistency
 * - 辅助: rag, events, sessions
 */
@Controller('ai')
@UseGuards(JwtAuthGuard)
export class AgentController {
  constructor(
    private readonly orchestrator: OrchestratorService,
    private readonly planner: PlannerService,
    private readonly character: CharacterService,
    private readonly scene: SceneService,
    private readonly rag: RagService,
    private readonly consistency: ConsistencyService,
  ) {}

  // ==================== 核心 Agent API ====================

  /** 获取可用模型列表 */
  @Get('models')
  getAvailableModels() {
    return this.orchestrator.getAvailableModels();
  }

  /** AI 代理主入口 */
  @Post('agent')
  @HttpCode(HttpStatus.OK)
  async processAgent(@Body() dto: ProcessAgentDto) {
    const request: AgentRequest = {
      bookId: dto.bookId,
      chapterId: dto.chapterId,
      content: dto.content,
      command: dto.command,
      candidateCount: dto.candidateCount,
      userInstructions: dto.userInstructions,
      context: { selectedText: dto.selectedText },
    };
    return this.orchestrator.process(request);
  }

  /** 续写 - 多候选 + FIM + 诊断 */
  @Post('generate/continue')
  @HttpCode(HttpStatus.OK)
  async generateContinue(@Body() dto: GenerateContinueDto) {
    const request: AgentRequest = {
      bookId: dto.bookId,
      chapterId: dto.chapterId,
      content: dto.content,
      cursorPos: dto.cursorPos,
      userInstructions: dto.userInstructions,
      candidateCount: dto.candidateCount || 3,
      command: 'continue',
    };
    return this.orchestrator.process(request);
  }

  // ==================== 创意计划 API ====================

  /** 生成创意计划 - 根据自然语言描述生成完整创作方案 */
  @Post('creative-plan')
  @HttpCode(HttpStatus.OK)
  async generateCreativePlan(@Body() dto: CreativePlanDto) {
    return this.orchestrator.generateCreativePlan(dto.bookId, dto.prompt, dto.chapterCount || 3);
  }

  /** 执行创意计划 - 批量创建设定、角色、剧情线、生成章节 */
  @Post('creative-plan/execute')
  @HttpCode(HttpStatus.OK)
  async executeCreativePlan(@Body() dto: ExecuteCreativePlanDto) {
    return this.orchestrator.executeCreativePlan(dto.bookId, dto.plan, dto.volumeId);
  }

  /** AI 对话 - 自然语言交互 */
  @Post('chat')
  @HttpCode(HttpStatus.OK)
  async chat(@Body() dto: ChatMessageDto) {
    return this.orchestrator.chat(dto.bookId, dto.message, dto.history || []);
  }

  /** 流式 AI 对话 - SSE，逐 token 推送回复 */
  @Post('chat/stream')
  async streamChat(@Body() dto: ChatMessageDto, @Res() res: Response) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    try {
      const result = await this.orchestrator.streamChat(
        dto.bookId,
        dto.message,
        dto.history || [],
        (chunk) => {
          res.write(`data: ${JSON.stringify({ type: 'token', data: { text: chunk } })}\n\n`);
        },
        dto.chapterId,
        dto.currentContent,
        dto.modelId,
      );
      res.write(`data: ${JSON.stringify({ type: 'done', data: result })}\n\n`);
    } catch (err: any) {
      res.write(`data: ${JSON.stringify({ type: 'error', data: { message: err.message } })}\n\n`);
    }
    res.write('data: [DONE]\n\n');
    res.end();
  }

  /** 深度思考流式对话 - SSE，先推送思考过程再推送最终回复 */
  @Post('deep-think/stream')
  async streamDeepThink(@Body() dto: DeepThinkChatDto, @Res() res: Response) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    try {
      const result = await this.orchestrator.streamDeepThinkChat(
        dto.bookId,
        dto.message,
        dto.history || [],
        (event) => {
          res.write(`data: ${JSON.stringify(event)}\n\n`);
        },
        dto.chapterId,
        dto.currentContent,
        dto.contextScope,
        dto.modelId,
      );
      res.write(`data: ${JSON.stringify({ type: 'done', data: result })}\n\n`);
    } catch (err: any) {
      res.write(`data: ${JSON.stringify({ type: 'error', data: { message: err.message } })}\n\n`);
    }
    res.write('data: [DONE]\n\n');
    res.end();
  }

  /** 多步编排流式端点 — 任务分解 + 逐步思考 + 确认 + 执行 */
  @Post('orchestrate/stream')
  async streamOrchestrate(@Body() dto: OrchestrateDto, @Res() res: Response) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    try {
      await this.orchestrator.streamOrchestrate(
        dto.bookId,
        dto.message,
        (event) => {
          res.write(`data: ${JSON.stringify(event)}\n\n`);
        },
        dto.chapterId,
        dto.currentContent,
        dto.modelId,
        dto.approvedSteps,
      );
    } catch (err: any) {
      res.write(`data: ${JSON.stringify({ type: 'error', data: { message: err.message } })}\n\n`);
    }
    res.write('data: [DONE]\n\n');
    res.end();
  }

  /** 工具分析流式端点 - 校对/拼字/灵感/妙笔 */
  @Post('tool-analysis/stream')
  async streamToolAnalysis(@Body() dto: ToolAnalysisDto, @Res() res: Response) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    try {
      const result = await this.orchestrator.streamToolAnalysis(
        dto.bookId,
        dto.tool as any,
        dto.content,
        (event) => {
          res.write(`data: ${JSON.stringify(event)}\n\n`);
        },
        dto.chapterId,
        dto.chapterTitle,
      );
      res.write(`data: ${JSON.stringify({ type: 'done', data: { result } })}\n\n`);
    } catch (err: any) {
      res.write(`data: ${JSON.stringify({ type: 'error', data: { message: err.message } })}\n\n`);
    }
    res.write('data: [DONE]\n\n');
    res.end();
  }

  /** 内联润色 - SSE，逐条流式返回修改建议 */
  @Post('polish/inline')
  async streamInlinePolish(@Body() dto: InlinePolishDto, @Res() res: Response) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    try {
      await this.orchestrator.streamInlinePolish(
        dto.bookId,
        dto.content,
        (event) => {
          res.write(`data: ${JSON.stringify(event)}\n\n`);
        },
        dto.chapterId,
        dto.chapterTitle,
      );
      res.write(`data: ${JSON.stringify({ type: 'done', data: {} })}\n\n`);
    } catch (err: any) {
      res.write(`data: ${JSON.stringify({ type: 'error', data: { message: err.message } })}\n\n`);
    }
    res.write('data: [DONE]\n\n');
    res.end();
  }

  /** AI 辅助编辑——返回 JSON 形式的字段补全/优化建议 */
  @Post('assist-content')
  async assistContent(@Body() dto: AssistContentDto) {
    const suggestions = await this.orchestrator.assistContent(
      dto.bookId,
      dto.type,
      dto.currentData,
    );
    return { suggestions };
  }

  /** AI 建议角色关系——分析已有角色返回关系建议数组 */
  @Post('suggest-relationships')
  async suggestRelationships(@Body() dto: { bookId: string }) {
    const suggestions = await this.orchestrator.suggestRelationships(dto.bookId);
    return { suggestions };
  }

  /** 流式全文分析 - SSE，读取全书内容进行深度分析 */
  @Post('analyze/stream')
  async streamAnalyze(@Body() dto: AnalyzeFullTextDto, @Res() res: Response) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    try {
      const result = await this.orchestrator.streamAnalyzeFullText(
        dto.bookId,
        dto.analysisType || 'comprehensive',
        (chunk) => {
          res.write(`data: ${JSON.stringify({ type: 'token', data: { text: chunk } })}\n\n`);
        },
      );
      res.write(`data: ${JSON.stringify({ type: 'done', data: result })}\n\n`);
    } catch (err: any) {
      res.write(`data: ${JSON.stringify({ type: 'error', data: { message: err.message } })}\n\n`);
    }
    res.write('data: [DONE]\n\n');
    res.end();
  }

  /** 流式生成创意计划 - SSE，逐 token 推送生成过程 */
  @Post('creative-plan/stream')
  async streamCreativePlan(@Body() dto: CreativePlanDto, @Res() res: Response) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    try {
      await this.orchestrator.streamCreativePlan(
        dto.bookId,
        dto.prompt,
        dto.chapterCount || 3,
        (event) => {
          res.write(`data: ${JSON.stringify(event)}\n\n`);
        },
      );
    } catch (err: any) {
      res.write(`data: ${JSON.stringify({ type: 'error', data: { message: err.message } })}\n\n`);
    }
    res.write('data: [DONE]\n\n');
    res.end();
  }

  /** 流式执行创意计划 - SSE，推送创建进度和章节内容 */
  @Post('creative-plan/stream-execute')
  async streamExecuteCreativePlan(@Body() dto: ExecuteCreativePlanDto, @Res() res: Response) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    try {
      await this.orchestrator.streamExecuteCreativePlan(
        dto.bookId,
        dto.plan,
        dto.volumeId,
        (event) => {
          res.write(`data: ${JSON.stringify(event)}\n\n`);
        },
      );
    } catch (err: any) {
      res.write(`data: ${JSON.stringify({ type: 'error', data: { message: err.message } })}\n\n`);
    }
    res.write('data: [DONE]\n\n');
    res.end();
  }

  // ==================== Planner Update + Impact Analysis ====================

  /** 更新大纲并返回影响分析 */
  @Post('planner/update')
  @HttpCode(HttpStatus.OK)
  async plannerUpdate(@Body() dto: PlannerUpdateDto) {
    let result: any;
    switch (dto.type) {
      case 'world_setting':
        if (dto.action === 'create')
          result = await this.planner.createWorldSetting(dto.bookId, dto.data);
        else if (dto.action === 'update' && dto.nodeId)
          result = await this.planner.updateWorldSetting(dto.nodeId, dto.data);
        else if (dto.action === 'delete' && dto.nodeId)
          result = await this.planner.deleteWorldSetting(dto.nodeId);
        break;
      case 'plot_line':
        if (dto.action === 'create')
          result = await this.planner.createPlotLine(dto.bookId, dto.data as any);
        else if (dto.action === 'update' && dto.nodeId)
          result = await this.planner.updatePlotLine(dto.nodeId, dto.data);
        else if (dto.action === 'delete' && dto.nodeId)
          result = await this.planner.deletePlotLine(dto.nodeId);
        break;
      case 'foreshadowing':
        if (dto.action === 'create')
          result = await this.planner.createForeshadowing(dto.bookId, dto.data as any);
        else if (dto.action === 'update' && dto.nodeId)
          result = await this.planner.resolveForeshadowing(dto.nodeId);
        else if (dto.action === 'delete' && dto.nodeId)
          result = await this.planner.deleteForeshadowing(dto.nodeId);
        break;
      default:
        throw new BadRequestException(`不支持的大纲类型: ${dto.type}`);
    }
    const impact = await this.orchestrator.analyzeImpact(dto.bookId, {
      type: dto.type,
      action: dto.action,
      data: dto.data,
    });
    return { result, impact };
  }

  // ==================== L3 世界观 ====================

  @Get('world-settings/:bookId')
  async getWorldSettings(@Param('bookId') bookId: string) {
    return this.planner.getWorldSettings(bookId);
  }

  @Post('world-settings')
  async createWorldSetting(@Body() dto: CreateWorldSettingDto) {
    return this.planner.createWorldSetting(dto.bookId, dto);
  }

  @Put('world-settings/:id')
  async updateWorldSetting(@Param('id') id: string, @Body() dto: UpdateWorldSettingDto) {
    return this.planner.updateWorldSetting(id, dto);
  }

  @Delete('world-settings/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteWorldSetting(@Param('id') id: string) {
    await this.planner.deleteWorldSetting(id);
  }

  // ==================== L3 剧情线 ====================

  @Get('plot-lines/:bookId')
  async getPlotLines(@Param('bookId') bookId: string) {
    return this.planner.getPlotLines(bookId);
  }

  @Post('plot-lines')
  async createPlotLine(@Body() dto: CreatePlotLineDto) {
    return this.planner.createPlotLine(dto.bookId, {
      title: dto.title,
      description: dto.description,
      type: dto.type as any,
    });
  }

  @Put('plot-lines/:id')
  async updatePlotLine(@Param('id') id: string, @Body() dto: UpdatePlotLineDto) {
    return this.planner.updatePlotLine(id, dto as any);
  }

  @Delete('plot-lines/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deletePlotLine(@Param('id') id: string) {
    await this.planner.deletePlotLine(id);
  }

  // ==================== L3 时间线 ====================

  @Get('timeline-events/:bookId')
  async getTimelineEvents(@Param('bookId') bookId: string, @Query('chapterId') chapterId?: string) {
    return this.planner.getTimelineEvents(bookId, chapterId);
  }

  @Post('timeline-events')
  async createTimelineEvent(@Body() dto: CreateTimelineEventDto) {
    return this.planner.createTimelineEvent(
      dto.bookId,
      {
        title: dto.title,
        description: dto.description,
        order: dto.order,
      },
      dto.chapterId,
    );
  }

  @Delete('timeline-events/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteTimelineEvent(@Param('id') id: string) {
    await this.planner.deleteTimelineEvent(id);
  }

  // ==================== L3 伏笔 ====================

  @Get('foreshadowings/:bookId')
  async getForeshadowings(@Param('bookId') bookId: string, @Query('status') status?: string) {
    return this.planner.getForeshadowings(bookId, status);
  }

  @Post('foreshadowings')
  async createForeshadowing(@Body() dto: CreateForeshadowingDto) {
    return this.planner.createForeshadowing(
      dto.bookId,
      {
        title: dto.title,
        content: dto.content,
      },
      dto.chapterId,
    );
  }

  @Put('foreshadowings/:id/resolve')
  async resolveForeshadowing(@Param('id') id: string, @Body() dto: ResolveForeshadowingDto) {
    return this.planner.resolveForeshadowing(id, dto.resolveAt);
  }

  @Put('foreshadowings/:id')
  async updateForeshadowing(
    @Param('id') id: string,
    @Body() dto: { title?: string; content?: string },
  ) {
    return this.planner.updateForeshadowing(id, dto);
  }

  @Put('foreshadowings/:id/abandon')
  @HttpCode(HttpStatus.OK)
  async abandonForeshadowing(@Param('id') id: string) {
    return this.planner.abandonForeshadowing(id);
  }

  @Delete('foreshadowings/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteForeshadowing(@Param('id') id: string) {
    await this.planner.deleteForeshadowing(id);
  }

  // ==================== L3 章纲（章节大纲） ====================

  @Get('outlines/:bookId')
  async getOutlines(@Param('bookId') bookId: string) {
    return this.planner.getOutlines(bookId);
  }

  @Post('outlines')
  async createOutline(@Body() dto: CreateOutlineDto) {
    return this.planner.createOutline(dto.bookId, { title: dto.title, content: dto.content });
  }

  @Put('outlines/:id')
  async updateOutline(@Param('id') id: string, @Body() dto: UpdateOutlineDto) {
    return this.planner.updateOutline(id, dto);
  }

  @Delete('outlines/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteOutline(@Param('id') id: string) {
    await this.planner.deleteOutline(id);
  }

  // ==================== 内在设定同步 ====================

  @Post('sync-internals')
  async syncInternals(@Body() dto: { bookId: string; chapterId: string }) {
    return this.orchestrator.syncInternalsAfterWrite(dto.bookId, dto.chapterId);
  }

  // ==================== L2 角色档案 ====================

  @Get('characters/:bookId')
  async getCharacters(@Param('bookId') bookId: string) {
    return this.character.getFullCharacters(bookId);
  }

  @Post('character-profile')
  async upsertCharacterProfile(@Body() dto: UpsertCharacterProfileDto) {
    const { characterId, ...input } = dto;
    return this.character.upsertCharacterProfile(characterId, input);
  }

  // ==================== L2 角色关系 ====================

  @Get('relationships/:bookId')
  async getRelationships(@Param('bookId') bookId: string) {
    return this.character.getCharacterRelationships(bookId);
  }

  @Post('relationships')
  async createRelationship(@Body() dto: CreateRelationshipDto) {
    return this.character.createCharacterRelationship(dto.bookId, dto.fromId, {
      toId: dto.toId,
      type: dto.type,
      description: dto.description,
      status: dto.status as any,
    });
  }

  @Put('relationships/:id')
  async updateRelationship(@Param('id') id: string, @Body() dto: UpdateRelationshipDto) {
    return this.character.updateCharacterRelationship(id, dto as any);
  }

  @Delete('relationships/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteRelationship(@Param('id') id: string) {
    await this.character.deleteCharacterRelationship(id);
  }

  // ==================== L2 情绪日志 ====================

  @Get('emotions/:characterId')
  async getEmotionLogs(@Param('characterId') characterId: string, @Query('limit') limit?: string) {
    return this.character.getEmotionLogs(characterId, limit ? parseInt(limit, 10) : 10);
  }

  @Post('emotions')
  async logEmotion(@Body() dto: LogEmotionDto) {
    return this.character.logEmotion(dto.characterId, dto.chapterId, {
      emotion: dto.emotion,
      intensity: dto.intensity,
      trigger: dto.trigger,
    });
  }

  // ==================== L2 成长记录 ====================

  @Get('growth/:characterId')
  async getGrowthRecords(@Param('characterId') characterId: string) {
    return this.character.getGrowthRecords(characterId);
  }

  @Post('growth')
  async logGrowth(@Body() dto: LogGrowthDto) {
    return this.character.logGrowth(
      dto.characterId,
      dto.chapterId,
      dto.beforeState,
      dto.afterState,
      dto.description,
    );
  }

  // ==================== L1 场景管理 ====================

  @Get('scenes/:chapterId')
  async getScenes(@Param('chapterId') chapterId: string) {
    return this.scene.getScenes(chapterId);
  }

  @Post('scenes')
  async createScene(@Body() dto: CreateSceneDto) {
    return this.scene.createScene(dto.chapterId, dto);
  }

  @Put('scenes/:id')
  async updateScene(@Param('id') id: string, @Body() dto: UpdateSceneDto) {
    return this.scene.updateScene(id, dto);
  }

  @Delete('scenes/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteScene(@Param('id') id: string) {
    await this.scene.deleteScene(id);
  }

  @Put('scenes/reorder/:chapterId')
  async reorderScenes(@Param('chapterId') chapterId: string, @Body() dto: ReorderScenesDto) {
    return this.scene.reorderScenes(chapterId, dto.sceneIds);
  }

  @Post('scenes/auto-split')
  async autoSplitScenes(@Body() dto: AutoSplitScenesDto) {
    return this.scene.autoSplitScenes(dto.chapterId, dto.content);
  }

  // ==================== RAG 检索 ====================

  @Get('retrieve/:bookId')
  async retrieve(
    @Param('bookId') bookId: string,
    @Query('content') content: string,
    @Query('limit') limit?: string,
    @Query('types') types?: string,
  ) {
    return this.rag.retrieve(bookId, content || '', {
      limit: limit ? parseInt(limit, 10) : 10,
      includeTypes: types ? types.split(',') : undefined,
    });
  }

  @Post('rag/index/:bookId')
  @HttpCode(HttpStatus.OK)
  async indexBook(@Param('bookId') bookId: string) {
    return this.rag.indexBook(bookId);
  }

  @Post('summary/:chapterId')
  @HttpCode(HttpStatus.OK)
  async generateSummary(@Param('chapterId') chapterId: string) {
    const summary = await this.rag.generateChapterSummary(chapterId);
    return { summary };
  }

  @Post('rag/foreshadowing-suggestions')
  @HttpCode(HttpStatus.OK)
  async suggestForeshadowing(@Body() dto: ForeshadowingSuggestionDto) {
    return this.rag.suggestForeshadowingResolution(dto.bookId, dto.chapterId, dto.content);
  }

  // ==================== 一致性检查 ====================

  @Post('consistency/check')
  @HttpCode(HttpStatus.OK)
  async checkConsistency(@Body() dto: CheckConsistencyDto) {
    return this.consistency.checkChapter(dto.bookId, dto.chapterId);
  }

  @Post('consistency/scan/:bookId')
  @HttpCode(HttpStatus.OK)
  async scanBook(@Param('bookId') bookId: string) {
    return this.consistency.scanBook(bookId);
  }

  @Get('consistency/rules/:bookId')
  async getConsistencyRules(@Param('bookId') bookId: string, @Query('type') type?: string) {
    return this.consistency.getRules(bookId, type);
  }

  @Post('consistency/rules')
  async createConsistencyRule(@Body() dto: CreateConsistencyRuleDto) {
    return this.consistency.createRule(dto.bookId, {
      type: dto.type,
      name: dto.name,
      description: dto.description,
      condition: dto.condition,
      severity: dto.severity as any,
    });
  }

  @Put('consistency/rules/:id')
  async updateConsistencyRule(@Param('id') id: string, @Body() dto: UpdateConsistencyRuleDto) {
    return this.consistency.updateRule(id, dto);
  }

  @Delete('consistency/rules/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteConsistencyRule(@Param('id') id: string) {
    await this.consistency.deleteRule(id);
  }

  @Put('consistency/rules/:id/toggle')
  async toggleConsistencyRule(@Param('id') id: string, @Body() dto: ToggleRuleDto) {
    return this.consistency.toggleRule(id, dto.isActive);
  }

  @Get('consistency/reports/:bookId')
  async getConsistencyReports(@Param('bookId') bookId: string, @Query('limit') limit?: string) {
    return this.consistency.getReports(bookId, limit ? parseInt(limit, 10) : 10);
  }

  // ==================== Agent 会话 ====================

  @Get('sessions/:bookId')
  async getAgentSessions(@Param('bookId') bookId: string, @Query('limit') limit?: string) {
    return this.orchestrator.getSessions(bookId, limit ? parseInt(limit, 10) : 20);
  }

  // ==================== 事件日志 ====================

  @Get('events/:bookId')
  async getEvents(
    @Param('bookId') bookId: string,
    @Query('character') character?: string,
    @Query('limit') limit?: string,
  ) {
    return this.rag.getRelatedEvents(bookId, character, limit ? parseInt(limit, 10) : 10);
  }

  @Post('events')
  async logEvent(@Body() dto: LogEventDto) {
    return this.rag.logEvent(
      dto.bookId,
      dto.chapterId,
      dto.type,
      dto.description,
      dto.participants,
    );
  }
}
