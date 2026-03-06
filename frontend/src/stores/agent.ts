/**
 * Agent Store - 前端 AI 代理状态管理
 */

import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
// 注意：axios 全局拦截器已在 main.ts 中统一注册，此处不再重复

/**
 * Agent 类型
 */
export type AgentType = 'PLANNER' | 'CHARACTER' | 'WRITER' | 'CONSISTENCY';

/**
 * Agent 状态
 */
export interface AgentStatus {
  type: AgentType;
  status: 'idle' | 'thinking' | 'writing' | 'checking' | 'completed' | 'error';
  message?: string;
}

/**
 * 世界观设置
 */
export interface WorldSetting {
  id: string;
  genre?: string;
  theme?: string;
  tone?: string;
  targetWordCount?: number;
}

/**
 * 剧情线
 */
export interface PlotLine {
  id: string;
  title: string;
  description?: string;
  type: 'MAIN' | 'SUB' | 'CHARACTER';
  status: string;
}

/**
 * 伏笔
 */
export interface Foreshadowing {
  id: string;
  title: string;
  content: string;
  status: 'PENDING' | 'RESOLVED' | 'ABANDONED';
}

/**
 * 角色详情
 */
export interface CharacterProfile {
  id: string;
  characterId: string;
  name: string;
  role: string;
  personality?: string;
  background?: string;
  motivation?: string;
  fear?: string;
  strength?: string;
  weakness?: string;
  currentGoal?: string;
  longTermGoal?: string;
  arc?: string;
  appearance?: string;
  catchphrase?: string;
}

/**
 * 角色关系
 */
export interface CharacterRelationship {
  id: string;
  fromId: string;
  fromName: string;
  toId: string;
  toName: string;
  type: string;
  description?: string;
  status?: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL' | 'COMPLEX';
}

/**
 * RAG 检索结果
 */
export interface RetrievalResult {
  type: string;
  content: string;
}

/**
 * Agent 响应
 */
export interface AgentResponse {
  type: string;
  result: string;
  diff?: {
    original: string;
    replacement: string;
  };
  suggestions?: string[];
  warnings?: string[];
  status: string;
}

/**
 * 聊天消息
 */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  /** 深度思考过程 */
  thinking?: string;
  /** 是否正在思考中 */
  isThinking?: boolean;
  suggestedActions?: Array<{
    type: string;
    label: string;
    data: any;
  }>;
  /** 变更差异（旧内容 vs 新内容），用于红绿对比展示 */
  diff?: {
    oldContent: string;
    newContent: string;
    label: string;
    status: 'pending' | 'accepted' | 'rejected';
  };
}

/**
 * 会话 Session
 */
export interface ChatSession {
  id: string;
  bookId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** 绑定的章节 ID */
  chapterId?: string;
  /** 绑定的章节标题 */
  chapterTitle?: string;
}

/**
 * 上下文作用域
 */
export type ContextScope = 'chapter' | 'fullBook' | 'custom';

/**
 * AI 工具模式
 */
export type AiToolMode = 'chat' | 'describe' | 'extract' | 'artist';

/**
 * 右侧面板工具类型
 */
export type RightPanelTool = 'proofread' | 'spelling' | 'outline' | 'character' | 'setting' | 'inspiration' | 'writing';

/**
 * 内联润色建议
 */
export interface PolishSuggestion {
  id: string;
  index: number;
  original: string;
  replacement: string;
  reason: string;
  status: 'pending' | 'accepted' | 'rejected';
  /** ProseMirror 位置（由编辑器映射后设置） */
  from?: number;
  to?: number;
}

/**
 * 创意计划
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
 * 计划执行状态
 */
export interface PlanExecStatus {
  step: string;
  current: number;
  total: number;
  details?: string;
}

export const useAgentStore = defineStore('agent', () => {

  // ===== SSE 事件解析器 =====
  /** 正确处理跨 chunk 的 SSE 行边界，避免大 JSON 被截断 */
  function createSSEParser(onEvent: (event: any) => void) {
    let buffer = '';
    return {
      feed(chunk: string) {
        buffer += chunk;
        const lines = buffer.split('\n');
        // 最后一行可能不完整，留到下次
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();
          if (payload === '[DONE]') continue;
          if (!payload) continue;
          try {
            const event = JSON.parse(payload);
            onEvent(event);
          } catch {
            // JSON 不完整，放回 buffer 等下一次追加
            buffer = line + '\n' + buffer;
          }
        }
      },
      flush() {
        // 处理残留
        if (buffer.startsWith('data: ')) {
          const payload = buffer.slice(6).trim();
          if (payload && payload !== '[DONE]') {
            try { onEvent(JSON.parse(payload)); } catch { /* ignore */ }
          }
        }
        buffer = '';
      },
    };
  }

  // ===== State =====

  /** Agent 状态 */
  const agentStatus = ref<AgentStatus>({
    type: 'WRITER',
    status: 'idle',
  });

  /** 是否正在处理 */
  const isProcessing = computed(() =>
    agentStatus.value.status !== 'idle' &&
    agentStatus.value.status !== 'completed' &&
    agentStatus.value.status !== 'error'
  );

  /** 世界观设置 */
  const worldSettings = ref<WorldSetting[]>([]);

  /** 剧情线 */
  const plotLines = ref<PlotLine[]>([]);

  /** 伏笔 */
  const foreshadowings = ref<Foreshadowing[]>([]);

  /** 角色列表 */
  const characters = ref<CharacterProfile[]>([]);

  /** 角色关系 */
  const relationships = ref<CharacterRelationship[]>([]);

  /** RAG 检索结果 */
  const retrievalResults = ref<RetrievalResult[]>([]);

  /** AI 生成结果 */
  const aiResult = ref<string>('');

  /** 一致性警告 */
  const warnings = ref<string[]>([]);

  /** 错误信息 */
  const error = ref<string | null>(null);

  // ===== 聊天 & 创意计划 State =====

  /** 聊天消息列表 (当前活跃会话) */
  const chatMessages = ref<ChatMessage[]>([]);

  /** 待审批的创意计划 */
  const pendingPlan = ref<CreativePlan | null>(null);

  /** 计划执行状态 */
  const planExecStatus = ref<PlanExecStatus | null>(null);

  /** 聊天加载状态 */
  const chatLoading = ref(false);

  /** 当前绑定的 bookId（用于聊天持久化） */
  const currentChatBookId = ref<string | null>(null);

  /** 所有会话列表 */
  const sessions = ref<ChatSession[]>([]);

  /** 当前活跃会话 ID */
  const activeSessionId = ref<string | null>(null);

  /** 上下文作用域 */
  const contextScope = ref<ContextScope>('chapter');

  /** 当前 AI 工具模式 */
  const activeToolMode = ref<AiToolMode>('chat');

  /** 右侧面板工具 */
  const activeRightTool = ref<RightPanelTool | null>(null);

  /** 深度思考开关 */
  const deepThinkingEnabled = ref(true);

  /** 剩余使用次数 */
  const remainingQuota = ref(666);

  // ===== 模型选择 =====
  interface ModelOption {
    id: string;
    label: string;
    description: string;
    speed: 'fast' | 'normal' | 'slow';
  }
  // 硬编码 fallback 模型列表（API 失败时使用）
  const fallbackModels: ModelOption[] = [
    { id: 'Pro/deepseek-ai/DeepSeek-V3.2', label: 'DeepSeek V3.2', description: '旗舰模型，质量最高', speed: 'normal' },
    { id: 'Pro/zhipuai/GLM-5', label: 'GLM-5', description: '智谱高质量模型', speed: 'normal' },
    { id: 'Pro/MiniMaxAI/MiniMax-M2.5', label: 'MiniMax M2.5', description: '快速响应，均衡质量', speed: 'fast' },
  ];

  const availableModels = ref<ModelOption[]>(fallbackModels);
  const selectedModelId = ref<string>(localStorage.getItem('ai_selected_model') || '');
  const defaultModelId = ref<string>('Pro/deepseek-ai/DeepSeek-V3.2');

  /** 获取可用模型列表 */
  async function fetchAvailableModels() {
    try {
      const authToken = localStorage.getItem('token');
      const res = await axios.get(`${API_URL}/ai/models`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const data = res.data;
      const models = Array.isArray(data.models) && data.models.length > 0 ? data.models : fallbackModels;
      availableModels.value = models;
      defaultModelId.value = data.defaultModel || 'Pro/deepseek-ai/DeepSeek-V3.2';
      // 如果用户之前选的模型已不在列表中，则重置
      if (selectedModelId.value && !availableModels.value.find(m => m.id === selectedModelId.value)) {
        selectedModelId.value = '';
      }
    } catch (e) {
      console.warn('[AI] fetchAvailableModels failed, using fallback models:', e);
      // 保持 fallback 模型列表不变
    }
  }

  /** 切换模型 */
  function setModel(modelId: string) {
    selectedModelId.value = modelId;
    if (modelId) {
      localStorage.setItem('ai_selected_model', modelId);
    } else {
      localStorage.removeItem('ai_selected_model');
    }
  }

  /** 当前有效模型ID（空字符串 = 默认） */
  const effectiveModelId = computed(() => selectedModelId.value || defaultModelId.value);

  /** 当前模型显示名称 */
  const currentModelLabel = computed(() => {
    const m = availableModels.value.find(m => m.id === effectiveModelId.value);
    return m?.label || 'DeepSeek V3.2';
  });

  // 当前模型速度标签
  const currentModelSpeed = computed(() => {
    const m = availableModels.value.find(m => m.id === effectiveModelId.value);
    return m?.speed || 'normal';
  });

  // ===== 右侧工具面板分析结果 =====
  interface ToolAnalysisResult {
    tool: RightPanelTool;
    loading: boolean;
    content: string;
    items: ToolIssueItem[];
    timestamp: number;
  }
  interface ToolIssueItem {
    type: 'error' | 'warning' | 'info' | 'suggestion';
    title: string;
    description: string;
    location?: string;   // 定位文本片段
    replacement?: string; // 建议替换内容
  }
  const toolAnalysisResult = ref<ToolAnalysisResult | null>(null);
  const toolAnalysisAbort = ref<AbortController | null>(null);

  /** 运行右侧工具分析 */
  async function runToolAnalysis(
    bookId: string,
    tool: RightPanelTool,
    content: string,
    chapterId?: string,
    chapterTitle?: string,
  ) {
    // 取消之前的分析
    if (toolAnalysisAbort.value) {
      toolAnalysisAbort.value.abort();
    }
    const abort = new AbortController();
    toolAnalysisAbort.value = abort;

    toolAnalysisResult.value = {
      tool,
      loading: true,
      content: '',
      items: [],
      timestamp: Date.now(),
    };

    try {
      const authToken = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/ai/tool-analysis/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          bookId,
          tool,
          content,
          chapterId,
          chapterTitle,
        }),
        signal: abort.signal,
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let fullContent = '';

      const parser = createSSEParser((event) => {
        if (event.type === 'token') {
          fullContent += event.data.text;
          if (toolAnalysisResult.value) {
            toolAnalysisResult.value = { ...toolAnalysisResult.value, content: fullContent };
          }
        } else if (event.type === 'done') {
          // 尝试从结果中解析结构化问题
          const items = parseToolIssues(fullContent, tool);
          if (toolAnalysisResult.value) {
            toolAnalysisResult.value = {
              ...toolAnalysisResult.value,
              content: fullContent,
              items,
              loading: false,
            };
          }
        } else if (event.type === 'error') {
          throw new Error(event.data.message);
        }
      });

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        parser.feed(decoder.decode(value, { stream: true }));
      }
      parser.flush();

      // 确保 loading 关闭
      if (toolAnalysisResult.value && toolAnalysisResult.value.loading) {
        const items = parseToolIssues(fullContent, tool);
        toolAnalysisResult.value = { ...toolAnalysisResult.value, content: fullContent, items, loading: false };
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      if (toolAnalysisResult.value) {
        toolAnalysisResult.value = {
          ...toolAnalysisResult.value,
          content: `分析失败: ${err.message}`,
          loading: false,
        };
      }
    }
  }

  /** 取消工具分析 */
  function cancelToolAnalysis() {
    if (toolAnalysisAbort.value) {
      toolAnalysisAbort.value.abort();
      toolAnalysisAbort.value = null;
    }
    if (toolAnalysisResult.value) {
      toolAnalysisResult.value = { ...toolAnalysisResult.value, loading: false };
    }
  }

  /** 清除工具分析结果 */
  function clearToolAnalysis() {
    cancelToolAnalysis();
    toolAnalysisResult.value = null;
  }

  // ===== 内联润色 =====
  const polishSuggestions = ref<PolishSuggestion[]>([]);
  const polishLoading = ref(false);
  const currentPolishIndex = ref(0);
  const polishAbort = ref<AbortController | null>(null);

  /** 请求内联润色（逐条流式返回建议） */
  async function requestInlinePolish(
    bookId: string,
    content: string,
    chapterId?: string,
    chapterTitle?: string,
  ) {
    // 取消之前的请求
    cancelPolish();
    polishSuggestions.value = [];
    polishLoading.value = true;
    currentPolishIndex.value = 0;

    const abort = new AbortController();
    polishAbort.value = abort;

    try {
      const authToken = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/ai/polish/inline`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({ bookId, content, chapterId, chapterTitle }),
        signal: abort.signal,
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();

      const parser = createSSEParser((event) => {
        if (event.type === 'suggestion') {
          const d = event.data;
          // 防御性过滤：避免把解析异常的标签文本写入建议并最终污染正文
          const hasMarkers = [d?.original, d?.replacement, d?.reason]
            .some((v: string) => typeof v === 'string' && v.includes('<<<'));
          if (hasMarkers) return;
          if (!d?.original || !d?.replacement) return;
          polishSuggestions.value = [
            ...polishSuggestions.value,
            {
              id: `ps_${d.index}`,
              index: d.index,
              original: d.original,
              replacement: d.replacement,
              reason: d.reason || '表达优化',
              status: 'pending',
            },
          ];
        } else if (event.type === 'done') {
          polishLoading.value = false;
        } else if (event.type === 'error') {
          polishLoading.value = false;
        }
      });

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        parser.feed(decoder.decode(value, { stream: true }));
      }
      parser.flush();
      polishLoading.value = false;
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      polishLoading.value = false;
    }
  }

  /** 接受某条润色建议 */
  function acceptPolishSuggestion(id: string) {
    polishSuggestions.value = polishSuggestions.value.map(s =>
      s.id === id ? { ...s, status: 'accepted' as const } : s,
    );
    // 自动跳到下一条待处理
    advancePolishIndex();
  }

  /** 拒绝某条润色建议 */
  function rejectPolishSuggestion(id: string) {
    polishSuggestions.value = polishSuggestions.value.map(s =>
      s.id === id ? { ...s, status: 'rejected' as const } : s,
    );
    advancePolishIndex();
  }

  /** 接受所有待处理建议 */
  function acceptAllPolish() {
    polishSuggestions.value = polishSuggestions.value.map(s =>
      s.status === 'pending' ? { ...s, status: 'accepted' as const } : s,
    );
  }

  /** 拒绝所有待处理建议 */
  function rejectAllPolish() {
    polishSuggestions.value = polishSuggestions.value.map(s =>
      s.status === 'pending' ? { ...s, status: 'rejected' as const } : s,
    );
  }

  /** 跳到下一条待处理的建议 */
  function advancePolishIndex() {
    const pendings = polishSuggestions.value
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => s.status === 'pending');
    if (pendings.length === 0) return;
    // 找到 > currentPolishIndex 的第一个 pending
    const next = pendings.find(({ i }) => i > currentPolishIndex.value);
    currentPolishIndex.value = next ? next.i : pendings[0].i;
  }

  /** 手动跳到上一条待处理 */
  function prevPolishSuggestion() {
    const pendings = polishSuggestions.value
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => s.status === 'pending');
    if (pendings.length === 0) return;
    const prev = [...pendings].reverse().find(({ i }) => i < currentPolishIndex.value);
    currentPolishIndex.value = prev ? prev.i : pendings[pendings.length - 1].i;
  }

  /** 手动跳到下一条待处理 */
  function nextPolishSuggestion() {
    advancePolishIndex();
  }

  /** 取消润色 */
  function cancelPolish() {
    if (polishAbort.value) {
      polishAbort.value.abort();
      polishAbort.value = null;
    }
    polishLoading.value = false;
  }

  /** 清除润色状态 */
  function clearPolish() {
    cancelPolish();
    polishSuggestions.value = [];
    currentPolishIndex.value = 0;
  }

  /** 从 AI 回复中解析结构化问题列表 */
  function parseToolIssues(content: string, tool: RightPanelTool): ToolIssueItem[] {
    const items: ToolIssueItem[] = [];
    // 匹配 markdown 列表项格式: - **错误/警告/建议**: 内容
    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      // 匹配: - ❌/⚠️/💡/✏️ **标题**: 描述
      const match = trimmed.match(/^[-*]\s*(?:([❌⚠️💡✏️🔴🟡🟢📝]+)\s*)?(?:\*\*(.+?)\*\*[：:]\s*)?(.+)$/);
      if (match) {
        const [, icon, title, desc] = match;
        let type: ToolIssueItem['type'] = 'info';
        if (icon?.includes('❌') || icon?.includes('🔴')) type = 'error';
        else if (icon?.includes('⚠️') || icon?.includes('🟡')) type = 'warning';
        else if (icon?.includes('💡') || icon?.includes('✏️')) type = 'suggestion';

        if (title || desc) {
          items.push({
            type,
            title: title || (tool === 'proofread' ? '校对问题' : tool === 'spelling' ? '拼写问题' : '建议'),
            description: desc || '',
          });
        }
      }
    }
    return items;
  }
  const SESSIONS_STORAGE_PREFIX = 'ai_sessions_';
  const CHAT_STORAGE_PREFIX = 'ai_chat_';
  const MAX_PERSISTED_MESSAGES = 50;
  const MAX_SESSIONS = 20;

  /** 保存所有会话列表到 localStorage */
  function saveSessionsList() {
    if (!currentChatBookId.value) return;
    try {
      const toSave = sessions.value.map(s => ({
        id: s.id, bookId: s.bookId, title: s.title,
        createdAt: s.createdAt, updatedAt: s.updatedAt,
        chapterId: s.chapterId, chapterTitle: s.chapterTitle,
      }));
      localStorage.setItem(
        SESSIONS_STORAGE_PREFIX + currentChatBookId.value,
        JSON.stringify(toSave.slice(0, MAX_SESSIONS)),
      );
    } catch { /* quota */ }
  }

  /** 保存当前会话消息 */
  function saveChatHistory() {
    if (!activeSessionId.value) return;
    try {
      const toSave = chatMessages.value
        .filter(m => m.content !== '●●●' && !m.content.startsWith('🔄'))
        .slice(-MAX_PERSISTED_MESSAGES)
        .map(m => ({
          id: m.id, role: m.role, content: m.content,
          timestamp: m.timestamp, thinking: m.thinking,
        }));
      localStorage.setItem(
        CHAT_STORAGE_PREFIX + activeSessionId.value,
        JSON.stringify(toSave),
      );
    } catch { /* quota */ }
  }

  /** 加载会话列表 */
  function loadSessionsList(bookId: string) {
    try {
      const stored = localStorage.getItem(SESSIONS_STORAGE_PREFIX + bookId);
      if (stored) {
        sessions.value = JSON.parse(stored);
      } else {
        sessions.value = [];
      }
    } catch {
      sessions.value = [];
    }
  }

  /** 加载特定会话的消息 */
  function loadSessionMessages(sessionId: string) {
    try {
      const stored = localStorage.getItem(CHAT_STORAGE_PREFIX + sessionId);
      if (stored) {
        chatMessages.value = JSON.parse(stored);
      } else {
        chatMessages.value = [];
      }
    } catch {
      chatMessages.value = [];
    }
  }

  /** 创建新会话 (每次进入书籍时自动调用) */
  function createNewSession(bookId: string, chapterId?: string, chapterTitle?: string): ChatSession {
    // 保存旧会话消息
    if (activeSessionId.value) {
      saveChatHistory();
    }
    const session: ChatSession = {
      id: `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      bookId,
      title: chapterTitle ? `${chapterTitle}` : `新对话 ${new Date().toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      chapterId,
      chapterTitle,
    };
    sessions.value.unshift(session);
    activeSessionId.value = session.id;
    chatMessages.value = [];
    saveSessionsList();
    return session;
  }

  /** 切换到指定会话 */
  function switchSession(sessionId: string) {
    if (activeSessionId.value) {
      saveChatHistory();
    }
    activeSessionId.value = sessionId;
    loadSessionMessages(sessionId);
    // 更新sessions中的updatedAt
    const session = sessions.value.find(s => s.id === sessionId);
    if (session) {
      session.updatedAt = Date.now();
      saveSessionsList();
    }
  }

  /** 删除会话 */
  function deleteSession(sessionId: string) {
    sessions.value = sessions.value.filter(s => s.id !== sessionId);
    localStorage.removeItem(CHAT_STORAGE_PREFIX + sessionId);
    if (activeSessionId.value === sessionId) {
      if (sessions.value.length > 0) {
        switchSession(sessions.value[0].id);
      } else {
        activeSessionId.value = null;
        chatMessages.value = [];
      }
    }
    saveSessionsList();
  }

  /** 加载聊天历史 (初始化会话系统) - 恢复上次活跃会话或创建新会话 */
  function loadChatHistory(bookId: string) {
    // 先保存当前会话消息（防止切换书籍时丢数据）
    if (activeSessionId.value) {
      saveChatHistory();
    }
    currentChatBookId.value = bookId;
    loadSessionsList(bookId);

    if (sessions.value.length > 0) {
      // 恢复上次最新的会话
      const latest = sessions.value.reduce((a, b) => a.updatedAt > b.updatedAt ? a : b);
      activeSessionId.value = latest.id;
      loadSessionMessages(latest.id);
    } else {
      // 没有历史会话，创建新的
      createNewSession(bookId);
    }
  }

  /** 旧兼容：清空 */
  function clearChatHistory(bookId?: string) {
    const targetId = bookId || currentChatBookId.value;
    if (targetId) {
      // 清空所有会话
      sessions.value.forEach(s => localStorage.removeItem(CHAT_STORAGE_PREFIX + s.id));
      localStorage.removeItem(SESSIONS_STORAGE_PREFIX + targetId);
      sessions.value = [];
    }
    activeSessionId.value = null;
    chatMessages.value = [];
  }

  // 自动保存（debounced）
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  watch(chatMessages, () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveChatHistory(), 1000);
  }, { deep: true });

  // ===== Actions =====

  /**
   * 加载书籍的上下文数据
   */
  async function loadContext(bookId: string) {
    try {
      const [ws, pl, fs, chars, rels] = await Promise.all([
        axios.get(`${API_URL}/ai/world-settings/${bookId}`),
        axios.get(`${API_URL}/ai/plot-lines/${bookId}`),
        axios.get(`${API_URL}/ai/foreshadowings/${bookId}`),
        axios.get(`${API_URL}/ai/characters/${bookId}`),
        axios.get(`${API_URL}/ai/relationships/${bookId}`),
      ]);

      worldSettings.value = ws.data.data || [];
      plotLines.value = pl.data.data || [];
      foreshadowings.value = fs.data.data || [];
      characters.value = chars.data.data || [];
      relationships.value = rels.data.data || [];
    } catch (err: any) {
      console.error('加载上下文失败:', err);
      error.value = err.message;
    }
  }

  /**
   * 创建世界观设置
   */
  async function createWorldSetting(bookId: string, input: Partial<WorldSetting>) {
    try {
      const response = await axios.post(`${API_URL}/ai/world-settings`, {
        bookId,
        ...input,
      });
      await loadContext(bookId);
      return response.data.data;
    } catch (err: any) {
      error.value = err.message;
      return null;
    }
  }

  /**
   * 创建剧情线
   */
  async function createPlotLine(bookId: string, title: string, description?: string, type: string = 'MAIN') {
    try {
      const response = await axios.post(`${API_URL}/ai/plot-lines`, {
        bookId,
        title,
        description,
        type,
      });
      await loadContext(bookId);
      return response.data.data;
    } catch (err: any) {
      error.value = err.message;
      return null;
    }
  }

  /**
   * 创建伏笔
   */
  async function createForeshadowing(bookId: string, title: string, content: string, chapterId?: string) {
    try {
      const response = await axios.post(`${API_URL}/ai/foreshadowings`, {
        bookId,
        title,
        content,
        chapterId,
      });
      await loadContext(bookId);
      return response.data.data;
    } catch (err: any) {
      error.value = err.message;
      return null;
    }
  }

  /**
   * 解决伏笔
   */
  async function resolveForeshadowing(bookId: string, id: string, resolveAt?: string) {
    try {
      await axios.post(`${API_URL}/ai/foreshadowings/${id}/resolve`, { resolveAt });
      await loadContext(bookId);
    } catch (err: any) {
      error.value = err.message;
    }
  }

  /**
   * 更新角色详情
   */
  async function updateCharacterProfile(characterId: string, input: Partial<CharacterProfile>) {
    try {
      const response = await axios.post(`${API_URL}/ai/character-profile`, {
        characterId,
        ...input,
      });
      return response.data.data;
    } catch (err: any) {
      error.value = err.message;
      return null;
    }
  }

  /**
   * 创建角色
   */
  async function createCharacter(bookId: string, data: {
    name: string; role?: string; personality?: string; background?: string;
    goal?: string; strength?: string; weakness?: string;
  }) {
    try {
      const response = await axios.post(`${API_URL}/ai/character`, {
        bookId,
        name: data.name,
        role: data.role || 'supporting',
        bio: `${data.personality || ''}\n背景: ${data.background || ''}\n目标: ${data.goal || ''}`,
      });
      const charId = response.data?.data?.id;
      if (charId) {
        await updateCharacterProfile(charId, {
          personality: data.personality,
          background: data.background,
          currentGoal: data.goal,
          strength: data.strength,
          weakness: data.weakness,
        });
      }
      await loadContext(bookId);
      return response.data.data;
    } catch (err: any) {
      error.value = err.message;
      return null;
    }
  }

  /**
   * 创建角色关系
   */
  async function createRelationship(bookId: string, fromId: string, toId: string, type: string, description?: string, status?: string) {
    try {
      const response = await axios.post(`${API_URL}/ai/relationships`, {
        bookId,
        fromId,
        toId,
        type,
        description,
        status,
      });
      await loadContext(bookId);
      return response.data.data;
    } catch (err: any) {
      error.value = err.message;
      return null;
    }
  }

  /** 更新角色关系 */
  async function updateRelationship(id: string, bookId: string, input: { type?: string; description?: string; status?: string }) {
    try {
      await axios.put(`${API_URL}/ai/relationships/${id}`, input);
      await loadContext(bookId);
    } catch (err: any) { error.value = err.message; }
  }

  /** 删除角色关系 */
  async function deleteRelationship(id: string, bookId: string) {
    try {
      await axios.delete(`${API_URL}/ai/relationships/${id}`);
      await loadContext(bookId);
    } catch (err: any) { error.value = err.message; }
  }

  /** AI 建议角色关系 */
  async function suggestRelationships(bookId: string): Promise<Array<{
    fromName: string; toName: string; type: string; description: string; status: string;
  }>> {
    try {
      const resp = await axios.post(`${API_URL}/ai/suggest-relationships`, { bookId });
      return resp.data.suggestions || [];
    } catch (err: any) {
      error.value = err.message;
      return [];
    }
  }

  // ===== 新增 CRUD：更新/删除 =====

  /** 更新世界观设定 */
  async function updateWorldSetting(id: string, bookId: string, input: Partial<WorldSetting>) {
    try {
      await axios.put(`${API_URL}/ai/world-settings/${id}`, input);
      await loadContext(bookId);
    } catch (err: any) { error.value = err.message; }
  }

  /** 删除世界观设定 */
  async function deleteWorldSetting(id: string, bookId: string) {
    try {
      await axios.delete(`${API_URL}/ai/world-settings/${id}`);
      await loadContext(bookId);
    } catch (err: any) { error.value = err.message; }
  }

  /** 更新剧情线 */
  async function updatePlotLine(id: string, bookId: string, input: { title?: string; description?: string; type?: string }) {
    try {
      await axios.put(`${API_URL}/ai/plot-lines/${id}`, input);
      await loadContext(bookId);
    } catch (err: any) { error.value = err.message; }
  }

  /** 删除剧情线 */
  async function deletePlotLine(id: string, bookId: string) {
    try {
      await axios.delete(`${API_URL}/ai/plot-lines/${id}`);
      await loadContext(bookId);
    } catch (err: any) { error.value = err.message; }
  }

  /** 删除伏笔 */
  async function deleteForeshadowing(id: string, bookId: string) {
    try {
      await axios.delete(`${API_URL}/ai/foreshadowings/${id}`);
      await loadContext(bookId);
    } catch (err: any) { error.value = err.message; }
  }

  /** 更新伏笔 */
  async function updateForeshadowing(id: string, bookId: string, input: { title?: string; content?: string }) {
    try {
      await axios.put(`${API_URL}/ai/foreshadowings/${id}`, input);
      await loadContext(bookId);
    } catch (err: any) { error.value = err.message; }
  }

  /** 回收伏笔 */
  async function collectForeshadowing(id: string, bookId: string) {
    try {
      await axios.put(`${API_URL}/ai/foreshadowings/${id}/resolve`, {});
      await loadContext(bookId);
    } catch (err: any) { error.value = err.message; }
  }

  /** 废弃伏笔 */
  async function abandonForeshadowing(id: string, bookId: string) {
    try {
      await axios.put(`${API_URL}/ai/foreshadowings/${id}/abandon`, {});
      await loadContext(bookId);
    } catch (err: any) { error.value = err.message; }
  }

  /** 删除角色 */
  async function deleteCharacter(characterId: string, bookId: string) {
    try {
      await axios.delete(`${API_URL}/books/${bookId}/characters/${characterId}`);
      await loadContext(bookId);
    } catch (err: any) { error.value = err.message; }
  }

  /** AI 辅助编辑——调用后端返回字段建议 */
  async function assistContent(
    bookId: string,
    type: 'character' | 'world_setting' | 'outline',
    currentData: Record<string, any>,
  ): Promise<Record<string, string>> {
    try {
      const response = await axios.post(`${API_URL}/ai/assist-content`, {
        bookId,
        type,
        currentData,
      });
      return response.data?.suggestions || {};
    } catch (err: any) {
      error.value = err.message;
      return {};
    }
  }

  /**
   * 调用 Agent 生成内容
   */
  async function runAgent(
    bookId: string,
    chapterId: string | undefined,
    content: string,
    command: string,
    selectedText?: string,
  ) {
    agentStatus.value = { type: 'WRITER', status: 'thinking', message: 'AI 思考中...' };
    aiResult.value = '';
    warnings.value = [];
    error.value = null;

    try {
      const response = await axios.post(`${API_URL}/ai/agent`, {
        bookId,
        chapterId,
        content,
        command,
        selectedText,
      });

      const data = response.data.data as AgentResponse;
      aiResult.value = data.result || '';

      if (data.warnings && data.warnings.length > 0) {
        warnings.value = data.warnings;
        agentStatus.value = { type: 'CONSISTENCY', status: 'completed', message: '发现潜在问题' };
      } else {
        agentStatus.value = { type: 'WRITER', status: 'completed', message: '生成完成' };
      }

      return data;
    } catch (err: any) {
      error.value = err.response?.data?.message || err.message;
      agentStatus.value = { type: 'WRITER', status: 'error', message: error.value || '生成失败' };
      return null;
    } finally {
      // 保持短暂延迟，让用户看到完成状态
      setTimeout(() => {
        if (agentStatus.value.status === 'completed' || agentStatus.value.status === 'error') {
          // 状态会在下次调用时重置
        }
      }, 2000);
    }
  }

  /**
   * RAG 检索
   */
  async function retrieve(bookId: string, content: string) {
    try {
      const response = await axios.get(`${API_URL}/ai/retrieve/${bookId}`, {
        params: { content },
      });
      retrievalResults.value = response.data.data || [];
      return retrievalResults.value;
    } catch (err: any) {
      error.value = err.message;
      return [];
    }
  }

  /**
   * AI 全文分析 (SSE 流式) — 读取全书内容进行深度分析
   * 分析类型: foreshadowing(伏笔) | character_arc(角色弧线) | pacing(节奏) | comprehensive(全面)
   */
  async function analyzeFullText(
    bookId: string,
    analysisType: 'foreshadowing' | 'character_arc' | 'pacing' | 'comprehensive' = 'comprehensive',
    signal?: AbortSignal,
  ) {
    chatLoading.value = true;
    error.value = null;

    const typeLabels: Record<string, string> = {
      foreshadowing: '伏笔分析',
      character_arc: '角色弧线分析',
      pacing: '节奏分析',
      comprehensive: '全面分析',
    };

    // 插入 AI 消息占位
    const aiMsgId = `msg_${Date.now()}_analyze`;
    chatMessages.value.push({
      id: aiMsgId,
      role: 'assistant',
      content: '●●●',
      timestamp: Date.now(),
    });

    try {
      const authToken = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/ai/analyze/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({ bookId, analysisType }),
        signal,
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let fullReply = '';
      let suggestions: any[] = [];
      let firstToken = true;

      const parser = createSSEParser((event) => {
        if (event.type === 'token') {
          if (firstToken) {
            fullReply = '';
            firstToken = false;
          }
          fullReply += event.data.text;
          const msgIdx = chatMessages.value.findIndex(m => m.id === aiMsgId);
          if (msgIdx >= 0) {
            chatMessages.value[msgIdx] = {
              ...chatMessages.value[msgIdx],
              content: `📊 **${typeLabels[analysisType]}** 进行中...\n\n${fullReply}`,
            };
          }
        } else if (event.type === 'done') {
          if (event.data.analysis) fullReply = event.data.analysis;
          suggestions = event.data.suggestions || [];
        } else if (event.type === 'error') {
          throw new Error(event.data.message);
        }
      });

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        parser.feed(decoder.decode(value, { stream: true }));
      }
      parser.flush();

      // 最终更新消息，附带可操作的建议
      const msgIdx = chatMessages.value.findIndex(m => m.id === aiMsgId);
      if (msgIdx >= 0) {
        const suggestedActions = suggestions
          .filter((s: any) => s.title || s.content || s.suggestion)
          .slice(0, 8) // 最多展示 8 条可操作建议
          .map((s: any) => {
            const category = s.category || s.type || 'foreshadowing';
            if (category === 'foreshadowing' || analysisType === 'foreshadowing') {
              return {
                type: 'create_foreshadowing',
                label: `🔮 植入: ${s.title || s.content?.slice(0, 20)}`,
                data: { title: s.title || `伏笔-第${s.chapter}章`, content: s.content || s.suggestion },
              };
            }
            return {
              type: 'agent_command',
              label: `✏️ ${s.title || s.suggestion?.slice(0, 20)}`,
              data: { command: 'improve' },
            };
          });

        chatMessages.value[msgIdx] = {
          ...chatMessages.value[msgIdx],
          content: fullReply || '分析完成',
          suggestedActions: suggestedActions.length > 0 ? suggestedActions : undefined,
        };
      }

      agentStatus.value = { type: 'CONSISTENCY', status: 'completed', message: '分析完成' };
      return { analysis: fullReply, suggestions };
    } catch (err: any) {
      const msgIdx = chatMessages.value.findIndex(m => m.id === aiMsgId);
      if (msgIdx >= 0) {
        chatMessages.value[msgIdx] = {
          ...chatMessages.value[msgIdx],
          content: `❌ 全文分析失败: ${err.message}`,
        };
      }
      error.value = err.message;
      return null;
    } finally {
      chatLoading.value = false;
    }
  }

  /**
   * 发送聊天消息 (SSE 流式)
   */
  async function sendChat(bookId: string, message: string, chapterId?: string, currentContent?: string, signal?: AbortSignal) {
    const userMsg: ChatMessage = {
      id: `msg_${Date.now()}_user`,
      role: 'user',
      content: message,
      timestamp: Date.now(),
    };
    chatMessages.value.push(userMsg);
    chatLoading.value = true;
    error.value = null;
    agentStatus.value = { type: 'WRITER', status: 'thinking', message: '正在思考...' };

    // 自动更新会话标题：第一条消息时，用消息内容作为会话标题
    if (activeSessionId.value && chatMessages.value.filter(m => m.role === 'user').length === 1) {
      const session = sessions.value.find(s => s.id === activeSessionId.value);
      if (session && (session.title.startsWith('新对话') || session.title === chapterId)) {
        session.title = message.slice(0, 30) + (message.length > 30 ? '...' : '');
        session.updatedAt = Date.now();
        saveSessionsList();
      }
    }

    // 插入 AI placeholder 消息（立即显示打字指示器）
    const aiMsgId = `msg_${Date.now()}_ai`;
    const aiMsg: ChatMessage = {
      id: aiMsgId,
      role: 'assistant',
      content: '●●●',
      timestamp: Date.now(),
      isThinking: deepThinkingEnabled.value,
    };
    chatMessages.value.push(aiMsg);

    // 选择端点：深度思考 or 普通流式
    const useDeepThink = deepThinkingEnabled.value;
    const endpoint = useDeepThink ? `${API_URL}/ai/deep-think/stream` : `${API_URL}/ai/chat/stream`;

    try {
      const history = chatMessages.value
        .filter(m => m.id !== userMsg.id && m.id !== aiMsgId)
        .slice(-10)
        .map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));

      const authToken = localStorage.getItem('token');
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          bookId,
          message,
          history,
          ...(chapterId && { chapterId }),
          ...(currentContent && { currentContent: currentContent.slice(-15000) }),
          ...(useDeepThink && { contextScope: contextScope.value }),
          ...(selectedModelId.value && { modelId: selectedModelId.value }),
        }),
        signal,
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let fullReply = '';
      let thinkingText = '';
      let suggestedActions: any[] | undefined;
      let firstToken = true;
      let inThinkingPhase = false;

      const parser = createSSEParser((event) => {
        // Deep think events
        if (event.type === 'thinking_start') {
          inThinkingPhase = true;
          agentStatus.value = { type: 'WRITER', status: 'thinking', message: '深度思考中...' };
          const msgIdx = chatMessages.value.findIndex(m => m.id === aiMsgId);
          if (msgIdx >= 0) {
            chatMessages.value[msgIdx] = {
              ...chatMessages.value[msgIdx],
              isThinking: true,
              thinking: '',
              content: '●●●',
            };
          }
        } else if (event.type === 'thinking_token') {
          thinkingText += event.data.text;
          const msgIdx = chatMessages.value.findIndex(m => m.id === aiMsgId);
          if (msgIdx >= 0) {
            chatMessages.value[msgIdx] = {
              ...chatMessages.value[msgIdx],
              thinking: thinkingText,
            };
          }
        } else if (event.type === 'thinking_done') {
          inThinkingPhase = false;
          thinkingText = event.data.thinking || thinkingText;
          const msgIdx = chatMessages.value.findIndex(m => m.id === aiMsgId);
          if (msgIdx >= 0) {
            chatMessages.value[msgIdx] = {
              ...chatMessages.value[msgIdx],
              isThinking: false,
              thinking: thinkingText,
            };
          }
        } else if (event.type === 'reply_start') {
          agentStatus.value = { type: 'WRITER', status: 'writing', message: '正在生成回复...' };
        } else if (event.type === 'token') {
          if (firstToken) {
            fullReply = '';
            firstToken = false;
          }
          fullReply += event.data.text;
          const msgIdx = chatMessages.value.findIndex(m => m.id === aiMsgId);
          if (msgIdx >= 0) {
            chatMessages.value[msgIdx] = {
              ...chatMessages.value[msgIdx],
              content: fullReply,
            };
          }
        } else if (event.type === 'done') {
          if (event.data.reply) fullReply = event.data.reply;
          if (event.data.thinking) thinkingText = event.data.thinking;
          suggestedActions = event.data.suggestedActions;
        } else if (event.type === 'error') {
          throw new Error(event.data.message);
        }
      });

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        parser.feed(decoder.decode(value, { stream: true }));
      }
      parser.flush();

      agentStatus.value = { type: 'WRITER', status: 'completed', message: '回复完成' };

      // 最终更新
      const msgIdx = chatMessages.value.findIndex(m => m.id === aiMsgId);
      if (msgIdx >= 0) {
        chatMessages.value[msgIdx] = {
          ...chatMessages.value[msgIdx],
          content: fullReply || '无回复',
          suggestedActions,
          thinking: thinkingText || undefined,
          isThinking: false,
        };
      }

      return chatMessages.value.find(m => m.id === aiMsgId)!;
    } catch (err: any) {
      const msgIdx = chatMessages.value.findIndex(m => m.id === aiMsgId);
      if (msgIdx >= 0) {
        chatMessages.value[msgIdx] = {
          ...chatMessages.value[msgIdx],
          content: '抱歉，AI 暂时无法响应，请稍后重试。',
        };
      }
      error.value = err.message;
      return chatMessages.value.find(m => m.id === aiMsgId)!;
    } finally {
      chatLoading.value = false;
    }
  }

  /**
   * 生成创意计划 (SSE 流式)
   */
  async function generateCreativePlan(bookId: string, prompt: string, chapterCount: number = 3) {
    chatLoading.value = true;
    agentStatus.value = { type: 'PLANNER', status: 'thinking', message: '正在构思创作计划...' };
    error.value = null;

    // 插入需求确认消息（立即可见）
    const streamMsgId = `msg_${Date.now()}_stream`;
    chatMessages.value.push({
      id: streamMsgId,
      role: 'assistant',
      content: `🎯 已理解您的需求：\n> ${prompt}\n\n⏳ 正在为您规划创作方案...`,
      timestamp: Date.now(),
    });

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/ai/creative-plan/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ bookId, prompt, chapterCount }),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let tokenCount = 0;
      let plan: CreativePlan | null = null;

      const parser = createSSEParser((event) => {
        if (event.type === 'token') {
          tokenCount++;
          if (tokenCount % 20 === 0) {
            const progress = Math.min(95, Math.round(tokenCount / 40 * 100));
            agentStatus.value = {
              type: 'PLANNER',
              status: 'thinking',
              message: `正在构思中 (${progress}%)...`,
            };
            // 更新消息中的进度提示
            const msgIdx = chatMessages.value.findIndex(m => m.id === streamMsgId);
            if (msgIdx >= 0) {
              chatMessages.value[msgIdx] = {
                ...chatMessages.value[msgIdx],
                content: `🎯 已理解您的需求：\n> ${prompt}\n\n⏳ 正在构思中 (${progress}%)...`,
              };
            }
          }
        } else if (event.type === 'status') {
          agentStatus.value = { type: 'PLANNER', status: 'thinking', message: event.data.step };
        } else if (event.type === 'plan') {
          plan = event.data;
          pendingPlan.value = plan;
        } else if (event.type === 'error') {
          throw new Error(event.data.message);
        }
      });

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        parser.feed(decoder.decode(value, { stream: true }));
      }
      parser.flush();

      if (plan as CreativePlan | null) {
        const p = plan as unknown as CreativePlan;
        agentStatus.value = { type: 'PLANNER', status: 'completed', message: '创作计划已生成' };

        // 替换为最终展示 — 摘要式，不显示原始 JSON
        const msgIdx = chatMessages.value.findIndex(m => m.id === streamMsgId);
        if (msgIdx >= 0) {
          chatMessages.value[msgIdx] = {
            ...chatMessages.value[msgIdx],
            content: `✅ 创作方案「${p.title}」已就绪：\n\n` +
              `📖 **题材**: ${p.genre} | **风格**: ${p.tone}\n` +
              `🌍 **世界观**: ${p.worldSetting?.background?.slice(0, 80)}...\n` +
              `👥 **角色** (${p.characters?.length || 0}): ${p.characters?.map((c: any) => `${c.name}(${c.role})`).join('、') || '无'}\n` +
              `📋 **剧情线** (${p.plotLines?.length || 0}): ${p.plotLines?.map((pl: any) => pl.title).join('、') || '无'}\n` +
              `📚 **章节大纲**: ${p.chapterOutlines?.length || 0} 章\n` +
              `🔮 **伏笔**: ${p.foreshadowings?.length || 0} 个\n\n` +
              `点击下方按钮确认执行，将自动创建所有设定并生成章节正文。`,
            suggestedActions: [{
              type: 'approve_plan',
              label: '✅ 确认执行计划',
              data: { plan: p },
            }],
          };
        }

        return p;
      } else {
        throw new Error('未能解析创作计划');
      }
    } catch (err: any) {
      error.value = err.message;
      agentStatus.value = { type: 'PLANNER', status: 'error', message: '计划生成失败' };

      const msgIdx = chatMessages.value.findIndex(m => m.id === streamMsgId);
      if (msgIdx >= 0) {
        chatMessages.value[msgIdx] = {
          ...chatMessages.value[msgIdx],
          content: `❌ 计划生成失败: ${err.message}\n\n请重新描述需求或稍后重试。`,
        };
      }
      return null;
    } finally {
      chatLoading.value = false;
    }
  }

  /**
   * 执行创意计划 (SSE 流式) - 实时推送创建进度和章节内容
   */
  async function executeCreativePlan(bookId: string, volumeId?: string) {
    if (!pendingPlan.value) return null;

    const plan = pendingPlan.value;
    agentStatus.value = { type: 'WRITER', status: 'writing', message: '正在执行创作计划...' };

    const totalSteps = 1 + plan.characters.length + plan.plotLines.length + plan.foreshadowings.length + plan.chapterOutlines.length;
    planExecStatus.value = { step: '创建世界观', current: 0, total: totalSteps };

    // 插入一个 progress 消息（隐藏流式输出，只显示进度）
    const execMsgId = `msg_${Date.now()}_exec`;
    const execMsg: ChatMessage = {
      id: execMsgId,
      role: 'assistant',
      content: '⏳ 正在执行创作计划，请稍候...\n\n📋 执行步骤：\n',
      timestamp: Date.now(),
    };
    chatMessages.value.push(execMsg);

    // 进度记录（不显示原始内容token）
    const completedSteps: string[] = [];
    const chapterWordCounts: Record<number, number> = {};

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/ai/creative-plan/stream-execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ bookId, plan, volumeId }),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let finalResult: any = null;
      let currentChapterTitle = '';

      const parser = createSSEParser((event) => {
        if (event.type === 'progress') {
          const step = event.data.step;
          const cur = event.data.current ?? 0;
          const tot = event.data.total ?? totalSteps;
          planExecStatus.value = { step, current: cur, total: tot };
          agentStatus.value = { type: 'WRITER', status: 'writing', message: `${step} (${cur}/${tot})` };

          if (completedSteps.length > 0 && !completedSteps[completedSteps.length - 1].startsWith('✅')) {
            completedSteps[completedSteps.length - 1] = `✅ ${completedSteps[completedSteps.length - 1].replace(/^⏳\s*/, '')}`;
          }
          completedSteps.push(`⏳ ${step}`);

          const msgIdx = chatMessages.value.findIndex(m => m.id === execMsgId);
          if (msgIdx >= 0) {
            const pct = Math.round((cur / tot) * 100);
            chatMessages.value[msgIdx] = {
              ...chatMessages.value[msgIdx],
              content: `⏳ 正在执行创作计划... (${pct}%)\n\n📋 执行进度：\n${completedSteps.map(s => `  ${s}`).join('\n')}\n`,
            };
          }
        } else if (event.type === 'chapter_token') {
          const ci = event.data.chapterIndex;
          currentChapterTitle = event.data.title || currentChapterTitle;
          chapterWordCounts[ci] = (chapterWordCounts[ci] || 0) + event.data.text.length;
          if (chapterWordCounts[ci] % 50 < event.data.text.length) {
            agentStatus.value = {
              type: 'WRITER',
              status: 'writing',
              message: `正在生成「${currentChapterTitle}」(${chapterWordCounts[ci]} 字)`,
            };
          }
        } else if (event.type === 'chapter_done') {
          const ci = event.data?.chapterIndex ?? Object.keys(chapterWordCounts).length - 1;
          const wc = chapterWordCounts[ci] || 0;
          if (completedSteps.length > 0 && completedSteps[completedSteps.length - 1].startsWith('⏳')) {
            completedSteps[completedSteps.length - 1] = `✅ ${completedSteps[completedSteps.length - 1].replace(/^⏳\s*/, '')} (${wc} 字)`;
          }
          const msgIdx = chatMessages.value.findIndex(m => m.id === execMsgId);
          if (msgIdx >= 0) {
            const totalWc = Object.values(chapterWordCounts).reduce((s, w) => s + w, 0);
            chatMessages.value[msgIdx] = {
              ...chatMessages.value[msgIdx],
              content: `⏳ 正在执行创作计划...\n\n📋 执行进度：\n${completedSteps.map(s => `  ${s}`).join('\n')}\n\n📊 已生成 ${totalWc} 字\n`,
            };
          }
        } else if (event.type === 'done') {
          finalResult = event.data;
        } else if (event.type === 'error') {
          throw new Error(event.data.message);
        }
      });

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        parser.feed(decoder.decode(value, { stream: true }));
      }
      parser.flush();

      // 最后一步标记完成
      if (completedSteps.length > 0 && completedSteps[completedSteps.length - 1].startsWith('⏳')) {
        completedSteps[completedSteps.length - 1] = `✅ ${completedSteps[completedSteps.length - 1].replace(/^⏳\s*/, '')}`;
      }

      planExecStatus.value = { step: '完成', current: totalSteps, total: totalSteps };
      pendingPlan.value = null;
      agentStatus.value = { type: 'WRITER', status: 'completed', message: '创作计划执行完成！' };

      const totalWords = finalResult?.chapterResults?.reduce((s: number, c: any) => s + (c.wordCount || 0), 0) || 0;

      // 替换执行消息为最终摘要
      const msgIdx = chatMessages.value.findIndex(m => m.id === execMsgId);
      if (msgIdx >= 0) {
        chatMessages.value[msgIdx] = {
          ...chatMessages.value[msgIdx],
          content: `✅ 创作计划执行完成！\n\n📊 生成结果：\n` +
            `  - 🌍 世界观: 已创建\n` +
            `  - 👤 角色: ${finalResult?.characterIds?.length || 0} 个\n` +
            `  - 📖 剧情线: ${finalResult?.plotLineIds?.length || 0} 条\n` +
            `  - 🔮 伏笔: ${finalResult?.foreshadowingIds?.length || 0} 个\n` +
            `  - 📝 章节: ${finalResult?.chapterResults?.length || 0} 章 (${totalWords} 字)\n\n` +
            `所有内容已保存，可以在编辑器中查看和修改。`,
        };
      }

      await loadContext(bookId);
      return finalResult;
    } catch (err: any) {
      error.value = err.message;
      agentStatus.value = { type: 'WRITER', status: 'error', message: '计划执行失败' };
      planExecStatus.value = null;

      const msgIdx = chatMessages.value.findIndex(m => m.id === execMsgId);
      if (msgIdx >= 0) {
        chatMessages.value[msgIdx] = {
          ...chatMessages.value[msgIdx],
          content: `❌ 计划执行出错: ${err.message}\n\n已完成步骤：\n${completedSteps.filter(s => s.startsWith('✅')).map(s => `  ${s}`).join('\n') || '  无'}`,
        };
      }
      return null;
    }
  }

  /**
   * 拒绝/取消创意计划
   */
  function rejectPlan() {
    pendingPlan.value = null;
    planExecStatus.value = null;

    const msg: ChatMessage = {
      id: `msg_${Date.now()}_reject`,
      role: 'assistant',
      content: '已取消当前计划。您可以重新描述创作需求，我会为您生成新的方案。',
      timestamp: Date.now(),
    };
    chatMessages.value.push(msg);
  }

  /**
   * 清空聊天记录
   */
  function clearChat() {
    chatMessages.value = [];
    pendingPlan.value = null;
    planExecStatus.value = null;
    // 清除当前会话的持久化消息
    if (activeSessionId.value) {
      localStorage.removeItem(CHAT_STORAGE_PREFIX + activeSessionId.value);
    }
  }

  /**
   * 重置状态
   */
  function reset() {
    agentStatus.value = { type: 'WRITER', status: 'idle' };
    aiResult.value = '';
    warnings.value = [];
    error.value = null;
  }

  return {
    // State
    agentStatus,
    isProcessing,
    worldSettings,
    plotLines,
    foreshadowings,
    characters,
    relationships,
    retrievalResults,
    aiResult,
    warnings,
    error,
    chatMessages,
    pendingPlan,
    planExecStatus,
    chatLoading,
    // Multi-session & new features
    sessions,
    activeSessionId,
    contextScope,
    activeToolMode,
    activeRightTool,
    deepThinkingEnabled,
    remainingQuota,
    toolAnalysisResult,
    // Inline polish
    polishSuggestions,
    polishLoading,
    currentPolishIndex,

    // Actions
    loadContext,
    loadChatHistory,
    clearChatHistory,
    createNewSession,
    switchSession,
    deleteSession,
    loadSessionsList,
    saveSessionsList,
    runToolAnalysis,
    cancelToolAnalysis,
    clearToolAnalysis,
    // Inline polish actions
    requestInlinePolish,
    acceptPolishSuggestion,
    rejectPolishSuggestion,
    acceptAllPolish,
    rejectAllPolish,
    nextPolishSuggestion,
    prevPolishSuggestion,
    cancelPolish,
    clearPolish,
    createWorldSetting,
    updateWorldSetting,
    deleteWorldSetting,
    createPlotLine,
    updatePlotLine,
    deletePlotLine,
    createForeshadowing,
    deleteForeshadowing,
    updateForeshadowing,
    resolveForeshadowing,
    collectForeshadowing,
    abandonForeshadowing,
    updateCharacterProfile,
    createCharacter,
    deleteCharacter,
    createRelationship,
    updateRelationship,
    deleteRelationship,
    suggestRelationships,
    assistContent,
    runAgent,
    retrieve,
    sendChat,
    analyzeFullText,
    generateCreativePlan,
    executeCreativePlan,
    rejectPlan,
    clearChat,
    reset,
    // Model selection
    availableModels,
    selectedModelId,
    defaultModelId,
    effectiveModelId,
    currentModelLabel,
    currentModelSpeed,
    fetchAvailableModels,
    setModel,
  };
});
