/**
 * Agent 模块 DTO 定义
 *
 * 覆盖所有 Agent Controller 端点的输入校验
 * 使用 class-validator + class-transformer
 */
import {
  IsString,
  IsOptional,
  IsNumber,
  IsArray,
  IsBoolean,
  IsObject,
  IsEnum,
  IsInt,
  Min,
  Max,
  MaxLength,
  MinLength,
  IsIn,
  IsNotEmpty,
  ValidateNested,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';

// ==================== 枚举 ====================

export enum AgentCommand {
  CONTINUE = 'continue',
  GENERATE = 'generate',
  IMPROVE = 'improve',
  EXPAND = 'expand',
  SUMMARIZE = 'summarize',
}

export enum PlannerNodeType {
  WORLD_SETTING = 'world_setting',
  PLOT_LINE = 'plot_line',
  CHARACTER = 'character',
  FORESHADOWING = 'foreshadowing',
}

export enum CrudAction {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
}

export enum PlotLineType {
  MAIN = 'MAIN',
  SUB = 'SUB',
  HIDDEN = 'HIDDEN',
}

export enum PlotLineStatus {
  ACTIVE = 'ACTIVE',
  COMPLETED = 'COMPLETED',
  PAUSED = 'PAUSED',
}

export enum ForeshadowingStatus {
  PENDING = 'PENDING',
  RESOLVED = 'RESOLVED',
  ABANDONED = 'ABANDONED',
}

export enum RuleSeverity {
  ERROR = 'ERROR',
  WARNING = 'WARNING',
  INFO = 'INFO',
}

export enum RelationshipStatus {
  POSITIVE = 'POSITIVE',
  NEGATIVE = 'NEGATIVE',
  NEUTRAL = 'NEUTRAL',
  COMPLEX = 'COMPLEX',
}

// ==================== 核心 Agent ====================

export class ProcessAgentDto {
  @IsString()
  @IsNotEmpty()
  bookId: string;

  @IsString()
  @IsOptional()
  chapterId?: string;

  @IsString()
  @IsOptional()
  @MaxLength(50000)
  content?: string;

  @IsEnum(AgentCommand)
  @IsOptional()
  command?: AgentCommand;

  @IsString()
  @IsOptional()
  @MaxLength(5000)
  selectedText?: string;

  @IsInt()
  @Min(1)
  @Max(5)
  @IsOptional()
  candidateCount?: number;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  userInstructions?: string;
}

export class GenerateContinueDto {
  @IsString()
  @IsNotEmpty()
  bookId: string;

  @IsString()
  @IsOptional()
  chapterId?: string;

  @IsString()
  @IsOptional()
  @MaxLength(50000)
  content?: string;

  @IsInt()
  @Min(0)
  @IsOptional()
  cursorPos?: number;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  userInstructions?: string;

  @IsInt()
  @Min(1)
  @Max(5)
  @IsOptional()
  candidateCount?: number;
}

// ==================== 创意计划 ====================

export class CreativePlanDto {
  @IsString()
  @IsNotEmpty()
  bookId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  prompt: string;

  @IsInt()
  @Min(1)
  @Max(10)
  @IsOptional()
  chapterCount?: number;
}

export class ExecuteCreativePlanDto {
  @IsString()
  @IsNotEmpty()
  bookId: string;

  @IsNotEmpty()
  plan: any; // CreativePlan structure

  @IsString()
  @IsOptional()
  volumeId?: string;
}

export class ChatMessageDto {
  @IsString()
  @IsNotEmpty()
  bookId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  message: string;

  @IsArray()
  @IsOptional()
  history?: Array<{ role: string; content: string }>;

  @IsString()
  @IsOptional()
  chapterId?: string;

  @IsString()
  @IsOptional()
  @MaxLength(20000)
  currentContent?: string;

  /** 用户选择的模型 ID，留空则使用默认模型 */
  @IsString()
  @IsOptional()
  modelId?: string;
}

// ==================== 深度思考对话 ====================

export class DeepThinkChatDto {
  @IsString()
  @IsNotEmpty()
  bookId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  message: string;

  @IsArray()
  @IsOptional()
  history?: Array<{ role: string; content: string }>;

  @IsString()
  @IsOptional()
  chapterId?: string;

  @IsString()
  @IsOptional()
  @MaxLength(20000)
  currentContent?: string;

  @IsString()
  @IsOptional()
  contextScope?: 'chapter' | 'fullBook' | 'custom';

  /** 用户选择的模型 ID，留空则使用默认模型 */
  @IsString()
  @IsOptional()
  modelId?: string;
}

// ==================== 工具分析 ====================

export class ToolAnalysisDto {
  @IsString()
  @IsNotEmpty()
  bookId: string;

  @IsString()
  @IsNotEmpty()
  tool: 'proofread' | 'spelling' | 'inspiration' | 'writing';

  @IsString()
  @IsNotEmpty()
  @MaxLength(30000)
  content: string;

  @IsString()
  @IsOptional()
  chapterId?: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  chapterTitle?: string;
}

// ==================== 内联润色 ====================

export class InlinePolishDto {
  @IsString()
  @IsNotEmpty()
  bookId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(30000)
  content: string;

  @IsString()
  @IsOptional()
  chapterId?: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  chapterTitle?: string;
}

// ==================== 全文分析 ====================

// ==================== AI 辅助编辑 ====================

export class AssistContentDto {
  @IsString()
  @IsNotEmpty()
  bookId: string;

  @IsString()
  @IsIn(['character', 'world_setting', 'outline'])
  type: 'character' | 'world_setting' | 'outline';

  @IsObject()
  currentData: Record<string, any>;
}

// ==================== 多步编排 ====================

export class OrchestrateDto {
  @IsString()
  @IsNotEmpty()
  bookId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  message: string;

  @IsString()
  @IsOptional()
  chapterId?: string;

  @IsString()
  @IsOptional()
  @MaxLength(20000)
  currentContent?: string;

  @IsString()
  @IsOptional()
  modelId?: string;

  /** 已批准的步骤计划（用于确认后执行） */
  @IsArray()
  @IsOptional()
  approvedSteps?: Array<{ id: string; title: string; description: string; type: string }>;
}

// ==================== 全文分析（保留） ====================

export class AnalyzeFullTextDto {
  @IsString()
  @IsNotEmpty()
  bookId: string;

  @IsString()
  @IsOptional()
  analysisType?: 'foreshadowing' | 'character_arc' | 'pacing' | 'comprehensive';
}

// ==================== Planner ====================

export class PlannerUpdateDto {
  @IsString()
  @IsNotEmpty()
  bookId: string;

  @IsEnum(PlannerNodeType)
  type: PlannerNodeType;

  @IsEnum(CrudAction)
  action: CrudAction;

  @IsString()
  @IsOptional()
  nodeId?: string;

  @IsNotEmpty()
  data: Record<string, any>;
}

// ==================== World Settings ====================

export class CreateWorldSettingDto {
  @IsString()
  @IsNotEmpty()
  bookId: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  genre?: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  theme?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  tone?: string;

  @IsInt()
  @Min(0)
  @IsOptional()
  targetWordCount?: number;
}

export class UpdateWorldSettingDto {
  @IsString()
  @IsOptional()
  @MaxLength(100)
  genre?: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  theme?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  tone?: string;

  @IsInt()
  @Min(0)
  @IsOptional()
  targetWordCount?: number;
}

// ==================== Plot Lines ====================

export class CreatePlotLineDto {
  @IsString()
  @IsNotEmpty()
  bookId: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title: string;

  @IsString()
  @IsOptional()
  @MaxLength(5000)
  description?: string;

  @IsEnum(PlotLineType)
  @IsOptional()
  type?: PlotLineType;
}

export class UpdatePlotLineDto {
  @IsString()
  @IsOptional()
  @MaxLength(200)
  title?: string;

  @IsString()
  @IsOptional()
  @MaxLength(5000)
  description?: string;

  @IsEnum(PlotLineType)
  @IsOptional()
  type?: PlotLineType;

  @IsEnum(PlotLineStatus)
  @IsOptional()
  status?: PlotLineStatus;
}

// ==================== Timeline Events ====================

export class CreateTimelineEventDto {
  @IsString()
  @IsNotEmpty()
  bookId: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title: string;

  @IsString()
  @IsOptional()
  @MaxLength(5000)
  description?: string;

  @IsInt()
  @IsOptional()
  @Min(0)
  order?: number;

  @IsString()
  @IsOptional()
  chapterId?: string;
}

// ==================== Foreshadowings ====================

export class CreateForeshadowingDto {
  @IsString()
  @IsNotEmpty()
  bookId: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title: string;

  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  content: string;

  @IsString()
  @IsOptional()
  chapterId?: string;
}

export class ResolveForeshadowingDto {
  @IsString()
  @IsOptional()
  resolveAt?: string;
}

// ==================== Outlines (章纲) ====================

export class CreateOutlineDto {
  @IsString()
  @IsNotEmpty()
  bookId: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title: string;

  @IsString()
  @IsOptional()
  @MaxLength(10000)
  content?: string;
}

export class UpdateOutlineDto {
  @IsString()
  @IsOptional()
  @MaxLength(200)
  title?: string;

  @IsString()
  @IsOptional()
  @MaxLength(10000)
  content?: string;

  @IsInt()
  @Min(0)
  @IsOptional()
  order?: number;
}

// ==================== Character Profile ====================

export class UpsertCharacterProfileDto {
  @IsString()
  @IsNotEmpty()
  characterId: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  personality?: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  background?: string;

  @IsString()
  @IsOptional()
  @MaxLength(1000)
  motivation?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  fear?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  strength?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  weakness?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  currentGoal?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  longTermGoal?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  arc?: string;

  @IsString()
  @IsOptional()
  @MaxLength(1000)
  appearance?: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  catchphrase?: string;
}

// ==================== Relationships ====================

export class CreateRelationshipDto {
  @IsString()
  @IsNotEmpty()
  bookId: string;

  @IsString()
  @IsNotEmpty()
  fromId: string;

  @IsString()
  @IsNotEmpty()
  toId: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  type: string;

  @IsString()
  @IsOptional()
  @MaxLength(1000)
  description?: string;

  @IsEnum(RelationshipStatus)
  @IsOptional()
  status?: RelationshipStatus;
}

export class UpdateRelationshipDto {
  @IsString()
  @IsOptional()
  @MaxLength(100)
  type?: string;

  @IsString()
  @IsOptional()
  @MaxLength(1000)
  description?: string;

  @IsEnum(RelationshipStatus)
  @IsOptional()
  status?: RelationshipStatus;
}

// ==================== Emotions ====================

export class LogEmotionDto {
  @IsString()
  @IsNotEmpty()
  characterId: string;

  @IsString()
  @IsOptional()
  chapterId?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  emotion: string;

  @IsInt()
  @Min(1)
  @Max(10)
  @IsOptional()
  intensity?: number;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  trigger?: string;
}

// ==================== Growth ====================

export class LogGrowthDto {
  @IsString()
  @IsNotEmpty()
  characterId: string;

  @IsString()
  @IsOptional()
  chapterId?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  beforeState: string;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  afterState: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  description?: string;
}

// ==================== Scenes ====================

export class CreateSceneDto {
  @IsString()
  @IsNotEmpty()
  chapterId: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  title?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(50000)
  content: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  location?: string;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  timeOfDay?: string;

  @IsInt()
  @Min(0)
  @IsOptional()
  order?: number;
}

export class UpdateSceneDto {
  @IsString()
  @IsOptional()
  @MaxLength(200)
  title?: string;

  @IsString()
  @IsOptional()
  @MaxLength(50000)
  content?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  location?: string;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  timeOfDay?: string;
}

export class ReorderScenesDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  sceneIds: string[];
}

export class AutoSplitScenesDto {
  @IsString()
  @IsNotEmpty()
  chapterId: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100000)
  content: string;
}

// ==================== RAG ====================

export class ForeshadowingSuggestionDto {
  @IsString()
  @IsNotEmpty()
  bookId: string;

  @IsString()
  @IsNotEmpty()
  chapterId: string;

  @IsString()
  @MinLength(1)
  @MaxLength(50000)
  content: string;
}

// ==================== Consistency ====================

export class CheckConsistencyDto {
  @IsString()
  @IsNotEmpty()
  bookId: string;

  @IsString()
  @IsNotEmpty()
  chapterId: string;
}

export class CreateConsistencyRuleDto {
  @IsString()
  @IsNotEmpty()
  bookId: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  type: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  description?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  condition: string;

  @IsEnum(RuleSeverity)
  @IsOptional()
  severity?: RuleSeverity;
}

export class UpdateConsistencyRuleDto {
  @IsString()
  @IsOptional()
  @MaxLength(200)
  name?: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  description?: string;

  @IsString()
  @IsOptional()
  @MaxLength(5000)
  condition?: string;

  @IsEnum(RuleSeverity)
  @IsOptional()
  severity?: RuleSeverity;
}

export class ToggleRuleDto {
  @IsBoolean()
  isActive: boolean;
}

// ==================== Events ====================

export class LogEventDto {
  @IsString()
  @IsNotEmpty()
  bookId: string;

  @IsString()
  @IsOptional()
  chapterId?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  type: string;

  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  description: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  participants?: string[];
}
