<script setup lang="ts">
import { ref, computed, watch, onMounted, nextTick } from 'vue';
import { useAgentStore, type ChatMessage, type ChatSession, type CharacterProfile, type ContextScope, type AiToolMode, type RightPanelTool, type PlotLine, type Foreshadowing } from '@/stores/agent';
import { useBookStore } from '@/stores/book';
import { marked } from 'marked';
import { textToHtml } from '@/lib/textToHtml';
import AiPanelHeader from './AiPanelHeader.vue';
import RightToolPanel from './RightToolPanel.vue';
import CharacterEditor from './CharacterEditor.vue';
import WorldSettingEditor from './WorldSettingEditor.vue';
import RelationshipGraph from './RelationshipGraph.vue';
import PlotLineEditor from './PlotLineEditor.vue';
import ForeshadowingEditor from './ForeshadowingEditor.vue';
import OrchestrationPanel from './OrchestrationPanel.vue';

marked.setOptions({ breaks: true, gfm: true });

function renderMarkdown(text: string): string {
  if (!text) return '';
  const cleaned = text.replace(/<!--ACTIONS:[\s\S]*?-->/g, '').trim();
  return marked.parse(cleaned) as string;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

const props = defineProps<{
  bookId: string;
  chapterId?: string;
  chapterTitle?: string;
  content?: string;
  activeTab?: 'ai' | 'outline' | 'character' | 'setting' | null;
}>();

const emit = defineEmits<{
  (e: 'apply', content: string): void;
  (e: 'insert', content: string): void;
  (e: 'refreshChapters'): void;
  (e: 'showDiff', data: { oldContent: string; newContent: string }): void;
  (e: 'closePanel'): void;
  (e: 'navigateToChapter', chapterId: string): void;
}>();

const agentStore = useAgentStore();
const bookStore = useBookStore();

// === 面板层级 ===
type LayerType = 'strategy' | 'tactical' | 'execution';
const activeLayer = ref<LayerType>('execution');

// === 历史对话面板 ===
const showHistoryPanel = ref(false);

// === 深度思考展开状态 ===
const expandedThinking = ref<Record<string, boolean>>({});

// === 右侧工具面板状态 ===
const toolPanelTools: RightPanelTool[] = ['proofread', 'spelling', 'inspiration', 'writing'];
const activeToolPanel = computed(() => {
  const tool = agentStore.activeRightTool;
  return tool && toolPanelTools.includes(tool) ? tool : null;
});
function handleCloseToolPanel() {
  agentStore.activeRightTool = null;
  agentStore.clearToolAnalysis();
}

watch(() => props.activeTab, (tab) => {
  if (tab === 'ai') activeLayer.value = 'execution';
  else if (tab === 'outline') activeLayer.value = 'strategy';
  else if (tab === 'character') activeLayer.value = 'tactical';
  else if (tab === 'setting') activeLayer.value = 'strategy';
}, { immediate: true });

onMounted(async () => {
  if (props.bookId) {
    await agentStore.loadContext(props.bookId);
    agentStore.loadChatHistory(props.bookId);
  }
});

watch(() => props.bookId, async (newBookId) => {
  if (newBookId) {
    await agentStore.loadContext(newBookId);
    agentStore.loadChatHistory(newBookId);
  }
});

// === 世界观 / 剧情线 / 伏笔操作 ===

// === 全屏编辑器 ===
const showCharacterEditor = ref(false);
const editorCharacter = ref<CharacterProfile | null>(null);
function openCharacterEditor(char?: CharacterProfile) {
  editorCharacter.value = char || null;
  showCharacterEditor.value = true;
}
function onCharacterEditorClose() {
  showCharacterEditor.value = false;
  editorCharacter.value = null;
}
async function onCharacterEditorSaved() {
  if (props.bookId) await agentStore.loadContext(props.bookId);
}

const showWorldSettingEditor = ref(false);
const editorWorldSetting = ref<import('@/stores/agent').WorldSetting | null>(null);
function openWorldSettingEditor(ws?: import('@/stores/agent').WorldSetting) {
  editorWorldSetting.value = ws || null;
  showWorldSettingEditor.value = true;
}
function onWorldSettingEditorClose() {
  showWorldSettingEditor.value = false;
  editorWorldSetting.value = null;
}
async function onWorldSettingEditorSaved() {
  if (props.bookId) await agentStore.loadContext(props.bookId);
}

const showPlotLineEditor = ref(false);
const editorPlotLine = ref<PlotLine | null>(null);
function openPlotLineEditor(pl?: PlotLine) {
  editorPlotLine.value = pl || null;
  showPlotLineEditor.value = true;
}
function onPlotLineEditorClose() {
  showPlotLineEditor.value = false;
  editorPlotLine.value = null;
}
async function onPlotLineEditorSaved() {
  if (props.bookId) await agentStore.loadContext(props.bookId);
}

const showForeshadowingEditor = ref(false);
const editorForeshadowing = ref<Foreshadowing | null>(null);
function openForeshadowingEditor(fs?: Foreshadowing) {
  editorForeshadowing.value = fs || null;
  showForeshadowingEditor.value = true;
}
function onForeshadowingEditorClose() {
  showForeshadowingEditor.value = false;
  editorForeshadowing.value = null;
}
async function onForeshadowingEditorSaved() {
  if (props.bookId) await agentStore.loadContext(props.bookId);
}

// === 剧情线/伏笔操作（已迁移到 PlotLineEditor / ForeshadowingEditor 全屏组件） ===

// === 角色操作（已迁移到 CharacterEditor 全屏组件） ===

// === 执行层：AI 命令 ===
const selectedCommand = ref('continue');
const commands = [
  { value: 'continue', label: '续写', icon: '→' },
  { value: 'improve', label: '改进', icon: '✎' },
  { value: 'expand', label: '扩展', icon: '↗' },
  { value: 'summarize', label: '总结', icon: '≡' },
  { value: 'generate', label: '生成', icon: '★' },
];
const writingContent = computed(() => props.content || '');

// === 命令结果 diff 状态 ===
const commandResultDiff = ref<{
  command: string;
  oldContent: string;
  newContent: string;
  status: 'pending' | 'accepted' | 'rejected';
} | null>(null);

async function runAi() {
  if (!props.bookId || !writingContent.value) return;
  commandResultDiff.value = null;
  const result = await agentStore.runAgent(props.bookId, props.chapterId, writingContent.value, selectedCommand.value);
  if (result?.result) {
    commandResultDiff.value = {
      command: selectedCommand.value,
      oldContent: writingContent.value,
      newContent: result.result,
      status: 'pending',
    };
  }
}

/** 接受命令结果 */
function acceptCommandResult() {
  if (!commandResultDiff.value) return;
  const diff = commandResultDiff.value;
  if (diff.command === 'continue') {
    emit('insert', diff.newContent);
  } else {
    emit('apply', diff.newContent);
  }
  commandResultDiff.value = { ...diff, status: 'accepted' };
  agentStore.reset();
}

/** 拒绝命令结果 */
function rejectCommandResult() {
  if (!commandResultDiff.value) return;
  commandResultDiff.value = { ...commandResultDiff.value, status: 'rejected' };
  agentStore.reset();
}

function applyToDocument() { if (agentStore.aiResult) emit('apply', agentStore.aiResult); }
function insertToDocument() { if (agentStore.aiResult) emit('insert', agentStore.aiResult); }

// === 章纲表单 ===
const showOutlineForm = ref(false);
const outlineFormTitle = ref('');
const outlineFormContent = ref('');
const editingOutlineId = ref<string | null>(null);

function editOutline(ol: { id: string; title: string; content: string }) {
  editingOutlineId.value = ol.id;
  outlineFormTitle.value = ol.title;
  outlineFormContent.value = ol.content || '';
  showOutlineForm.value = true;
}

async function saveOutline() {
  if (!outlineFormTitle.value.trim()) return;
  if (editingOutlineId.value) {
    await agentStore.updateOutline(editingOutlineId.value, props.bookId, {
      title: outlineFormTitle.value.trim(),
      content: outlineFormContent.value.trim(),
    });
  } else {
    await agentStore.createOutline(props.bookId, outlineFormTitle.value.trim(), outlineFormContent.value.trim());
  }
  showOutlineForm.value = false;
  editingOutlineId.value = null;
  outlineFormTitle.value = '';
  outlineFormContent.value = '';
}

async function handleDeleteOutline(id: string) {
  await agentStore.deleteOutline(id, props.bookId);
}

// === 多步编排模式 ===
const orchestrationMode = ref(false);

// === 聊天 UI ===
const chatInput = ref('');
const chatContainerRef = ref<HTMLElement | null>(null);
let activeAbortController: AbortController | null = null;
const actionExecuting = ref(false); // 防止 action 执行期间并发发送消息

function cancelGeneration() {
  if (activeAbortController) { activeAbortController.abort(); activeAbortController = null; }
  agentStore.chatLoading = false;
  agentStore.agentStatus = { type: 'WRITER', status: 'idle' };
  const loadingIdx = agentStore.chatMessages.findIndex(m => m.content === '●●●');
  if (loadingIdx >= 0) {
    agentStore.chatMessages[loadingIdx] = { ...agentStore.chatMessages[loadingIdx], content: '⏹ 已取消生成' };
  }
}

// === 多步编排确认/取消 ===
async function handleOrchestrationConfirm() {
  await agentStore.confirmOrchestration();
  emit('refreshChapters');
  await nextTick();
  scrollToBottom();
}

function handleOrchestrationCancel() {
  agentStore.cancelOrchestration();
}

// === 上下文指示器 ===
const contextIndicators = computed(() => {
  const items: Array<{ label: string }> = [];
  const charCount = agentStore.characters.length;
  const plotCount = agentStore.plotLines.length;
  const chapterCount = bookStore.currentBook?.chapters?.length ?? 0;
  if (chapterCount > 0) items.push({ label: `${chapterCount}章` });
  if (charCount > 0) items.push({ label: `${charCount}角色` });
  if (plotCount > 0) items.push({ label: `${plotCount}剧情线` });
  if (props.chapterId) items.push({ label: '当前章节' });
  return items;
});

// === 智能快捷提示 ===
const quickPrompts = computed(() => {
  const hasChapters = (bookStore.currentBook?.chapters?.length ?? 0) > 0;
  const hasCharacters = agentStore.characters.length > 0;
  const hasContent = !!props.content && props.content.length > 10;
  const hasChapter = !!props.chapterId;
  const prompts: Array<{ label: string }> = [];

  if (!hasChapters && !hasCharacters) {
    prompts.push({ label: '帮我从零开始创建一本小说' });
    prompts.push({ label: '帮我设计主角和配角' });
    prompts.push({ label: '帮我构思世界观设定' });
  } else if (hasContent && hasChapter) {
    prompts.push({ label: '开篇如何暗示反派威胁' });
    prompts.push({ label: '叙事视角切换怎样增强代入感' });
    prompts.push({ label: '带来写作灵感的本月新鲜事' });
  } else if (hasChapters) {
    prompts.push({ label: '帮我续写下一章' });
    prompts.push({ label: '分析目前的剧情走向' });
    prompts.push({ label: '帮我植入一个伏笔' });
  } else {
    prompts.push({ label: '帮我写前3章' });
    prompts.push({ label: '帮我构思主线剧情' });
    prompts.push({ label: '帮我完善角色设定' });
  }
  return prompts;
});

// === 预设模板系统 ===
type PromptCategory = 'story' | 'character' | 'revision' | 'pace';
const activePromptCategory = ref<PromptCategory>('story');
const presetPromptMap: Record<PromptCategory, Array<{ title: string; prompt: string }>> = {
  story: [
    { title: '下一章大纲', prompt: '请基于当前剧情，给出下一章的三幕式大纲（起-承-转），并附冲突点与结尾悬念。' },
    { title: '高能开篇', prompt: '请为当前章节写一个200字以内的高吸引力开篇，要求冲突明确、节奏快。' },
    { title: '冲突升级', prompt: '请在不改设定的前提下，设计3种"冲突升级"方案，并说明各自风险与收益。' },
    { title: '埋伏笔', prompt: '请为当前剧情设计2个可回收伏笔，包含埋点位置、回收时机和情绪收益。' },
  ],
  character: [
    { title: '角色小传', prompt: '请为当前主角生成角色小传：童年经历、核心欲望、外在目标、内在缺陷、成长弧线。' },
    { title: '角色对手戏', prompt: '请设计主角与反派的一段对手戏，强调价值观冲突与语言风格差异。' },
    { title: '关系网补全', prompt: '请补全当前已出场角色关系网，标出联盟、矛盾、潜在背叛线。' },
    { title: '台词风格化', prompt: '请给主要角色生成各自的说话习惯与口头禅，并举3句示例台词。' },
  ],
  revision: [
    { title: '润色文风', prompt: '请润色当前内容，提升画面感和节奏感，不改变剧情事实与设定。' },
    { title: '查逻辑漏洞', prompt: '请检查当前章节中的逻辑漏洞、设定冲突、动机不足，并给出修复方案。' },
    { title: '增强爽点', prompt: '请在保持角色人设前提下增强"爽点"，给出具体段落改写建议。' },
    { title: '压缩冗余', prompt: '请识别并压缩冗余叙述，保留信息密度，给出可直接替换文本。' },
  ],
  pace: [
    { title: '节奏诊断', prompt: '请分析当前章节节奏（铺垫/推进/爆点）并给出优化比例建议。' },
    { title: '断章点建议', prompt: '请给出3个适合本章结尾的断章点，并说明读者追更驱动力。' },
    { title: '回顾承接', prompt: '请写一段120字以内的"上章回顾 + 本章承接"，用于章节开头。' },
    { title: '连载节拍', prompt: '请给我一份7天连载节拍建议：每天目标字数、剧情推进点、留钩策略。' },
  ],
};

const presetPromptCategories: Array<{ key: PromptCategory; label: string }> = [
  { key: 'story', label: '剧情' },
  { key: 'character', label: '角色' },
  { key: 'revision', label: '润色' },
  { key: 'pace', label: '节奏' },
];

const activePresetPrompts = computed(() => presetPromptMap[activePromptCategory.value]);

function applyPresetPrompt(prompt: string) { chatInput.value = prompt; }

// === 工具模式 ===
const toolModes: Array<{ key: AiToolMode; label: string }> = [
  { key: 'chat', label: '问答' },
  { key: 'describe', label: '描写' },
  { key: 'extract', label: '提取' },
  { key: 'artist', label: '画师' },
];

const toolModePlaceholders: Record<AiToolMode, string> = {
  chat: '向 AI 助手提问或下达指令...',
  describe: '输入描述，获取描写灵感...',
  extract: '输入关键词，提取设定/人物/世界观...',
  artist: '描述场景或角色，生成插画参考...',
};

// === 上下文范围切换 ===
const scopeOptions: Array<{ key: ContextScope; label: string; badge?: string }> = [
  { key: 'fullBook', label: '全书', badge: '2.0' },
  { key: 'chapter', label: '本章' },
  { key: 'custom', label: '自定义' },
];

// === 发送消息 ===
const streamMaskText = computed(() => {
  if (agentStore.agentStatus.message) return agentStore.agentStatus.message;
  const status = agentStore.agentStatus.status;
  if (status === 'thinking') return '正在分析上下文与写作目标…';
  if (status === 'writing') return '正在生成内容并优化表达…';
  if (status === 'checking') return '正在检查设定一致性与语义连贯性…';
  return 'AI 正在处理中…';
});

/** 智能检测是否需要多步编排（复杂创作请求自动走编排流程） */
function needsOrchestration(text: string): boolean {
  // 模式匹配：复杂创作请求
  const patterns = [
    /根据.{0,10}(内容|章节|情节).{0,10}(写|编写|创作|生成).{0,10}(最新|下一|新).{0,2}章/,
    /写出?.{0,5}(最新|下一|新).{0,2}章/,
    /(编写|创作|生成).{0,10}(最新|下一|新).{0,2}章/,
    /(补全|填补|补充|完善).{0,10}(世界观|角色|章纲|设定|大纲|伏笔|金手指)/,
    /先.{0,20}(扫描|分析|检查).{0,20}再.{0,20}(写|编|生成)/,
    /(逐步|一步步|按步骤).{0,20}(写|创作|生成)/,
    /从.{0,5}(头|零|头到尾).{0,10}(写|开始|创作)/,
    /根据.{0,10}(当前|现有|已有).{0,10}(内容|章节).{0,10}(填补|补全|补充|完善)/,
    /(填补|补全|补充|完善).{0,10}(内在|设定|世界|角色|大纲|伏笔|金手指|剧情)/,
  ];
  if (patterns.some(p => p.test(text))) return true;

  // 内在不完整检测：如果要写章节但内在设定严重缺失，自动走编排
  const isWriteRequest = /(编写|写|生成|创作).{0,10}(第.{1,5}章|章节)/.test(text) || /根据.{0,10}(内容|当前).{0,10}(编写|写)/.test(text);
  if (isWriteRequest) {
    const hasNoChars = (agentStore.characters?.length || 0) === 0;
    const hasNoWorld = (agentStore.worldSettings?.length || 0) === 0;
    const hasNoOutlines = (agentStore.outlines?.length || 0) === 0;
    // 缺少2项以上内在设定 → 走编排先补全
    const missingCount = [hasNoChars, hasNoWorld, hasNoOutlines].filter(Boolean).length;
    if (missingCount >= 2) return true;
  }

  return false;
}

async function sendMessage() {
  const text = chatInput.value.trim();
  if (!text || !props.bookId || agentStore.chatLoading || actionExecuting.value) return;
  chatInput.value = '';
  activeAbortController = new AbortController();

  // 智能路由：复杂创作请求自动进入多步编排模式
  if (orchestrationMode.value || needsOrchestration(text)) {
    await agentStore.startOrchestration(
      props.bookId, text, props.chapterId, props.content,
      activeAbortController.signal,
    );
    activeAbortController = null;
    emit('refreshChapters');
    await nextTick();
    scrollToBottom();
    return;
  }

  const result = await agentStore.sendChat(
    props.bookId, text, props.chapterId, props.content,
    activeAbortController.signal,
  );
  activeAbortController = null;

  // 如果 AI 未返回操作但用户意图明确（如"编写第N章"），自动推断并执行
  let actions = result?.suggestedActions;
  if (!actions?.length) {
    const chapterMatch = text.match(/(编写|写|创作|生成).{0,10}第(\d+|[一二三四五六七八九十百]+)章[：:\s]*(.*)?/);
    if (chapterMatch) {
      const chapterNum = chapterMatch[2];
      const titleSuffix = chapterMatch[3]?.trim();
      const title = titleSuffix ? `第${chapterNum}章 ${titleSuffix}` : `第${chapterNum}章`;
      actions = [{ type: 'create_chapter', label: `编写${title}`, data: { title, generateContent: true, prompt: text } }];
      console.log('[sendMessage] AI 未返回操作，根据用户意图自动推断 create_chapter:', title);
    }
  }

  if (actions?.length) {
    actionExecuting.value = true;
    try {
      for (const action of actions) {
        await autoExecuteAction(action);
      }
    } finally {
      actionExecuting.value = false;
    }
  }
  await nextTick();
  scrollToBottom();
}

// === 操作执行 ===
async function autoExecuteAction(action: { type: string; label: string; data: any }) {
  if (action.type === 'accept_diff') {
    const targetIdx = agentStore.chatMessages.findIndex(m => m.id === action.data.msgId);
    if (targetIdx >= 0 && props.chapterId) {
      const oldContent = action.data.oldContent || '';
      const htmlContent = textToHtml(action.data.content);
      await bookStore.saveChapter(props.chapterId, { content: htmlContent });
      const msg = agentStore.chatMessages[targetIdx];
      agentStore.chatMessages[targetIdx] = {
        ...msg, content: `变更已应用 (${action.data.content.length} 字)`,
        diff: msg.diff ? { ...msg.diff, status: 'accepted' as const } : undefined,
        suggestedActions: oldContent ? [
          { type: 'rollback_diff', label: '撤销此变更', data: { msgId: action.data.msgId, content: oldContent } },
        ] : undefined,
      };
      emit('refreshChapters');
    }
    return;
  }
  if (action.type === 'rollback_diff') {
    const targetIdx = agentStore.chatMessages.findIndex(m => m.id === action.data.msgId);
    if (targetIdx >= 0 && props.chapterId) {
      const htmlContent = textToHtml(action.data.content);
      await bookStore.saveChapter(props.chapterId, { content: htmlContent });
      const msg = agentStore.chatMessages[targetIdx];
      agentStore.chatMessages[targetIdx] = {
        ...msg, content: `变更已撤销，内容已恢复`,
        diff: msg.diff ? { ...msg.diff, status: 'rejected' as const } : undefined,
        suggestedActions: undefined,
      };
      emit('refreshChapters');
    }
    return;
  }
  if (action.type === 'reject_diff') {
    const targetIdx = agentStore.chatMessages.findIndex(m => m.id === action.data.msgId);
    if (targetIdx >= 0) {
      const msg = agentStore.chatMessages[targetIdx];
      agentStore.chatMessages[targetIdx] = {
        ...msg, content: `变更已撤回`,
        diff: msg.diff ? { ...msg.diff, status: 'rejected' as const } : undefined,
        suggestedActions: undefined,
      };
    }
    return;
  }
  if (action.type === 'accept_continue') {
    if (props.chapterId && action.data.content) emit('insert', action.data.content);
    const targetIdx = agentStore.chatMessages.findIndex(m => m.id === action.data.msgId);
    if (targetIdx >= 0) {
      agentStore.chatMessages[targetIdx] = {
        ...agentStore.chatMessages[targetIdx],
        content: `已续写并追加到当前章节 (+${action.data.content.length} 字)`,
        suggestedActions: undefined,
      };
    }
    return;
  }
  if (action.type === 'reject_continue') {
    const targetIdx = agentStore.chatMessages.findIndex(m => m.id === action.data.msgId);
    if (targetIdx >= 0) {
      agentStore.chatMessages[targetIdx] = {
        ...agentStore.chatMessages[targetIdx],
        content: `续写已取消，未修改任何内容`, suggestedActions: undefined,
      };
    }
    return;
  }

  const statusMsgId = `msg_${Date.now()}_auto`;
  agentStore.chatMessages.push({ id: statusMsgId, role: 'assistant', content: '●●●', timestamp: Date.now() });
  await nextTick();
  scrollToBottom();

  const thinkingPhrases = ['正在分析请求...', '正在理解上下文...', '正在构思方案...', '正在生成内容...', '正在优化结果...'];
  let thinkingIdx = 0;
  const startTime = Date.now();
  const thinkingTimer = setInterval(() => {
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const phrase = thinkingPhrases[Math.min(thinkingIdx, thinkingPhrases.length - 1)];
    thinkingIdx++;
    updateStatusMsg(statusMsgId, `${action.label}\n\n${phrase} (${elapsed}s)`);
  }, 2000);
  setTimeout(() => updateStatusMsg(statusMsgId, `${action.label}\n\n${thinkingPhrases[0]}`), 500);

  try {
    if (action.type === 'creative_plan' || action.type === 'approve_plan') {
      if (action.data?.prompt) {
        const chapterCount = action.data.chapterCount || 3;
        const sIdx = agentStore.chatMessages.findIndex(m => m.id === statusMsgId);
        if (sIdx >= 0) agentStore.chatMessages.splice(sIdx, 1);
        await agentStore.generateCreativePlan(props.bookId, action.data.prompt, Math.min(chapterCount, 10));
      } else {
        await handleApprovePlan();
        updateStatusMsg(statusMsgId, '创作计划已执行完成');
      }
    } else if (action.type === 'agent_command' && action.data?.command) {
      const result = await agentStore.runAgent(props.bookId, props.chapterId, props.content || '', action.data.command);
      if (result?.result && props.chapterId) {
        if (action.data.command === 'continue') {
          const previewText = result.result.replace(/\n+/g, ' ').slice(0, 200);
          const idx = agentStore.chatMessages.findIndex(m => m.id === statusMsgId);
          if (idx >= 0) {
            agentStore.chatMessages[idx] = {
              ...agentStore.chatMessages[idx],
              content: `接下来续写的内容为：\n\n> ${previewText}${result.result.length > 200 ? '...' : ''}\n\n（共 ${result.result.length} 字）`,
              suggestedActions: [
                { type: 'accept_continue', label: '同意', data: { msgId: statusMsgId, content: result.result } },
                { type: 'reject_continue', label: '不同意', data: { msgId: statusMsgId } },
              ],
            };
          }
        } else {
          const idx = agentStore.chatMessages.findIndex(m => m.id === statusMsgId);
          if (idx >= 0) {
            agentStore.chatMessages[idx] = {
              ...agentStore.chatMessages[idx],
              content: `${action.label} — 请确认变更：`,
              diff: { oldContent: props.content || '', newContent: result.result, label: action.label, status: 'pending' },
              suggestedActions: [
                { type: 'accept_diff', label: '接受变更', data: { msgId: statusMsgId, content: result.result, oldContent: props.content || '' } },
                { type: 'reject_diff', label: '拒绝变更', data: { msgId: statusMsgId } },
              ],
            };
            emit('showDiff', { oldContent: props.content || '', newContent: result.result });
          }
        }
      } else if (result?.result) {
        updateStatusMsg(statusMsgId, `${action.label}\n\n${result.result.slice(0, 500)}${result.result.length > 500 ? '...' : ''}`);
      } else {
        updateStatusMsg(statusMsgId, `AI 未返回可执行内容`);
      }
    } else if (action.type === 'create_character') {
      const d = action.data;
      if (!d?.name) { updateStatusMsg(statusMsgId, '创建角色失败：缺少角色名称'); clearInterval(thinkingTimer); return; }
      const charResult = await agentStore.createCharacter(props.bookId, {
        name: d.name, role: d.role, personality: d.personality,
        background: d.background, goal: d.goal, strength: d.strength, weakness: d.weakness,
      });
      if (charResult) {
        updateStatusMsg(statusMsgId, `角色「${d.name}」已创建\n\n${d.role || 'supporting'} | ${d.personality || ''}\n${(d.background || '').slice(0, 100)}`);
      } else updateStatusMsg(statusMsgId, `创建角色失败`);
    } else if (action.type === 'create_plotline') {
      const d = action.data;
      if (!d?.title) { updateStatusMsg(statusMsgId, '创建剧情线失败：缺少标题'); clearInterval(thinkingTimer); return; }
      await agentStore.createPlotLine(props.bookId, d.title, d.description, d.type || 'MAIN');
      updateStatusMsg(statusMsgId, `剧情线「${d.title}」已创建\n\n[${d.type || 'MAIN'}] ${d.description?.slice(0, 120) || ''}`);
    } else if (action.type === 'create_foreshadowing') {
      const d = action.data;
      if (!d?.title) { updateStatusMsg(statusMsgId, '创建伏笔失败：缺少标题'); clearInterval(thinkingTimer); return; }
      await agentStore.createForeshadowing(props.bookId, d.title, d.content || '', props.chapterId);
      updateStatusMsg(statusMsgId, `伏笔「${d.title}」已植入\n\n${d.content?.slice(0, 120) || ''}`);
    } else if (action.type === 'analyze_text') {
      const analysisType = action.data?.analysisType || 'comprehensive';
      const sIdx = agentStore.chatMessages.findIndex(m => m.id === statusMsgId);
      if (sIdx >= 0) agentStore.chatMessages.splice(sIdx, 1);
      await agentStore.analyzeFullText(props.bookId, analysisType);
    } else if (action.type === 'orchestrate') {
      // 多步编排：分析→补全设定→更新章纲→编写章节
      const sIdx = agentStore.chatMessages.findIndex(m => m.id === statusMsgId);
      if (sIdx >= 0) agentStore.chatMessages.splice(sIdx, 1);
      await agentStore.startOrchestration(props.bookId, action.data?.message || action.label, props.chapterId, props.content);
    } else if (action.type === 'save_outline') {
      // 保存/应用章纲到大纲维度
      const d = action.data;
      if (d?.title && d?.content) {
        try {
          // 查找已有同标题章纲，如果有则更新，否则创建
          const existingOutline = agentStore.outlines.find(o => o.title === d.title);
          if (existingOutline) {
            await agentStore.updateOutline(existingOutline.id, props.bookId, { content: d.content });
            updateStatusMsg(statusMsgId, `章纲「${d.title}」已更新到大纲维度\n\n${d.content.slice(0, 300)}${d.content.length > 300 ? '...' : ''}`);
          } else {
            await agentStore.createOutline(props.bookId, d.title, d.content);
            updateStatusMsg(statusMsgId, `章纲「${d.title}」已保存到大纲维度\n\n${d.content.slice(0, 300)}${d.content.length > 300 ? '...' : ''}`);
          }
        } catch (err: any) {
          updateStatusMsg(statusMsgId, `保存章纲失败: ${err.message}`);
        }
      } else {
        updateStatusMsg(statusMsgId, `章纲内容为空，无法保存`);
      }
    } else if (action.type === 'create_chapter') {
      const d = action.data;
      const title = d.title || `第${(bookStore.currentBook?.chapters?.length || 0) + 1}章`;
      try {
        // 查找是否已有同标题（或包含关键词）的章节，避免重复创建
        const existingChapter = (bookStore.currentBook?.chapters || []).find(ch => {
          if (ch.title === title) return true;
          // 模糊匹配：标题包含"第N章"且用户请求也包含同样的"第N章"
          const numMatch = title.match(/第(\d+|[一二三四五六七八九十百]+)章/);
          if (numMatch) {
            return ch.title.includes(`第${numMatch[1]}章`);
          }
          return false;
        });
        let chapter = existingChapter || null;
        if (chapter) {
          updateStatusMsg(statusMsgId, `已找到章节「${chapter.title}」，正在生成内容...`);
        } else {
          updateStatusMsg(statusMsgId, `正在创建章节「${title}」...`);
          chapter = await bookStore.createChapter(props.bookId, { title });
        }
        if (chapter) {
          emit('refreshChapters');
          emit('navigateToChapter', chapter.id);

          if (d.generateContent && d.prompt) {
            updateStatusMsg(statusMsgId, `章节「${chapter.title}」正在生成内容...`);
            const result = await agentStore.runAgent(props.bookId, chapter.id, '', 'generate', undefined, d.prompt);
            if (result?.result) {
              const htmlContent = textToHtml(result.result);
              await bookStore.saveChapter(chapter.id, { content: htmlContent });
              emit('refreshChapters');
              emit('navigateToChapter', chapter.id);
              updateStatusMsg(statusMsgId, `章节「${title}」已创建并生成内容 (${result.result.length} 字)，正在同步内在设定...`);
              // 自动同步内在设定
              const syncUpdates = await agentStore.syncInternals(props.bookId, chapter.id);
              if (syncUpdates.length > 0) {
                updateStatusMsg(statusMsgId, `章节「${title}」已创建 (${result.result.length} 字)\n\n内在设定已同步:\n${syncUpdates.join('\n')}`);
              } else {
                updateStatusMsg(statusMsgId, `章节「${title}」已创建并生成内容 (${result.result.length} 字)`);
              }
            } else {
              updateStatusMsg(statusMsgId, `章节「${title}」已创建，但内容生成为空，请手动编写`);
            }
          } else {
            updateStatusMsg(statusMsgId, `章节「${title}」已创建`);
          }
        } else {
          updateStatusMsg(statusMsgId, `创建章节失败`);
        }
      } catch (err: any) {
        updateStatusMsg(statusMsgId, `创建章节失败: ${err.message}`);
      }
    } else {
      updateStatusMsg(statusMsgId, `未知的操作类型: ${action.type}`);
    }
  } catch (err: any) {
    updateStatusMsg(statusMsgId, `执行失败: ${err.message}`);
  } finally {
    clearInterval(thinkingTimer);
  }
  await nextTick();
  scrollToBottom();
}

function updateStatusMsg(msgId: string, content: string) {
  const idx = agentStore.chatMessages.findIndex(m => m.id === msgId);
  if (idx >= 0) agentStore.chatMessages[idx] = { ...agentStore.chatMessages[idx], content };
}

function scrollToBottom() {
  if (chatContainerRef.value) chatContainerRef.value.scrollTop = chatContainerRef.value.scrollHeight;
}

async function handleAction(action: { type: string; label: string; data: any }) {
  await autoExecuteAction(action);
  await nextTick();
  scrollToBottom();
}

async function handleApprovePlan() {
  if (!agentStore.pendingPlan || !props.bookId) return;
  await agentStore.executeCreativePlan(props.bookId);
  emit('refreshChapters');
  await nextTick();
  scrollToBottom();
}

function handleRejectPlan() { agentStore.rejectPlan(); }
function useQuickPrompt(prompt: string) { chatInput.value = prompt; }

function toggleThinking(msgId: string) {
  expandedThinking.value[msgId] = !expandedThinking.value[msgId];
}

function handleNewSession() {
  if (props.bookId) {
    agentStore.createNewSession(props.bookId, props.chapterId, props.chapterTitle);
  }
}

function handleSwitchSession(sessionId: string) {
  agentStore.switchSession(sessionId);
  showHistoryPanel.value = false;
}

function handleDeleteSession(sessionId: string) {
  agentStore.deleteSession(sessionId);
}

watch(() => agentStore.chatMessages.length, async () => { await nextTick(); scrollToBottom(); });

// === 辅助函数 ===
function getPlotLineTypeColor(type: string) {
  return { MAIN: 'text-red-400', SUB: 'text-blue-400', CHARACTER: 'text-purple-400' }[type] || 'text-gray-400';
}
function getForeshadowingStatusColor(status: string) {
  return { PENDING: 'text-yellow-400', RESOLVED: 'text-green-400', ABANDONED: 'text-gray-400' }[status] || 'text-gray-400';
}
function getStatusText(status: string) {
  return { idle: '空闲', thinking: '思考中', writing: '写作中', checking: '检查中', completed: '完成', error: '错误' }[status] || status;
}
</script>

<template>
  <div class="h-full flex flex-col bg-white relative">
    <!-- ① 顶部信息区 -->
    <AiPanelHeader
      @toggle-history="showHistoryPanel = !showHistoryPanel"
      @popout="() => {}"
      @close="emit('closePanel')"
      @new-session="handleNewSession"
    />

    <!-- DeepSeek-R1 标识条 -->
    <div class="flex items-center justify-center gap-2 py-1.5 text-[10px] bg-gradient-to-r from-blue-50/60 via-indigo-50/40 to-purple-50/60 border-b border-border/40 select-none">
      <span class="text-border-dark">──</span>
      <span class="text-text-muted">DeepSeek-R1</span>
      <span class="font-semibold text-text-primary">深度思考</span>
      <span class="text-[9px] font-bold text-white bg-gradient-to-r from-brand to-ai-primary px-1.5 py-px rounded-full">NEW</span>
      <span class="text-border-dark">──</span>
    </div>

    <!-- 历史对话面板 (覆盖) -->
    <transition name="slide-history">
      <div v-if="showHistoryPanel" class="absolute inset-0 z-30 bg-white/95 backdrop-blur-sm flex flex-col">
        <div class="flex items-center justify-between px-3 py-2.5 border-b border-border">
          <h3 class="text-sm font-bold text-text-primary flex items-center gap-1.5">
            <svg class="w-4 h-4 text-brand" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
            历史对话
          </h3>
          <button @click="showHistoryPanel = false" class="w-7 h-7 flex items-center justify-center rounded-lg text-text-muted hover:bg-surface-hover hover:text-text-primary transition-all">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>
        <div class="flex-1 overflow-y-auto p-3 space-y-2">
          <div v-if="agentStore.sessions.length === 0" class="text-center py-12 text-xs text-text-muted">
            <svg class="w-8 h-8 mx-auto mb-2 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155"/></svg>
            暂无历史对话
          </div>
          <div
            v-for="session in agentStore.sessions"
            :key="session.id"
            @click="handleSwitchSession(session.id)"
            class="group p-3 rounded-xl border transition-all duration-200 cursor-pointer"
            :class="agentStore.activeSessionId === session.id ? 'border-brand/40 bg-brand-50/80 shadow-sm ring-1 ring-brand/10' : 'border-border hover:border-brand/20 hover:bg-surface-secondary hover:shadow-sm'"
          >
            <div class="flex items-center justify-between">
              <span class="text-xs font-medium text-text-primary truncate" :class="agentStore.activeSessionId === session.id ? 'text-brand' : ''">{{ session.title }}</span>
              <button @click.stop="handleDeleteSession(session.id)" class="opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center justify-center text-text-muted hover:text-red-400 rounded transition-all">
                <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"/></svg>
              </button>
            </div>
            <div class="text-[10px] text-text-muted mt-1.5 flex items-center gap-2">
              <span v-if="session.chapterTitle" class="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-white/80 rounded border border-border/50 text-text-secondary">{{ session.chapterTitle }}</span>
              <span>{{ formatDate(session.createdAt) }}</span>
            </div>
          </div>
        </div>
      </div>
    </transition>

    <!-- ② 层面切换标签 -->
    <div class="p-2 border-b border-border bg-white relative">
      <div class="flex bg-surface-secondary/80 rounded-xl p-1 shadow-inner relative">
        <!-- 滑动背景块 -->
        <div class="absolute inset-y-1 rounded-lg bg-white shadow-sm transition-all duration-300 ease-out" 
             :style="{ 
               width: 'calc(' + (100/3) + '% - 6px)', 
               left: (['strategy', 'tactical', 'execution'].indexOf(activeLayer) * (100/3)) + '%',
               marginLeft: '3px'
             }">
        </div>
        <button
          v-for="layer in [
            { key: 'strategy', label: '世界观' },
            { key: 'tactical', label: '角色' },
            { key: 'execution', label: 'AI 写作' }
          ]"
          :key="layer.key"
          @click="activeLayer = layer.key as LayerType"
          class="flex-1 py-2 text-xs transition-colors duration-200 flex items-center justify-center font-medium relative z-10"
          :class="activeLayer === layer.key ? 'text-brand' : 'text-text-muted hover:text-text-secondary'"
        >
          {{ layer.label }}
        </button>
      </div>
    </div>

    <!-- 战略层：世界观/大纲/伏笔 -->
    <div v-if="activeLayer === 'strategy'" class="flex-1 overflow-y-auto p-3">
      <div class="space-y-3">
        <div class="bg-surface-secondary rounded-lg p-3">
          <div class="flex items-center justify-between mb-3">
            <h3 class="text-sm font-medium text-text-primary">世界观设定</h3>
            <button @click="openWorldSettingEditor()" class="text-xs text-brand hover:text-brand-dark font-medium">+ 添加</button>
          </div>
          <div v-if="agentStore.worldSettings.length === 0" class="text-xs text-text-muted">暂无世界观设定</div>
          <div v-else class="space-y-2">
            <div v-for="ws in agentStore.worldSettings" :key="ws.id" @click="openWorldSettingEditor(ws)" class="text-xs p-2.5 bg-white rounded-lg border border-border cursor-pointer hover:border-brand/30 transition-colors">
              <div v-if="ws.genre" class="text-text-secondary">题材: {{ ws.genre }}</div>
              <div v-if="ws.theme" class="text-text-secondary">主题: {{ ws.theme }}</div>
              <div v-if="ws.tone" class="text-text-secondary">风格: {{ ws.tone }}</div>
            </div>
          </div>
        </div>
        <div class="bg-surface-secondary rounded-lg p-3">
          <div class="flex items-center justify-between mb-3">
            <h3 class="text-sm font-medium text-text-primary">剧情线</h3>
            <button @click="openPlotLineEditor()" class="text-xs text-brand hover:text-brand-dark font-medium">+ 添加</button>
          </div>
          <div v-if="agentStore.plotLines.length === 0" class="text-xs text-text-muted">暂无剧情线</div>
          <div v-else class="space-y-2">
            <div v-for="pl in agentStore.plotLines" :key="pl.id" @click="openPlotLineEditor(pl)" class="text-xs p-2.5 bg-white rounded-lg border border-border cursor-pointer hover:border-brand/30 transition-colors">
              <div class="flex items-center gap-2">
                <span :class="getPlotLineTypeColor(pl.type)" class="font-medium">{{ pl.type }}</span>
                <span class="text-text-primary">{{ pl.title }}</span>
              </div>
              <div v-if="pl.description" class="text-text-muted mt-1">{{ pl.description.slice(0, 50) }}...</div>
            </div>
          </div>
        </div>
        <div class="bg-surface-secondary rounded-lg p-3">
          <div class="flex items-center justify-between mb-3">
            <h3 class="text-sm font-medium text-text-primary">伏笔</h3>
            <button @click="openForeshadowingEditor()" class="text-xs text-brand hover:text-brand-dark font-medium">+ 添加</button>
          </div>
          <div v-if="agentStore.foreshadowings.length === 0" class="text-xs text-text-muted">暂无伏笔</div>
          <div v-else class="space-y-2">
            <div v-for="fs in agentStore.foreshadowings" :key="fs.id" @click="openForeshadowingEditor(fs)" class="text-xs p-2.5 bg-white rounded-lg border border-border cursor-pointer hover:border-brand/30 transition-colors">
              <div class="flex items-center gap-2">
                <span :class="getForeshadowingStatusColor(fs.status)" class="font-medium">
                  {{ fs.status === 'PENDING' ? '待回收' : fs.status === 'RESOLVED' ? '已回收' : '已废弃' }}
                </span>
                <span class="text-text-primary">{{ fs.title }}</span>
              </div>
              <div class="text-text-muted mt-1">{{ fs.content.slice(0, 50) }}...</div>
            </div>
          </div>
        </div>
        <div class="bg-surface-secondary rounded-lg p-3">
          <div class="flex items-center justify-between mb-3">
            <h3 class="text-sm font-medium text-text-primary">章纲</h3>
            <button @click="showOutlineForm = true" class="text-xs text-brand hover:text-brand-dark font-medium">+ 添加</button>
          </div>
          <!-- 新建/编辑章纲表单 -->
          <div v-if="showOutlineForm" class="mb-3 p-2 bg-white rounded-lg border border-brand/30 space-y-2">
            <input v-model="outlineFormTitle" placeholder="章纲标题（如：第四章 百草园考验）" class="w-full text-xs px-2 py-1.5 border border-border rounded focus:outline-none focus:border-brand" />
            <textarea v-model="outlineFormContent" placeholder="章节大纲内容..." rows="4" class="w-full text-xs px-2 py-1.5 border border-border rounded focus:outline-none focus:border-brand resize-none"></textarea>
            <div class="flex gap-2 justify-end">
              <button @click="showOutlineForm = false; editingOutlineId = null; outlineFormTitle = ''; outlineFormContent = ''" class="text-xs px-2 py-1 rounded bg-gray-100 hover:bg-gray-200 text-text-muted">取消</button>
              <button @click="saveOutline" class="text-xs px-2 py-1 rounded bg-brand text-white hover:bg-brand-dark">保存</button>
            </div>
          </div>
          <div v-if="agentStore.outlines.length === 0 && !showOutlineForm" class="text-xs text-text-muted">暂无章纲，可由AI自动生成</div>
          <div v-else class="space-y-2">
            <div v-for="ol in agentStore.outlines" :key="ol.id" class="text-xs p-2.5 bg-white rounded-lg border border-border hover:border-brand/30 transition-colors group">
              <div class="flex items-center justify-between">
                <span class="text-text-primary font-medium cursor-pointer" @click="editOutline(ol)">{{ ol.title }}</span>
                <button @click="handleDeleteOutline(ol.id)" class="text-gray-300 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity text-xs">×</button>
              </div>
              <div v-if="ol.content" class="text-text-muted mt-1 cursor-pointer" @click="editOutline(ol)">{{ ol.content.slice(0, 80) }}{{ ol.content.length > 80 ? '...' : '' }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 战术层：角色/关系 -->
    <div v-if="activeLayer === 'tactical'" class="flex-1 overflow-y-auto p-3">
      <div class="space-y-3">
        <div class="bg-surface-secondary rounded-lg p-3">
          <div class="flex items-center justify-between mb-3">
            <h3 class="text-sm font-medium text-text-primary">角色</h3>
            <button @click="openCharacterEditor()" class="text-xs text-brand hover:text-brand-dark font-medium">+ 添加</button>
          </div>
          <div v-if="agentStore.characters.length === 0" class="text-xs text-text-muted">暂无角色</div>
          <div v-else class="space-y-2">
            <div v-for="char in agentStore.characters" :key="char.id" @click="openCharacterEditor(char)" class="text-xs p-2.5 bg-white rounded-lg border border-border cursor-pointer hover:border-brand/30 transition-colors">
              <div class="flex items-center gap-2">
                <span class="w-2 h-2 rounded-full" :class="{
                  'bg-red-400': char.role === '主角', 'bg-blue-400': char.role === '配角',
                  'bg-purple-400': char.role === '反派', 'bg-gray-400': !char.role || char.role === '龙套'
                }"></span>
                <span class="text-text-primary font-medium">{{ char.name }}</span>
                <span class="text-text-muted">({{ char.role || '未设定' }})</span>
              </div>
              <div v-if="char.currentGoal" class="text-text-muted mt-1">目标: {{ char.currentGoal }}</div>
            </div>
          </div>
        </div>
        <div class="bg-surface-secondary rounded-lg p-3">
          <h3 class="text-sm font-medium text-text-primary mb-3">角色关系网</h3>
          <div class="h-[320px]">
            <RelationshipGraph :book-id="props.bookId" @open-character="openCharacterEditor" />
          </div>
        </div>
      </div>
    </div>

    <!-- 执行层：AI 智能助手 -->
    <div v-if="activeLayer === 'execution'" class="flex-1 flex flex-col min-h-0">

      <!-- 右侧工具面板覆盖 (校对/拼字/灵感/妙笔) -->
      <RightToolPanel
        v-if="activeToolPanel"
        :tool="activeToolPanel"
        :book-id="props.bookId"
        :chapter-id="props.chapterId"
        :chapter-title="props.chapterTitle"
        :content="props.content || ''"
        @close="handleCloseToolPanel"
      />

      <!-- 常规 AI 聊天界面 (工具未激活时显示) -->
      <template v-else>

      <!-- ③ 当前挂载内容区 -->
      <div v-if="props.chapterId" class="px-3 py-2 border-b border-border bg-gradient-to-r from-blue-50/30 to-transparent shrink-0">
        <div class="flex items-center gap-2">
          <div class="w-7 h-7 rounded-lg bg-blue-500/10 flex items-center justify-center shrink-0">
            <svg class="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25"/>
            </svg>
          </div>
          <div class="min-w-0">
            <div class="text-xs font-semibold text-text-primary truncate">{{ props.chapterTitle || '当前章节' }}</div>
            <div class="text-[10px] text-text-muted truncate">{{ bookStore.currentBook?.title || '' }}</div>
          </div>
        </div>
      </div>

      <!-- 上下文指示器 -->
      <div v-if="contextIndicators.length > 0" class="flex items-center gap-1.5 px-3 py-1.5 bg-surface-secondary border-b border-border text-[10px] text-text-muted shrink-0">
        <svg class="w-3 h-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
        <span>AI 可见:</span>
        <span v-for="(ctx, i) in contextIndicators" :key="i" class="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-white rounded border border-border/50">{{ ctx.label }}</span>
      </div>

      <!-- ④ 聊天消息区域 -->
      <div class="relative flex-1 min-h-0">
        <div ref="chatContainerRef" class="h-full overflow-y-auto p-3 space-y-4">

          <!-- 空状态 -->
          <template v-if="agentStore.chatMessages.length === 0 && !agentStore.pendingPlan">
            <div class="text-center py-6 animate-msg-in flex flex-col items-center">
              <div class="w-14 h-14 mb-4 rounded-full bg-gradient-to-tr from-brand-50 to-blue-50 border border-brand/20 flex items-center justify-center shadow-sm relative overflow-hidden group">
                <div class="absolute inset-0 bg-brand/5 group-hover:bg-brand/10 transition-colors"></div>
                <svg class="w-7 h-7 text-brand relative z-10" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"/></svg>
              </div>
              <h3 class="text-sm font-bold text-text-primary mb-1">AI 创作助手</h3>
              <p class="text-[11px] text-text-muted mb-5">智能写作 · 灵感生成 · 润色优化</p>

              <!-- 快捷问题推荐区 -->
              <div class="w-full space-y-2">
                <button
                  v-for="qp in quickPrompts"
                  :key="qp.label"
                  @click="useQuickPrompt(qp.label)"
                  class="w-full text-left px-4 py-3 text-[12px] bg-white hover:bg-brand-50/50 border border-border rounded-xl transition-all shadow-sm hover:shadow hover:border-brand/30 text-text-secondary group flex items-center justify-between"
                >
                  <span class="flex items-center gap-2">
                    <span class="w-1.5 h-1.5 rounded-full bg-brand/40 group-hover:bg-brand"></span>
                    {{ qp.label }}
                  </span>
                  <svg class="w-3 h-3 text-border-dark group-hover:text-brand transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>
                </button>
              </div>

              <!-- 预设模板系统 -->
              <div class="w-full mt-6 text-left">
                <div class="flex items-center justify-between mb-3 px-1">
                  <div class="text-[12px] font-medium text-text-primary">常用模板</div>
                  <span class="text-[10px] text-text-muted">点击自动填入</span>
                </div>
                <div class="flex space-x-1 mb-3 bg-surface-secondary/50 p-1 rounded-lg">
                  <button
                    v-for="cat in presetPromptCategories"
                    :key="cat.key"
                    @click="activePromptCategory = cat.key"
                    class="flex-1 py-1.5 text-[11px] rounded-md transition-all font-medium"
                    :class="activePromptCategory === cat.key ? 'bg-white text-brand shadow-sm' : 'text-text-muted hover:text-text-secondary'"
                  >
                    {{ cat.label }}
                  </button>
                </div>
                <div class="grid grid-cols-2 gap-2">
                  <button
                    v-for="tpl in activePresetPrompts"
                    :key="tpl.title"
                    @click="applyPresetPrompt(tpl.prompt)"
                    class="text-left px-3 py-2.5 bg-white border border-border rounded-xl hover:border-brand/30 hover:shadow-sm transition-all group"
                  >
                    <div class="text-[11px] font-medium text-text-primary group-hover:text-brand transition-colors">{{ tpl.title }}</div>
                  </button>
                </div>
              </div>
            </div>
          </template>

          <!-- 聊天消息 -->
          <template v-for="msg in agentStore.chatMessages" :key="msg.id">
            <!-- 用户消息 -->
            <div v-if="msg.role === 'user'" class="flex gap-2.5 justify-end animate-msg-in">
              <div class="max-w-[85%] flex flex-col items-end">
                <div class="bg-brand text-white px-3.5 py-2.5 rounded-2xl rounded-br-md text-xs leading-relaxed shadow-sm hover:shadow-md transition-shadow">{{ msg.content }}</div>
                <span class="text-[10px] text-text-muted mt-1 mr-1">{{ formatTime(msg.timestamp) }}</span>
              </div>
              <div class="w-6 h-6 rounded-full bg-brand/10 flex items-center justify-center shrink-0 mt-0.5">
                <svg class="w-3.5 h-3.5 text-brand" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"/></svg>
              </div>
            </div>

            <!-- AI 消息 -->
            <div v-else class="flex gap-2.5 animate-msg-in">
              <div class="w-6 h-6 rounded-full bg-gradient-to-br from-brand-50 to-purple-50 border border-brand/20 flex items-center justify-center shrink-0 mt-0.5">
                <svg class="w-3.5 h-3.5 text-brand" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"/></svg>
              </div>
              <div class="max-w-[90%] flex flex-col">
                <!-- 打字指示器 -->
                <div v-if="msg.content === '●●●'" class="bg-surface-secondary px-4 py-2.5 rounded-2xl rounded-bl-md">
                  <span class="inline-flex gap-1">
                    <span class="w-1.5 h-1.5 bg-text-muted rounded-full animate-bounce" style="animation-delay: 0ms"></span>
                    <span class="w-1.5 h-1.5 bg-text-muted rounded-full animate-bounce" style="animation-delay: 150ms"></span>
                    <span class="w-1.5 h-1.5 bg-text-muted rounded-full animate-bounce" style="animation-delay: 300ms"></span>
                  </span>
                </div>

                <!-- 深度思考过程 + 消息体 -->
                <div v-else>
                  <!-- 深度思考区域 (可折叠) -->
                  <div v-if="msg.thinking || msg.isThinking" class="mb-2">
                    <button
                      @click="toggleThinking(msg.id)"
                      class="flex items-center gap-1.5 text-[11px] text-ai-primary hover:text-purple-700 transition-colors group"
                    >
                      <span v-if="msg.isThinking" class="flex items-center gap-1.5">
                        <span class="relative flex h-2 w-2">
                          <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-ai-primary opacity-75"></span>
                          <span class="relative inline-flex rounded-full h-2 w-2 bg-ai-primary"></span>
                        </span>
                        <span class="font-medium">思考中…</span>
                      </span>
                      <span v-else class="flex items-center gap-1.5">
                        <svg class="w-3.5 h-3.5 text-ai-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5.002 5.002 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/></svg>
                        <span class="font-medium">已深度思考</span>
                      </span>
                      <svg class="w-3 h-3 transition-transform duration-200 text-text-muted group-hover:text-ai-primary" :class="expandedThinking[msg.id] ? 'rotate-180' : ''" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
                    </button>
                    <transition name="expand">
                      <div v-if="expandedThinking[msg.id] && msg.thinking" class="thinking-container mt-2 py-2 pr-2 bg-gradient-to-br from-purple-50/60 to-indigo-50/40 rounded-r-lg text-[11px] text-ai-primary/90 leading-relaxed max-h-48 overflow-y-auto">
                        {{ msg.thinking }}
                      </div>
                    </transition>
                  </div>

                  <!-- Markdown 渲染消息 -->
                  <div class="ai-message bg-surface-secondary/80 backdrop-blur-sm px-3.5 py-2.5 rounded-2xl rounded-bl-md text-xs text-text-primary leading-relaxed shadow-sm border border-border/30" v-html="renderMarkdown(msg.content)"></div>

                  <!-- 多步编排面板 -->
                  <OrchestrationPanel
                    v-if="agentStore.orchestration.steps.length > 0 && msg.id === agentStore.orchestration.msgId && (agentStore.orchestration.active || agentStore.orchestration.phase === 'awaiting_approval' || agentStore.orchestration.phase === 'done' || agentStore.orchestration.phase === 'completed')"
                    class="mt-2"
                    @confirm="handleOrchestrationConfirm"
                    @cancel="handleOrchestrationCancel"
                    @refresh-chapters="emit('refreshChapters')"
                  />
                </div>

                <span class="text-[10px] text-text-muted mt-1 ml-1">{{ formatTime(msg.timestamp) }}</span>

                <!-- 差异对比区域 -->
                <div v-if="msg.diff && msg.diff.status === 'pending'" class="mt-2 border border-border rounded-xl overflow-hidden text-xs shadow-sm">
                  <div class="bg-gray-50 px-3 py-2 text-text-secondary font-medium border-b border-border flex items-center justify-between">
                    <span class="flex items-center gap-1.5">
                      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5"/></svg>
                      {{ msg.diff.label }}
                    </span>
                    <button @click="emit('showDiff', { oldContent: msg.diff!.oldContent, newContent: msg.diff!.newContent })" class="text-[10px] text-brand hover:text-brand-dark transition-colors">在编辑器预览</button>
                  </div>
                  <div class="max-h-[280px] overflow-y-auto">
                    <div class="bg-red-50/50 px-3 py-2 border-b border-red-100/50">
                      <div class="text-red-500 text-[10px] font-medium mb-1 flex items-center gap-1">
                        <span class="inline-block w-1.5 h-1.5 rounded-sm bg-red-400"></span>
                        旧内容 ({{ msg.diff.oldContent.length }}字)
                      </div>
                      <div class="text-red-800/70 leading-relaxed line-through">{{ msg.diff.oldContent.slice(0, 300) }}{{ msg.diff.oldContent.length > 300 ? '...' : '' }}</div>
                    </div>
                    <div class="bg-green-50/50 px-3 py-2">
                      <div class="text-green-500 text-[10px] font-medium mb-1 flex items-center gap-1">
                        <span class="inline-block w-1.5 h-1.5 rounded-sm bg-green-400"></span>
                        新内容 ({{ msg.diff.newContent.length }}字)
                      </div>
                      <div class="text-green-800/90 leading-relaxed">{{ msg.diff.newContent.slice(0, 300) }}{{ msg.diff.newContent.length > 300 ? '...' : '' }}</div>
                    </div>
                  </div>
                </div>
                <div v-else-if="msg.diff && msg.diff.status === 'accepted'" class="mt-1 text-[10px] text-green-600 flex items-center gap-1">
                  <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                  变更已应用
                </div>
                <div v-else-if="msg.diff && msg.diff.status === 'rejected'" class="mt-1 text-[10px] text-text-muted flex items-center gap-1">
                  <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                  变更已撤回
                </div>

                <!-- 操作按钮 -->
                <div v-if="msg.suggestedActions?.length" class="flex flex-wrap gap-1.5 mt-2">
                  <button
                    v-for="(action, i) in msg.suggestedActions"
                    :key="i"
                    @click="handleAction(action)"
                    :disabled="agentStore.isProcessing"
                    class="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs bg-white text-brand border border-brand/20 rounded-lg hover:bg-brand-50 hover:border-brand/40 disabled:opacity-50 transition-all shadow-sm"
                  >{{ action.label }}</button>
                </div>
              </div>
            </div>
          </template>

          <!-- 创意计划预览 -->
          <div v-if="agentStore.pendingPlan" class="bg-gradient-to-br from-brand-50 to-purple-50 border border-brand/20 rounded-xl p-4 space-y-2.5 shadow-sm">
            <div class="flex items-center justify-between">
              <h4 class="text-sm font-semibold text-text-primary flex items-center gap-1.5">创作计划</h4>
              <span class="text-[10px] text-brand font-medium px-2 py-0.5 bg-brand/10 rounded-full">待确认</span>
            </div>
            <div class="text-xs space-y-1.5 text-text-secondary">
              <div><span class="font-medium text-text-primary">标题:</span> {{ agentStore.pendingPlan.title }}</div>
              <div><span class="font-medium text-text-primary">题材:</span> {{ agentStore.pendingPlan.genre }} · {{ agentStore.pendingPlan.tone }}</div>
              <div><span class="font-medium text-text-primary">角色 ({{ agentStore.pendingPlan.characters.length }}):</span>
                <div class="flex flex-wrap gap-1 mt-1">
                  <span v-for="char in agentStore.pendingPlan.characters" :key="char.name" class="px-1.5 py-0.5 bg-white rounded-md text-xs border border-border/50 shadow-sm">
                    {{ char.name }} <span class="text-text-muted text-[10px]">{{ char.role }}</span>
                  </span>
                </div>
              </div>
              <div class="pt-1">
                <span class="font-medium text-text-primary">章节 ({{ agentStore.pendingPlan.chapterOutlines.length }}):</span>
                <div v-for="(ch, idx) in agentStore.pendingPlan.chapterOutlines" :key="idx" class="ml-2 mt-0.5">· 第{{ idx + 1 }}章 {{ ch.title }}</div>
              </div>
            </div>
            <div class="flex gap-2 pt-2">
              <button @click="handleApprovePlan" :disabled="agentStore.isProcessing" class="flex-1 px-3 py-2 bg-brand hover:bg-brand-dark text-white rounded-lg text-xs font-medium disabled:opacity-50 transition-colors shadow-sm">
                {{ agentStore.isProcessing ? '执行中...' : '✓ 确认执行' }}
              </button>
              <button @click="handleRejectPlan" :disabled="agentStore.isProcessing" class="px-3 py-2 bg-white text-text-secondary rounded-lg text-xs border border-border hover:bg-surface-hover disabled:opacity-50 transition-colors">✕ 取消</button>
            </div>
          </div>

          <!-- 执行进度 -->
          <div v-if="agentStore.planExecStatus" class="bg-blue-50 border border-blue-200 rounded-xl p-3 shadow-sm">
            <div class="flex items-center justify-between mb-1.5">
              <span class="text-xs font-medium text-blue-700">{{ agentStore.planExecStatus.step }}</span>
              <span class="text-xs text-blue-500">{{ agentStore.planExecStatus.current }}/{{ agentStore.planExecStatus.total }}</span>
            </div>
            <div class="w-full h-1.5 bg-blue-100 rounded-full overflow-hidden">
              <div class="h-full bg-blue-500 rounded-full transition-all duration-500" :style="{ width: ((agentStore.planExecStatus.current / agentStore.planExecStatus.total) * 100) + '%' }"></div>
            </div>
          </div>

          <!-- AI 结果（带 diff 对比） -->
          <div v-if="commandResultDiff && commandResultDiff.status === 'pending' && agentStore.chatMessages.length === 0" class="bg-surface-secondary rounded-xl overflow-hidden shadow-sm">
            <div class="bg-gray-50 px-3 py-2 text-xs text-text-secondary font-medium border-b border-border flex items-center justify-between">
              <span class="flex items-center gap-1.5">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5"/></svg>
                {{ commandResultDiff.command === 'continue' ? '续写预览' : commandResultDiff.command === 'improve' ? '改进对比' : commandResultDiff.command === 'expand' ? '扩展对比' : commandResultDiff.command === 'summarize' ? '总结对比' : '生成对比' }}
              </span>
              <button @click="emit('showDiff', { oldContent: commandResultDiff.oldContent, newContent: commandResultDiff.newContent })" class="text-[10px] text-brand hover:text-brand-dark transition-colors">在编辑器预览</button>
            </div>

            <!-- 续写模式：仅展示新生成内容 -->
            <template v-if="commandResultDiff.command === 'continue'">
              <div class="max-h-[280px] overflow-y-auto">
                <div class="bg-green-50/50 px-3 py-2">
                  <div class="text-green-500 text-[10px] font-medium mb-1 flex items-center gap-1">
                    <span class="inline-block w-1.5 h-1.5 rounded-sm bg-green-400"></span>
                    续写内容 ({{ commandResultDiff.newContent.length }}字)
                  </div>
                  <div class="text-xs text-green-800/90 leading-relaxed whitespace-pre-wrap">{{ commandResultDiff.newContent.slice(0, 500) }}{{ commandResultDiff.newContent.length > 500 ? '...' : '' }}</div>
                </div>
              </div>
            </template>

            <!-- 改进/扩展/总结/生成模式：红绿 diff 对比 -->
            <template v-else>
              <div class="max-h-[280px] overflow-y-auto">
                <div class="bg-red-50/50 px-3 py-2 border-b border-red-100/50">
                  <div class="text-red-500 text-[10px] font-medium mb-1 flex items-center gap-1">
                    <span class="inline-block w-1.5 h-1.5 rounded-sm bg-red-400"></span>
                    原始内容 ({{ commandResultDiff.oldContent.length }}字)
                  </div>
                  <div class="text-xs text-red-800/70 leading-relaxed line-through whitespace-pre-wrap">{{ commandResultDiff.oldContent.slice(0, 300) }}{{ commandResultDiff.oldContent.length > 300 ? '...' : '' }}</div>
                </div>
                <div class="bg-green-50/50 px-3 py-2">
                  <div class="text-green-500 text-[10px] font-medium mb-1 flex items-center gap-1">
                    <span class="inline-block w-1.5 h-1.5 rounded-sm bg-green-400"></span>
                    新内容 ({{ commandResultDiff.newContent.length }}字)
                  </div>
                  <div class="text-xs text-green-800/90 leading-relaxed whitespace-pre-wrap">{{ commandResultDiff.newContent.slice(0, 300) }}{{ commandResultDiff.newContent.length > 300 ? '...' : '' }}</div>
                </div>
              </div>
            </template>

            <!-- 接受/拒绝按钮 -->
            <div class="flex gap-2 px-3 py-2.5 border-t border-border">
              <button @click="acceptCommandResult" class="flex-1 px-3 py-1.5 bg-green-500 hover:bg-green-600 text-white rounded-lg text-xs font-medium transition-colors shadow-sm">
                ✓ {{ commandResultDiff.command === 'continue' ? '追加到章节' : '接受变更' }}
              </button>
              <button @click="rejectCommandResult" class="flex-1 px-3 py-1.5 bg-white text-text-secondary rounded-lg text-xs border border-border hover:bg-red-50 hover:text-red-500 hover:border-red-200 transition-colors">
                ✕ 拒绝
              </button>
            </div>
          </div>

          <!-- 命令结果已接受 -->
          <div v-else-if="commandResultDiff && commandResultDiff.status === 'accepted' && agentStore.chatMessages.length === 0" class="bg-surface-secondary rounded-xl p-3 shadow-sm">
            <div class="text-xs text-green-600 flex items-center gap-1.5">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
              {{ commandResultDiff.command === 'continue' ? '续写内容已追加' : '变更已应用' }}
            </div>
          </div>

          <!-- 命令结果已拒绝 -->
          <div v-else-if="commandResultDiff && commandResultDiff.status === 'rejected' && agentStore.chatMessages.length === 0" class="bg-surface-secondary rounded-xl p-3 shadow-sm">
            <div class="text-xs text-text-muted flex items-center gap-1.5">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
              变更已撤回，内容未修改
            </div>
          </div>

          <!-- 警告 -->
          <div v-if="agentStore.warnings.length > 0" class="bg-yellow-50 border border-yellow-200 rounded-xl p-3">
            <h3 class="text-xs font-medium text-yellow-700 mb-1.5">一致性警告</h3>
            <ul class="text-xs text-yellow-600 space-y-0.5">
              <li v-for="(warning, idx) in agentStore.warnings" :key="idx">• {{ warning }}</li>
            </ul>
          </div>
        </div>

        <!-- 流式生成遮罩 -->
        <transition name="fade-mask">
          <div v-if="agentStore.chatLoading" class="absolute inset-0 z-10 flex items-center justify-center px-5 pointer-events-none">
            <div class="w-full max-w-sm rounded-2xl border border-brand/20 bg-white/95 shadow-card backdrop-blur-sm p-4">
              <div class="flex items-center gap-2.5 mb-2">
                <div class="relative w-8 h-8 rounded-full bg-brand/10 flex items-center justify-center">
                  <span class="w-2 h-2 rounded-full bg-brand animate-ping absolute"></span>
                  <span class="w-2 h-2 rounded-full bg-brand relative"></span>
                </div>
                <div>
                  <div class="text-xs font-semibold text-text-primary">AI 深度生成中</div>
                  <div class="text-[11px] text-text-muted">{{ getStatusText(agentStore.agentStatus.status) }}</div>
                </div>
              </div>
              <div class="text-xs text-text-secondary leading-relaxed mb-3">{{ streamMaskText }}</div>
              <div class="h-1.5 w-full rounded-full bg-surface-secondary overflow-hidden">
                <div class="h-full w-1/2 bg-brand rounded-full stream-bar"></div>
              </div>
            </div>
          </div>
        </transition>
      </div>

      <!-- ⑤ 上下文范围 + ⑥ 工具切换 + ⑦ 输入区 -->
      <div class="border-t border-border bg-white shrink-0">
        <!-- 上下文范围 + 工具模式 -->
        <div class="flex items-center gap-1.5 px-3 pt-2.5 pb-1.5">
          <div class="flex items-center bg-surface-secondary rounded-lg p-0.5 border border-border/60 shadow-sm">
            <button
              v-for="scope in scopeOptions"
              :key="scope.key"
              @click="agentStore.contextScope = scope.key"
              class="relative px-2.5 py-1 text-[11px] rounded-md transition-all duration-200 font-medium"
              :class="agentStore.contextScope === scope.key ? 'bg-white text-brand shadow-sm ring-1 ring-brand/10' : 'text-text-muted hover:text-text-secondary'"
            >
              {{ scope.label }}
              <span v-if="scope.badge" class="ml-0.5 text-[8px] px-1 py-px rounded-sm bg-gradient-to-r from-green-400 to-emerald-500 text-white font-bold leading-none">{{ scope.badge }}</span>
            </button>
          </div>
          <div class="flex-1"></div>
          <div class="flex items-center gap-0.5 bg-surface-secondary/60 rounded-lg p-0.5">
            <button
              v-for="tm in toolModes"
              :key="tm.key"
              @click="agentStore.activeToolMode = tm.key"
              class="px-2 py-1 text-[10px] rounded-md transition-all duration-200"
              :class="agentStore.activeToolMode === tm.key ? 'bg-white text-brand font-medium shadow-sm ring-1 ring-brand/10' : 'text-text-muted hover:bg-white/60 hover:text-text-secondary'"
            >{{ tm.label }}</button>
          </div>
        </div>

        <!-- 快捷操作条 -->
        <div class="px-3 pb-1.5">
          <div class="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
            <button
              v-for="tpl in activePresetPrompts"
              :key="`chip-${tpl.title}`"
              @click="applyPresetPrompt(tpl.prompt)"
              class="shrink-0 px-2.5 py-1 text-[11px] bg-surface-secondary text-text-secondary border border-border rounded-full hover:bg-brand-50 hover:text-brand hover:border-brand/30 transition-all"
            >{{ tpl.title }}</button>
          </div>
        </div>

        <!-- 状态 + 取消 -->
        <div v-if="agentStore.agentStatus.status !== 'idle'" class="flex items-center justify-between px-3 pb-1">
          <div class="flex items-center gap-2">
            <span class="w-1.5 h-1.5 rounded-full" :class="{
              'bg-yellow-400 animate-pulse': agentStore.agentStatus.status === 'thinking',
              'bg-blue-400 animate-pulse': agentStore.agentStatus.status === 'writing',
              'bg-green-400': agentStore.agentStatus.status === 'completed',
              'bg-red-400': agentStore.agentStatus.status === 'error',
            }"></span>
            <span class="text-[11px] text-text-muted">{{ agentStore.agentStatus.message }}</span>
          </div>
          <button v-if="agentStore.chatLoading" @click="cancelGeneration" class="text-[10px] text-red-400 hover:text-red-600 transition-colors flex items-center gap-0.5">
            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5.25 7.5A2.25 2.25 0 017.5 5.25h9a2.25 2.25 0 012.25 2.25v9a2.25 2.25 0 01-2.25 2.25h-9a2.25 2.25 0 01-2.25-2.25v-9z"/></svg>
            停止
          </button>
        </div>

        <!-- 输入框 -->
        <div class="px-3 pb-2">
          <div class="flex items-end gap-2">
            <div class="flex-1 relative rounded-xl border border-border focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/10 transition-all bg-white shadow-sm">
              <textarea
                v-model="chatInput"
                @keydown.enter.exact.prevent="sendMessage"
                :disabled="agentStore.chatLoading || actionExecuting"
                :placeholder="toolModePlaceholders[agentStore.activeToolMode]"
                rows="1"
                class="w-full px-3.5 py-2.5 text-xs bg-transparent resize-none focus:outline-none max-h-24 overflow-y-auto disabled:opacity-50"
              />
            </div>
            <button
              v-if="!agentStore.chatLoading && !actionExecuting"
              @click="sendMessage"
              :disabled="!chatInput.trim()"
              class="p-2.5 bg-gradient-to-br from-brand to-brand-dark hover:from-brand-dark hover:to-brand text-white rounded-xl disabled:opacity-20 disabled:from-gray-300 disabled:to-gray-400 transition-all shrink-0 shadow-sm hover:shadow-md active:scale-95"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5"/></svg>
            </button>
            <button v-else @click="cancelGeneration" class="p-2.5 bg-red-50 hover:bg-red-100 text-red-500 rounded-xl transition-all shrink-0 border border-red-200 active:scale-95">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5.25 7.5A2.25 2.25 0 017.5 5.25h9a2.25 2.25 0 012.25 2.25v9a2.25 2.25 0 01-2.25 2.25h-9a2.25 2.25 0 01-2.25-2.25v-9z"/></svg>
            </button>
          </div>
          <div class="flex items-center gap-1 mt-1.5">
            <button v-for="cmd in commands" :key="cmd.value"
              @click="selectedCommand = cmd.value; runAi()"
              :disabled="agentStore.isProcessing || !writingContent"
              class="px-2 py-0.5 text-[10px] text-text-muted hover:text-brand hover:bg-brand-50 rounded-md transition-colors disabled:opacity-30"
              :title="cmd.label"
            >{{ cmd.icon }} {{ cmd.label }}</button>
            <div class="flex-1"></div>
            <button
              @click="orchestrationMode = !orchestrationMode"
              :class="orchestrationMode ? 'text-brand bg-brand-50 ring-1 ring-brand/30' : 'text-text-muted hover:text-brand hover:bg-brand-50'"
              class="px-2 py-0.5 text-[10px] rounded-md transition-colors flex items-center gap-0.5"
              title="多步编排模式：AI 自动拆解任务并依次执行"
            >
              📋 多步编排
            </button>
            <button v-if="agentStore.chatMessages.length > 0" @click="agentStore.clearChat" class="text-[10px] text-text-muted hover:text-red-400 transition-colors flex items-center gap-0.5" title="清空对话">
              <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"/></svg>
              清空
            </button>
          </div>
          <div class="text-center text-[9px] text-text-muted/50 mt-1.5 flex items-center justify-center gap-1">
            <svg class="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"/></svg>
            输入内容仅用于即时响应，无任何AI训练
          </div>
        </div>
      </div>

      </template><!-- /v-else 常规 AI 聊天 -->
    </div>

    <!-- ==================== 全屏编辑器 ==================== -->
    <CharacterEditor
      v-if="showCharacterEditor"
      :character="editorCharacter"
      :book-id="props.bookId"
      @close="onCharacterEditorClose"
      @saved="onCharacterEditorSaved"
    />
    <WorldSettingEditor
      v-if="showWorldSettingEditor"
      :setting="editorWorldSetting"
      :book-id="props.bookId"
      @close="onWorldSettingEditorClose"
      @saved="onWorldSettingEditorSaved"
    />
    <PlotLineEditor
      v-if="showPlotLineEditor"
      :plot-line="editorPlotLine"
      :book-id="props.bookId"
      @close="onPlotLineEditorClose"
      @saved="onPlotLineEditorSaved"
    />
    <ForeshadowingEditor
      v-if="showForeshadowingEditor"
      :foreshadowing="editorForeshadowing"
      :book-id="props.bookId"
      :chapter-id="props.chapterId"
      @close="onForeshadowingEditorClose"
      @saved="onForeshadowingEditorSaved"
    />
  </div>
</template>

<style scoped>
.ai-message :deep(p) { margin: 0.25em 0; }
.ai-message :deep(p:first-child) { margin-top: 0; }
.ai-message :deep(p:last-child) { margin-bottom: 0; }
.ai-message :deep(strong) { font-weight: 600; color: var(--color-text-primary, #1a1a1a); }
.ai-message :deep(code) { background: rgba(0,0,0,0.06); padding: 0.1em 0.35em; border-radius: 4px; font-size: 0.9em; }
.ai-message :deep(pre) { background: #1e1e1e; color: #d4d4d4; padding: 0.75em 1em; border-radius: 8px; overflow-x: auto; margin: 0.5em 0; }
.ai-message :deep(pre code) { background: none; padding: 0; color: inherit; }
.ai-message :deep(ul), .ai-message :deep(ol) { padding-left: 1.2em; margin: 0.3em 0; }
.ai-message :deep(li) { margin: 0.15em 0; }
.ai-message :deep(blockquote) { border-left: 3px solid var(--color-brand, #6366f1); padding-left: 0.75em; margin: 0.4em 0; color: #6b7280; font-style: italic; }
.ai-message :deep(h1), .ai-message :deep(h2), .ai-message :deep(h3) { font-weight: 600; margin: 0.4em 0 0.2em; }
.ai-message :deep(hr) { border: none; border-top: 1px solid #e5e7eb; margin: 0.5em 0; }
.ai-message :deep(a) { color: var(--color-brand, #6366f1); text-decoration: underline; }
.ai-message :deep(table) { border-collapse: collapse; width: 100%; margin: 0.4em 0; }
.ai-message :deep(th), .ai-message :deep(td) { border: 1px solid #e5e7eb; padding: 0.3em 0.6em; }
.ai-message :deep(th) { background: #f9fafb; font-weight: 600; }

.fade-mask-enter-active, .fade-mask-leave-active { transition: opacity 0.2s ease; }
.fade-mask-enter-from, .fade-mask-leave-to { opacity: 0; }
.stream-bar { animation: stream-slide 1.2s ease-in-out infinite; }
@keyframes stream-slide { 0% { transform: translateX(-110%); } 50% { transform: translateX(40%); } 100% { transform: translateX(210%); } }
.no-scrollbar::-webkit-scrollbar { display: none; }
.no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
.slide-history-enter-active, .slide-history-leave-active { transition: transform 0.25s ease, opacity 0.25s ease; }
.slide-history-enter-from { transform: translateX(-100%); opacity: 0; }
.slide-history-leave-to { transform: translateX(-100%); opacity: 0; }
.expand-enter-active, .expand-leave-active { transition: all 0.2s ease; overflow: hidden; }
.expand-enter-from, .expand-leave-to { max-height: 0; opacity: 0; margin-top: 0; }
.expand-enter-to, .expand-leave-from { max-height: 200px; opacity: 1; }
</style>
