<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch, nextTick } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useBookStore, type Chapter, type ChapterVersion } from '@/stores/book';
import { useAgentStore, type PolishSuggestion } from '@/stores/agent';
import { useAuthStore } from '@/stores/auth';
import { useSocket } from '@/composables/useSocket';
import { useEditor, EditorContent, BubbleMenu } from '@tiptap/vue-3';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Highlight from '@tiptap/extension-highlight';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import ThreeLayerPanel from '@/components/ThreeLayerPanel.vue';
import OnboardingCard from '@/components/OnboardingCard.vue';
import { useOnboarding, type GuideStep } from '@/composables/useOnboarding';
import {
  InlinePolishExtension,
  polishPluginKey,
  buildPolishDecorations,
  findTextInDoc,
  type PolishDecorationItem,
} from '@/components/InlinePolishPlugin';
import { textToHtml } from '@/lib/textToHtml';

const route = useRoute();
const router = useRouter();
const bookStore = useBookStore();
const agentStore = useAgentStore();
const authStore = useAuthStore();
const {
  connect: socketConnect,
  disconnect: socketDisconnect,
  joinDocument,
  leaveDocument,
  emitContentUpdate,
  onContentUpdate,
  isConnected: socketConnected,
} = useSocket();

const bookId = computed(() => route.params.id as string);
const currentChapter = ref<Chapter | null>(null);
const chapterTitle = ref('');
const editorContent = ref('');
const isHydrating = ref(false);
const isSaving = ref(false);
const dirty = ref(false);
const saveStatusText = ref('已保存');
const lastSavedAt = ref<Date | null>(null);
let saveTimer: number | null = null;
const isRemoteUpdate = ref(false);

// 右侧面板
const activeRightPanel = ref<'ai' | 'outline' | 'character' | 'setting' | null>('ai');

// === 可调整面板大小 ===
const PANEL_STORAGE_KEY = 'editor_panel_widths';
const MIN_SIDEBAR_W = 160;
const MAX_SIDEBAR_W = 400;
const MIN_RIGHT_W = 280;
const MAX_RIGHT_W = 600;

// ===== 编辑器新手引导 =====
const editorGuideSteps: GuideStep[] = [
  {
    target: '[data-guide="editor-toolbar"]',
    title: '顶部工具栏',
    content: '包含字体设置、历史版本、查找替换、撤销AI修改等常用操作。右侧显示保存状态和发布按钮。',
    placement: 'bottom',
  },
  {
    target: '[data-guide="chapter-panel"]',
    title: '章节管理面板',
    content: '左侧显示所有章节和卷组结构。可以新建章节/卷、搜索、筛选状态，点击即可切换编辑。',
    placement: 'right',
  },
  {
    target: '[data-guide="editor-main"]',
    title: '富文本编辑器',
    content: '核心写作区域。支持加粗、斜体、高亮、引用等格式。选中文字时会弹出浮动工具栏。',
    placement: 'top',
  },
  {
    target: '[data-guide="right-toolbar"]',
    title: '右侧工具栏',
    content: '包含 9 个强力工具：AI助手、校对、拼字、大纲、角色、世界观设定、灵感、妙笔和智能润色。点击展开对应功能面板。',
    placement: 'left',
  },
  {
    target: '[data-guide="tool-ai"]',
    title: 'AI 写作助手',
    content: '点击打开 AI 对话面板。支持智能写作、情节发展、角色对话、深度思考等多种 AI 能力，是您的核心写作伴侣。',
    placement: 'left',
  },
  {
    target: '[data-guide="tool-outline"]',
    title: '大纲与世界观',
    content: '在这里管理剧情线、伏笔、时间线和世界观设定。AI 会基于这些设定生成更一致的内容。',
    placement: 'left',
  },
  {
    target: '[data-guide="tool-character"]',
    title: '角色管理',
    content: '创建和管理您的角色档案，包括性格、关系、情感变化、成长轨迹。还可以查看角色关系图谱。',
    placement: 'left',
  },
  {
    target: '[data-guide="tool-polish"]',
    title: '智能润色',
    content: '一键对全文进行 Copilot 风格的逐处修改，红绿对比显示每处变更，您可以逐个接受或跳过。',
    placement: 'left',
  },
  {
    target: '[data-guide="status-bar"]',
    title: '底部状态栏',
    content: '显示当前章节字数、计划剩余字数、纠错功能。可以快速新建章节。',
    placement: 'top',
  },
];

const {
  isActive: showEditorGuide,
  currentStep: editorStep,
  currentStepIndex: editorStepIndex,
  totalSteps: editorTotalSteps,
  position: editorPos,
  highlightRect: editorHighlight,
  start: startEditorGuide,
  next: nextEditorGuide,
  prev: prevEditorGuide,
  skip: skipEditorGuide,
} = useOnboarding('onboarding_editor_done', editorGuideSteps);

function loadPanelWidths(): { sidebarWidth: number; rightPanelWidth: number } {
  try {
    const raw = localStorage.getItem(PANEL_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { sidebarWidth: 240, rightPanelWidth: 360 };
}
function savePanelWidths() {
  localStorage.setItem(PANEL_STORAGE_KEY, JSON.stringify({
    sidebarWidth: sidebarWidth.value,
    rightPanelWidth: rightPanelWidth.value,
  }));
}

const initialWidths = loadPanelWidths();
const sidebarWidth = ref(initialWidths.sidebarWidth);
const rightPanelWidth = ref(initialWidths.rightPanelWidth);
const resizingPanel = ref<'sidebar' | 'right' | null>(null);

function startResize(panel: 'sidebar' | 'right', e: MouseEvent) {
  e.preventDefault();
  resizingPanel.value = panel;
  const startX = e.clientX;
  const startW = panel === 'sidebar' ? sidebarWidth.value : rightPanelWidth.value;

  const onMove = (ev: MouseEvent) => {
    const delta = ev.clientX - startX;
    if (panel === 'sidebar') {
      sidebarWidth.value = Math.min(MAX_SIDEBAR_W, Math.max(MIN_SIDEBAR_W, startW + delta));
    } else {
      // right panel: dragging left increases width
      rightPanelWidth.value = Math.min(MAX_RIGHT_W, Math.max(MIN_RIGHT_W, startW - delta));
    }
  };
  const onUp = () => {
    resizingPanel.value = null;
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    savePanelWidths();
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
}

function resetPanelWidth(panel: 'sidebar' | 'right') {
  if (panel === 'sidebar') sidebarWidth.value = 240;
  else rightPanelWidth.value = 360;
  savePanelWidths();
}

// diff 预览
const showDiffOverlay = ref(false);
const diffData = ref<{ oldContent: string; newContent: string } | null>(null);

// 计算行级 diff
function computeLineDiff(oldText: string, newText: string): Array<{ type: 'same' | 'add' | 'remove'; text: string }> {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const result: Array<{ type: 'same' | 'add' | 'remove'; text: string }> = [];

  // 简单 LCS-based line diff
  const m = oldLines.length, n = newLines.length;
  // DP table for LCS
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = oldLines[i - 1] === newLines[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  // Backtrack
  const ops: Array<{ type: 'same' | 'add' | 'remove'; text: string }> = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      ops.push({ type: 'same', text: oldLines[i - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.push({ type: 'add', text: newLines[j - 1] });
      j--;
    } else {
      ops.push({ type: 'remove', text: oldLines[i - 1] });
      i--;
    }
  }
  ops.reverse();
  return ops;
}

const diffLines = computed(() => {
  if (!diffData.value) return [];
  return computeLineDiff(diffData.value.oldContent, diffData.value.newContent);
});

const diffStats = computed(() => {
  const lines = diffLines.value;
  return {
    added: lines.filter(l => l.type === 'add').length,
    removed: lines.filter(l => l.type === 'remove').length,
    same: lines.filter(l => l.type === 'same').length,
  };
});

function handleShowDiff(data: { oldContent: string; newContent: string }) {
  diffData.value = data;
  showDiffOverlay.value = true;
}
function closeDiffOverlay() {
  showDiffOverlay.value = false;
  diffData.value = null;
}
function handleClosePanel() {
  activeRightPanel.value = null;
}

// === 本地回滚栈 ===
// 在 AI 操作修改内容前保存快照，允许一键回滚
const contentSnapshots = ref<Array<{ content: string; label: string; timestamp: number }>>([]);
const MAX_SNAPSHOTS = 20;

function pushSnapshot(label: string) {
  if (!editor.value) return;
  const html = editor.value.getHTML();
  contentSnapshots.value.push({ content: html, label, timestamp: Date.now() });
  if (contentSnapshots.value.length > MAX_SNAPSHOTS) {
    contentSnapshots.value.shift();
  }
}

function rollbackToSnapshot(index: number) {
  if (!editor.value || index < 0 || index >= contentSnapshots.value.length) return;
  const snap = contentSnapshots.value[index];
  isRemoteUpdate.value = true;
  editor.value.commands.setContent(snap.content);
  editorContent.value = snap.content;
  nextTick(() => { isRemoteUpdate.value = false; });
  dirty.value = true;
  saveStatusText.value = '已回滚';
  // 移除此快照之后的所有快照
  contentSnapshots.value = contentSnapshots.value.slice(0, index);
}

function rollbackLastSnapshot() {
  if (contentSnapshots.value.length === 0) return;
  rollbackToSnapshot(contentSnapshots.value.length - 1);
}

const hasSnapshots = computed(() => contentSnapshots.value.length > 0);
const lastSnapshotLabel = computed(() => {
  if (contentSnapshots.value.length === 0) return '';
  return contentSnapshots.value[contentSnapshots.value.length - 1].label;
});

// === 查找替换 ===
const showFindReplace = ref(false);
const findText = ref('');
const replaceText = ref('');
const findResults = ref<{ from: number; to: number }[]>([]);
const currentFindIndex = ref(-1);
const caseSensitive = ref(false);

function doFind() {
  findResults.value = [];
  currentFindIndex.value = -1;
  if (!editor.value || !findText.value) return;
  const doc = editor.value.state.doc;
  const search = caseSensitive.value ? findText.value : findText.value.toLowerCase();

  // 正确遍历 ProseMirror 文档树，精确计算文本位置
  const results: { from: number; to: number }[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    const nodeText = caseSensitive.value ? node.text : node.text.toLowerCase();
    let offset = 0;
    while (offset < nodeText.length) {
      const idx = nodeText.indexOf(search, offset);
      if (idx === -1) break;
      results.push({ from: pos + idx, to: pos + idx + search.length });
      offset = idx + 1;
    }
  });

  findResults.value = results;
  if (results.length > 0) { currentFindIndex.value = 0; highlightFind(0); }
}

function highlightFind(index: number) {
  if (!editor.value || index < 0 || index >= findResults.value.length) return;
  const { from, to } = findResults.value[index];
  editor.value.chain().focus().setTextSelection({ from, to }).scrollIntoView().run();
}

function findNext() {
  if (findResults.value.length === 0) return;
  currentFindIndex.value = (currentFindIndex.value + 1) % findResults.value.length;
  highlightFind(currentFindIndex.value);
}

function findPrev() {
  if (findResults.value.length === 0) return;
  currentFindIndex.value = (currentFindIndex.value - 1 + findResults.value.length) % findResults.value.length;
  highlightFind(currentFindIndex.value);
}

function replaceCurrent() {
  if (!editor.value || currentFindIndex.value < 0) return;
  const { from, to } = findResults.value[currentFindIndex.value];
  editor.value.chain().focus().setTextSelection({ from, to }).deleteSelection().insertContent(replaceText.value).run();
  doFind(); // 重新搜索
}

function replaceAll() {
  if (!editor.value || findResults.value.length === 0) return;
  // 从后往前替换，以保持前面的位置不变
  const sorted = [...findResults.value].sort((a, b) => b.from - a.from);
  for (const { from, to } of sorted) {
    editor.value.chain().setTextSelection({ from, to }).deleteSelection().insertContent(replaceText.value).run();
  }
  doFind();
}

// === 字体 / 背景设置 ===
const showFontSettings = ref(false);
const editorFontSize = ref(16);
const editorLineHeight = ref(1.8);
const editorBgColor = ref('#FFFFFF');
const fontOptions = [14, 15, 16, 17, 18, 20, 22];
const lineHeightOptions = [1.5, 1.6, 1.8, 2.0, 2.2];
const bgOptions = [
  { label: '默认白', value: '#FFFFFF' },
  { label: '羊皮纸', value: '#FAF3E0' },
  { label: '护眼绿', value: '#C7EDCC' },
  { label: '夜间灰', value: '#2D2D2D', dark: true },
  { label: '淡蓝', value: '#E8F0FE' },
  { label: '淡粉', value: '#FFF0F0' },
];

// TipTap Editor
const editor = useEditor({
  extensions: [
    StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
    Placeholder.configure({ placeholder: '在这里开始创作你的故事...' }),
    Highlight,
    TaskList,
    TaskItem.configure({ nested: true }),
    InlinePolishExtension,
  ],
  content: '',
  editable: true,
  editorProps: {
    attributes: { class: 'focus:outline-none min-h-[500px]' },
    handleKeyDown: (_view, event) => {
      // 润色模式下锁定编辑器输入（仅允许我们的接受/拒绝操作）
      if (polishMode.value && pendingPolishCount.value > 0) {
        // 允许快捷键被全局 handler 捕获
        if (['Enter', 'Escape', 'Tab'].includes(event.key)) return false;
        // 允许 Ctrl 组合键（如 Ctrl+C 复制）
        if (event.ctrlKey || event.metaKey) return false;
        // 阻止普通文字输入和删除
        if (event.key.length === 1 || event.key === 'Backspace' || event.key === 'Delete') {
          return true; // true = 阻止
        }
      }
      return false;
    },
  },
  onUpdate: ({ editor: ed }) => {
    if (isRemoteUpdate.value || isHydrating.value) return;
    editorContent.value = ed.getHTML();
  },
});

const showHistoryModal = ref(false);
const historyVersions = ref<ChapterVersion[]>([]);
const loadingHistory = ref(false);
const searchChapter = ref('');

const ungroupedChapters = computed(() => bookStore.ungroupedChapters);
const volumes = computed(() => bookStore.currentBook?.volumes || []);
const currentWordCount = computed(() => calculateWordCount(editorContent.value));
const planTarget = computed(() => 6000); // 每章计划字数
const chapterFilter = ref<'all' | 'draft' | 'published'>('all');

function filterByStatus<T extends { status: string }>(list: T[]) {
  if (chapterFilter.value === 'draft') return list.filter(c => c.status !== 'PUBLISHED');
  if (chapterFilter.value === 'published') return list.filter(c => c.status === 'PUBLISHED');
  return list;
}

const filteredUngroupedChapters = computed(() => {
  let result = ungroupedChapters.value;
  if (searchChapter.value) result = result.filter(c => c.title.includes(searchChapter.value));
  return filterByStatus(result);
});

// ==== Lifecycle ====
/** 润色快捷键处理 */
function handlePolishKeydown(e: KeyboardEvent) {
  if (!polishMode.value || pendingPolishCount.value === 0) return;
  if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey) {
    e.preventDefault();
    acceptCurrentSuggestion();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    rejectCurrentSuggestion();
  } else if (e.key === 'Tab' && !e.shiftKey) {
    e.preventDefault();
    agentStore.nextPolishSuggestion();
    nextTick(() => rebuildPolishDecorations());
  } else if (e.key === 'Tab' && e.shiftKey) {
    e.preventDefault();
    agentStore.prevPolishSuggestion();
    nextTick(() => rebuildPolishDecorations());
  }
}

onMounted(async () => {
  document.addEventListener('keydown', handlePolishKeydown);

  // ====== WebSocket 实时协作初始化 ======
  if (authStore.isLoggedIn) {
    socketConnect();
    // 注册远程内容更新回调
    onContentUpdate((data) => {
      if (!currentChapter.value) return;
      console.log('📥 收到远程内容更新:', data.userName);
      isRemoteUpdate.value = true;
      editorContent.value = data.content;
      if (editor.value) {
        editor.value.commands.setContent(data.content);
      }
      nextTick(() => {
        isRemoteUpdate.value = false;
      });
    });
  }

  await loadBook();
  // 首次访问时启动编辑器引导
  nextTick(() => { setTimeout(startEditorGuide, 800); });
});
onUnmounted(() => {
  document.removeEventListener('keydown', handlePolishKeydown);
  if (polishMode.value) stopInlinePolish();
  if (saveTimer) clearTimeout(saveTimer);
  editor.value?.destroy();

  // ====== WebSocket 清理 ======
  if (currentChapter.value) {
    leaveDocument(currentChapter.value.id);
  }
  onContentUpdate(null); // 清除回调
});

watch(bookId, async () => {
  await loadBook();
});
watch([chapterTitle, editorContent], () => {
  if (isHydrating.value || isRemoteUpdate.value || !currentChapter.value) return;
  dirty.value = true;
  saveStatusText.value = '本地实时保存中';
  scheduleSave();

  // ====== WebSocket: 实时同步内容给其他协作者 ======
  if (socketConnected.value && currentChapter.value) {
    const userName = authStore.user?.name || authStore.user?.email || 'Anonymous';
    // 使用时间戳作为简易版本号
    emitContentUpdate(currentChapter.value.id, editorContent.value, Date.now(), userName);
  }
});

// ==== Methods ====
async function loadBook() {
  if (!bookId.value) return;
  await Promise.all([
    bookStore.fetchBook(bookId.value),
    bookStore.fetchStats(),
    bookStore.fetchWritingStats(),
  ]);
  const first = bookStore.currentBook?.chapters?.[0];
  if (first) await selectChapter(first);
  else resetEditor();
}

function resetEditor() {
  currentChapter.value = null;
  chapterTitle.value = '';
  editorContent.value = '';
  dirty.value = false;
  saveStatusText.value = '已保存';
}

async function selectChapter(chapter: Chapter) {
  if (dirty.value) await saveNow();
  // 润色模式下切换章节，先清理
  if (polishMode.value) stopInlinePolish();
  // 清除残留的保存定时器，防止竞态覆写
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }

  // ====== WebSocket: 离开旧房间 ======
  if (currentChapter.value && socketConnected.value) {
    leaveDocument(currentChapter.value.id);
  }

  isHydrating.value = true;
  try {
    const latest = await bookStore.fetchChapter(chapter.id);
    currentChapter.value = latest;
    chapterTitle.value = latest.title || '';
    editorContent.value = latest.content || '';
    if (editor.value) {
      isRemoteUpdate.value = true;
      editor.value.commands.setContent(latest.content || '');
      await nextTick();
      isRemoteUpdate.value = false;
    }
    dirty.value = false;
    saveStatusText.value = '已保存';

    // ====== WebSocket: 加入新房间 ======
    if (socketConnected.value) {
      const userName = authStore.user?.name || authStore.user?.email || 'Anonymous';
      joinDocument(latest.id, userName);
    }
  } finally {
    isHydrating.value = false;
  }
}

async function createChapter() {
  try {
    const chapter = await bookStore.createChapter(bookId.value, {
      title: `第${(bookStore.currentBook?.chapters?.length || 0) + 1}章`,
    });
    if (chapter) await selectChapter(chapter);
  } catch (err: any) {
    alert('新建章节失败: ' + (err?.message || '未知错误'));
  }
}

async function createVolume() {
  try {
    await bookStore.createVolume(bookId.value, {
      title: `第${(bookStore.currentBook?.volumes?.length || 0) + 1}卷`,
    });
  } catch (err: any) {
    alert('新建卷失败: ' + (err?.message || '未知错误'));
  }
}

async function deleteChapter(chapter: Chapter, event: Event) {
  event.stopPropagation();
  if (!confirm(`确定删除"${chapter.title}"吗？`)) return;
  try {
    await bookStore.deleteChapter(chapter.id);
    if (currentChapter.value?.id === chapter.id) {
      const next = bookStore.currentBook?.chapters?.[0];
      if (next) await selectChapter(next);
      else resetEditor();
    }
  } catch (err: any) {
    alert('删除章节失败: ' + (err?.message || '未知错误'));
  }
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => saveNow(), 3000);
}

async function saveNow() {
  if (!currentChapter.value || isSaving.value || !dirty.value) return;
  isSaving.value = true;
  try {
    const updated = await bookStore.saveChapter(currentChapter.value.id, {
      title: chapterTitle.value,
      content: editorContent.value,
    });
    currentChapter.value = { ...currentChapter.value, ...updated };
    dirty.value = false;
    saveStatusText.value = '已保存';
    lastSavedAt.value = new Date();
    await Promise.all([bookStore.fetchStats(), bookStore.fetchWritingStats()]);
  } finally {
    isSaving.value = false;
  }
}

async function publishCurrentChapter() {
  if (!currentChapter.value) return;
  await saveNow();
  await bookStore.publishChapter(currentChapter.value.id);
  const latest = await bookStore.fetchChapter(currentChapter.value.id);
  currentChapter.value = latest;
  saveStatusText.value = '已发布';
}

async function openHistory() {
  if (!currentChapter.value) return;
  showHistoryModal.value = true;
  loadingHistory.value = true;
  try {
    historyVersions.value = await bookStore.fetchChapterHistory(currentChapter.value.id);
  } finally {
    loadingHistory.value = false;
  }
}

async function rollback(version: ChapterVersion) {
  if (!currentChapter.value) return;
  if (!confirm(`确认回滚到版本 #${version.version}？`)) return;
  pushSnapshot('版本回滚前');
  const updated = await bookStore.rollbackChapter(currentChapter.value.id, version.id);
  currentChapter.value = updated;
  chapterTitle.value = updated.title;
  editorContent.value = updated.content || '';
  if (editor.value) {
    isRemoteUpdate.value = true;
    editor.value.commands.setContent(updated.content || '');
    await nextTick();
    isRemoteUpdate.value = false;
  }
  dirty.value = false;
  saveStatusText.value = '已回滚';
  showHistoryModal.value = false;
}

function getStatusIcon(status: string) {
  if (status === 'PUBLISHED') return '✓';
  if (status === 'SCHEDULED') return '◷';
  return '○';
}

function getStatusColor(status: string) {
  if (status === 'PUBLISHED') return 'text-success';
  if (status === 'SCHEDULED') return 'text-warning';
  return 'text-text-muted';
}

function calculateWordCount(content: string) {
  if (!content) return 0;
  const text = content.replace(/<[^>]*>/g, '').trim();
  const cn = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const en = text.replace(/[\u4e00-\u9fa5]/g, ' ').split(/\s+/).filter(Boolean).length;
  return cn + en;
}

function handleAgentApply(content: string) {
  if (!editor.value) return;
  pushSnapshot('AI 替换内容');
  // 替换整个文档内容（用于改进/扩展/生成等替换类操作）
  const html = textToHtml(content);
  editor.value.commands.setContent(html);
  editorContent.value = editor.value.getHTML();
  dirty.value = true;
  saveStatusText.value = '本地实时保存中';
  scheduleSave();
  agentStore.reset();
}

function handleAgentInsert(content: string) {
  if (!editor.value) return;
  pushSnapshot('AI 续写追加');
  // 将纯文本转换为 HTML 段落格式，确保续写内容正确分段
  const html = textToHtml(content);
  editor.value.commands.insertContent(html);
  agentStore.reset();
}

const agentContent = computed(() => editor.value?.getText() || '');

// ===== 内联润色（Copilot 风格） =====
const polishMode = ref(false);
const polishReviewPos = ref<{ top: number; left: number } | null>(null);

/** 触发内联润色 */
async function startInlinePolish() {
  if (!editor.value || !currentChapter.value) return;
  const text = editor.value.getText();
  if (!text || text.length < 10) return;
  pushSnapshot('内联润色前');
  polishMode.value = true;
  agentStore.requestInlinePolish(
    bookId.value,
    text,
    currentChapter.value.id,
    chapterTitle.value,
  );
}

/** 停止润色模式 */
function stopInlinePolish() {
  polishMode.value = false;
  agentStore.clearPolish();
  // 清除编辑器装饰
  if (editor.value) {
    const { state, view } = editor.value;
    const tr = state.tr.setMeta(polishPluginKey, buildPolishDecorations(state.doc, []));
    view.dispatch(tr);
  }
}

/** 接受当前建议：替换文本并更新装饰 */
function acceptCurrentSuggestion() {
  const sug = currentSuggestion.value;
  if (!sug || !editor.value || sug.from == null || sug.to == null) return;

  // 先记录要接受的 id
  const id = sug.id;
  const replacement = sug.replacement;
  const from = sug.from;
  const to = sug.to;

  // 在编辑器中执行替换
  isRemoteUpdate.value = true;
  editor.value.chain().focus().setTextSelection({ from, to }).deleteSelection().insertContent(replacement).run();
  editorContent.value = editor.value.getHTML();
  nextTick(() => { isRemoteUpdate.value = false; });

  // 标记已接受
  agentStore.acceptPolishSuggestion(id);

  // 润色替换后显式触发保存（isRemoteUpdate 跳过了 watcher）
  dirty.value = true;
  saveStatusText.value = '本地实时保存中';
  scheduleSave();

  // 替换后需要重新映射所有建议的位置
  nextTick(() => rebuildPolishDecorations());
}

/** 拒绝当前建议 */
function rejectCurrentSuggestion() {
  const sug = currentSuggestion.value;
  if (!sug) return;
  agentStore.rejectPolishSuggestion(sug.id);
  nextTick(() => rebuildPolishDecorations());
}

/** 接受所有待处理建议 */
function acceptAllSuggestions() {
  if (!editor.value) return;
  // 从后往前替换（保持位置不变）
  const pendings = agentStore.polishSuggestions
    .filter(s => s.status === 'pending' && s.from != null && s.to != null)
    .sort((a, b) => (b.from ?? 0) - (a.from ?? 0));

  isRemoteUpdate.value = true;
  for (const sug of pendings) {
    editor.value.chain().setTextSelection({ from: sug.from!, to: sug.to! }).deleteSelection().insertContent(sug.replacement).run();
  }
  editorContent.value = editor.value.getHTML();
  nextTick(() => { isRemoteUpdate.value = false; });

  agentStore.acceptAllPolish();

  // 批量接受后显式触发保存（isRemoteUpdate 跳过了 watcher）
  dirty.value = true;
  saveStatusText.value = '本地实时保存中';
  scheduleSave();

  nextTick(() => rebuildPolishDecorations());
}

/** 拒绝所有待处理建议 */
function rejectAllSuggestions() {
  agentStore.rejectAllPolish();
  nextTick(() => rebuildPolishDecorations());
}

/** 当前正在审阅的建议 */
const currentSuggestion = computed<PolishSuggestion | null>(() => {
  const suggestions = agentStore.polishSuggestions;
  if (suggestions.length === 0) return null;
  const idx = agentStore.currentPolishIndex;
  return suggestions[idx] ?? null;
});

/** 待处理建议数 */
const pendingPolishCount = computed(() =>
  agentStore.polishSuggestions.filter(s => s.status === 'pending').length,
);

/** 重建所有润色装饰 */
function rebuildPolishDecorations() {
  if (!editor.value) return;
  const { state, view } = editor.value;
  const doc = state.doc;

  const suggestions = agentStore.polishSuggestions;
  const currentIdx = agentStore.currentPolishIndex;

  const items: PolishDecorationItem[] = [];
  let lastEnd = 0;

  for (let i = 0; i < suggestions.length; i++) {
    const s = suggestions[i];
    if (s.status !== 'pending') continue;

    // 在文档中查找原文位置
    const found = findTextInDoc(doc, s.original, lastEnd);
    if (!found) continue;

    // 更新 store 中的位置
    s.from = found.from;
    s.to = found.to;
    lastEnd = found.to;

    items.push({
      from: found.from,
      to: found.to,
      replacement: s.replacement,
      reason: s.reason,
      isCurrent: i === currentIdx,
      suggestionId: s.id,
    });
  }

  const decoSet = buildPolishDecorations(doc, items);
  const tr = state.tr.setMeta(polishPluginKey, decoSet);
  view.dispatch(tr);

  // 如果有当前建议，滚动到它并更新浮层位置
  const cur = suggestions[currentIdx];
  if (cur && cur.from != null && polishMode.value) {
    try {
      const coords = view.coordsAtPos(cur.from);
      const editorRect = view.dom.getBoundingClientRect();
      polishReviewPos.value = {
        top: coords.top - editorRect.top - 36,
        left: coords.left - editorRect.left,
      };
      // 滚动到可见区域
      editor.value.chain().setTextSelection(cur.from).scrollIntoView().run();
    } catch {
      polishReviewPos.value = null;
    }
  }
}

// 监听 store 中 suggestions 变化，自动重建装饰
watch(
  () => [agentStore.polishSuggestions.length, agentStore.currentPolishIndex],
  () => {
    if (polishMode.value) {
      nextTick(() => rebuildPolishDecorations());
    }
  },
);

async function refreshChapterList() {
  if (!bookId.value) return;
  await bookStore.fetchBook(bookId.value);
  // 同步刷新当前编辑中的章节内容（修复 accept_diff 后编辑器不更新的问题）
  if (currentChapter.value) {
    try {
      pushSnapshot('AI 变更应用前');
      const latest = await bookStore.fetchChapter(currentChapter.value.id);
      if (latest && editor.value) {
        isHydrating.value = true;
        isRemoteUpdate.value = true;
        currentChapter.value = latest;
        chapterTitle.value = latest.title || '';
        editorContent.value = latest.content || '';
        editor.value.commands.setContent(latest.content || '');
        await nextTick();
        isRemoteUpdate.value = false;
        isHydrating.value = false;
        dirty.value = false;
        saveStatusText.value = '已保存';
      }
    } catch { /* 章节可能已删除 */ }
  }
}

function goHome() { router.push('/'); }
</script>

<template>
  <div class="flex-1 flex flex-col min-h-0 overflow-hidden bg-surface-secondary">
    <!-- ==================== 顶部工具栏 ==================== -->
    <div class="h-11 bg-white border-b border-border flex items-center justify-between px-4 shrink-0" data-guide="editor-toolbar">
      <div class="flex items-center gap-3 min-w-0">
        <button @click="goHome" class="flex items-center gap-1.5 text-sm text-text-secondary hover:text-brand transition-colors">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5"/>
          </svg>
          返回
        </button>
        <div class="h-4 w-px bg-border"/>
        <span class="text-sm font-medium text-text-primary truncate max-w-[200px]">
          {{ bookStore.currentBook?.title || '加载中...' }}
        </span>
      </div>

      <div class="flex items-center gap-2">
        <!-- 工具栏按钮组 -->
        <div class="flex items-center gap-1 mr-3">
          <button class="btn-ghost text-xs" @click="showFontSettings = !showFontSettings" title="字体">T 字体</button>
          <button class="btn-ghost text-xs" @click="openHistory" :disabled="!currentChapter" title="历史">
            <svg class="w-3.5 h-3.5 inline-block mr-0.5 -mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
            历史
          </button>
          <button class="btn-ghost text-xs" @click="showFindReplace = !showFindReplace" :class="showFindReplace ? 'bg-brand-50 text-brand' : ''" title="查找替换">
            <svg class="w-3.5 h-3.5 inline-block mr-0.5 -mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"/></svg>
            查找
          </button>
          <button
            v-if="hasSnapshots"
            class="btn-ghost text-xs text-warning hover:text-amber-600"
            @click="rollbackLastSnapshot"
            :title="'撤销: ' + lastSnapshotLabel"
          >
            <svg class="w-3.5 h-3.5 inline-block mr-0.5 -mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3"/></svg>
            撤销AI
          </button>
        </div>

        <span class="text-xs px-2" :class="dirty ? 'text-warning' : 'text-success'">
          <span class="inline-block w-1.5 h-1.5 rounded-full mr-1" :class="dirty ? 'bg-warning' : 'bg-success'"></span>
          {{ isSaving ? '保存中...' : saveStatusText }}
        </span>

        <!-- 操作按钮 -->
        <button @click="saveNow" :disabled="!dirty || isSaving" class="px-3 py-1.5 text-xs text-text-secondary hover:text-brand rounded-md hover:bg-brand-50 transition-colors disabled:opacity-40">
          保存
        </button>
        <button @click="publishCurrentChapter" :disabled="!currentChapter" class="px-4 py-1.5 text-xs text-white bg-brand hover:bg-brand-dark rounded-md disabled:opacity-40 font-medium transition-colors">
          发布
        </button>
      </div>
    </div>

    <!-- ==================== 查找替换栏 ==================== -->
    <div v-if="showFindReplace" class="bg-white border-b border-border px-4 py-2 flex items-center gap-3 shrink-0 animate-slide-up">
      <div class="flex items-center gap-2 flex-1">
        <div class="relative flex-1 max-w-xs">
          <input v-model="findText" @input="doFind" @keydown.enter.prevent="findNext" class="w-full px-3 py-1.5 text-xs border border-border rounded-md focus:border-brand focus:outline-none" placeholder="查找内容..." />
          <span v-if="findResults.length > 0" class="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-text-muted">{{ currentFindIndex + 1 }}/{{ findResults.length }}</span>
        </div>
        <div class="relative flex-1 max-w-xs">
          <input v-model="replaceText" @keydown.enter.prevent="replaceCurrent" class="w-full px-3 py-1.5 text-xs border border-border rounded-md focus:border-brand focus:outline-none" placeholder="替换为..." />
        </div>
      </div>
      <div class="flex items-center gap-1.5">
        <label class="flex items-center gap-1 text-xs text-text-secondary cursor-pointer">
          <input type="checkbox" v-model="caseSensitive" @change="doFind" class="w-3.5 h-3.5 accent-brand" /> Aa
        </label>
        <button @click="findPrev" :disabled="findResults.length === 0" class="px-2 py-1 text-xs text-text-secondary hover:text-brand hover:bg-brand-50 rounded disabled:opacity-30">↑</button>
        <button @click="findNext" :disabled="findResults.length === 0" class="px-2 py-1 text-xs text-text-secondary hover:text-brand hover:bg-brand-50 rounded disabled:opacity-30">↓</button>
        <button @click="replaceCurrent" :disabled="findResults.length === 0" class="px-2.5 py-1 text-xs bg-brand-50 text-brand rounded hover:bg-brand-100 disabled:opacity-30">替换</button>
        <button @click="replaceAll" :disabled="findResults.length === 0" class="px-2.5 py-1 text-xs bg-brand-50 text-brand rounded hover:bg-brand-100 disabled:opacity-30">全部</button>
        <button @click="showFindReplace = false; findText = ''; findResults = []; currentFindIndex = -1" class="px-1.5 py-1 text-text-muted hover:text-text-primary text-xs">✕</button>
      </div>
    </div>

    <!-- ==================== 字体/背景设置浮层 ==================== -->
    <div v-if="showFontSettings" class="absolute top-12 right-40 z-50 bg-white border border-border rounded-xl shadow-dropdown p-4 w-72 animate-fade-in" @click.stop>
      <div class="flex items-center justify-between mb-3">
        <h4 class="text-sm font-medium text-text-primary">编辑器设置</h4>
        <button @click="showFontSettings = false" class="text-text-muted hover:text-text-primary text-xs">✕</button>
      </div>
      <div class="space-y-4">
        <div>
          <div class="text-xs text-text-secondary mb-2">字号</div>
          <div class="flex items-center gap-1.5">
            <button v-for="s in fontOptions" :key="s" @click="editorFontSize = s" class="px-2.5 py-1 text-xs rounded-md border transition-colors" :class="editorFontSize === s ? 'bg-brand text-white border-brand' : 'text-text-secondary border-border hover:border-brand'">{{ s }}</button>
          </div>
        </div>
        <div>
          <div class="text-xs text-text-secondary mb-2">行距</div>
          <div class="flex items-center gap-1.5">
            <button v-for="lh in lineHeightOptions" :key="lh" @click="editorLineHeight = lh" class="px-2.5 py-1 text-xs rounded-md border transition-colors" :class="editorLineHeight === lh ? 'bg-brand text-white border-brand' : 'text-text-secondary border-border hover:border-brand'">{{ lh }}</button>
          </div>
        </div>
        <div>
          <div class="text-xs text-text-secondary mb-2">背景色</div>
          <div class="flex items-center gap-2">
            <button v-for="bg in bgOptions" :key="bg.value" @click="editorBgColor = bg.value" class="w-8 h-8 rounded-lg border-2 transition-all" :class="editorBgColor === bg.value ? 'border-brand shadow-sm scale-110' : 'border-border hover:border-brand/50'" :style="{ backgroundColor: bg.value }" :title="bg.label" />
          </div>
        </div>
      </div>
    </div>

    <!-- ==================== 主要内容区 ==================== -->
    <div class="flex-1 flex min-h-0">
      <!-- ========== 左侧：章节列表 ========== -->
      <aside data-guide="chapter-panel" class="bg-white border-r border-border flex flex-col shrink-0" :style="{ width: sidebarWidth + 'px' }">
        <!-- 搜索 -->
        <div class="p-3 border-b border-border">
          <div class="relative">
            <svg class="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"/>
            </svg>
            <input v-model="searchChapter" type="text" class="w-full pl-8 pr-3 py-1.5 text-xs border border-border rounded-md bg-surface-secondary placeholder:text-text-muted focus:outline-none focus:border-brand" placeholder="全书" />
          </div>
        </div>

        <!-- 新建按钮 -->
        <div class="px-3 py-2 flex items-center gap-2 border-b border-border">
          <button @click="createChapter" class="flex-1 px-3 py-1.5 bg-brand text-white text-xs rounded-md font-medium hover:bg-brand-dark transition-colors">
            新建章
          </button>
          <button @click="createVolume" class="flex-1 px-3 py-1.5 bg-surface-secondary text-text-secondary text-xs rounded-md font-medium hover:bg-surface-hover transition-colors border border-border">
            新建卷
          </button>
        </div>

        <!-- 筛选标签 -->
        <div class="px-3 py-2 flex items-center gap-2 text-xs text-text-muted border-b border-border">
          <span @click="chapterFilter = 'all'" class="cursor-pointer transition-colors" :class="chapterFilter === 'all' ? 'text-text-primary font-medium' : 'hover:text-text-primary'">全部</span>
          <span @click="chapterFilter = 'draft'" class="cursor-pointer transition-colors" :class="chapterFilter === 'draft' ? 'text-text-primary font-medium' : 'hover:text-text-primary'">草稿</span>
          <span @click="chapterFilter = 'published'" class="cursor-pointer transition-colors" :class="chapterFilter === 'published' ? 'text-text-primary font-medium' : 'hover:text-text-primary'">已发布</span>
        </div>

        <!-- 章节列表 -->
        <div class="flex-1 overflow-y-auto">
          <!-- 未分卷 -->
          <div v-if="filteredUngroupedChapters.length > 0">
            <div
              v-for="chapter in filteredUngroupedChapters"
              :key="chapter.id"
              @click="selectChapter(chapter)"
              class="group flex items-center px-3 py-2.5 cursor-pointer border-b border-border/50 transition-colors"
              :class="currentChapter?.id === chapter.id ? 'bg-brand-50 border-l-2 border-l-brand' : 'hover:bg-surface-hover'"
            >
              <span class="text-xs mr-2" :class="getStatusColor(chapter.status)">{{ getStatusIcon(chapter.status) }}</span>
              <span class="flex-1 text-sm truncate" :class="currentChapter?.id === chapter.id ? 'text-brand font-medium' : 'text-text-primary'">
                {{ chapter.title }}
              </span>
              <span class="text-xs text-text-muted tabular-nums">{{ chapter.wordCount || 0 }}</span>
              <button @click="deleteChapter(chapter, $event)" class="ml-1.5 opacity-0 group-hover:opacity-100 text-text-muted hover:text-danger text-xs transition-opacity">✕</button>
            </div>
          </div>

          <!-- 分卷 -->
          <div v-for="volume in volumes" :key="volume.id">
            <div class="px-3 py-2 text-xs font-medium text-text-secondary bg-surface-secondary">{{ volume.title }}</div>
            <div
              v-for="chapter in filterByStatus(volume.chapters || [])"
              :key="chapter.id"
              @click="selectChapter(chapter)"
              class="group flex items-center px-3 py-2.5 cursor-pointer border-b border-border/50 transition-colors"
              :class="currentChapter?.id === chapter.id ? 'bg-brand-50 border-l-2 border-l-brand' : 'hover:bg-surface-hover'"
            >
              <span class="text-xs mr-2" :class="getStatusColor(chapter.status)">{{ getStatusIcon(chapter.status) }}</span>
              <span class="flex-1 text-sm truncate" :class="currentChapter?.id === chapter.id ? 'text-brand font-medium' : 'text-text-primary'">
                {{ chapter.title }}
              </span>
              <span class="text-xs text-text-muted tabular-nums">{{ chapter.wordCount || 0 }}</span>
            </div>
          </div>
        </div>
      </aside>

      <!-- 左侧 sash -->
      <div
        class="sash-handle shrink-0"
        :class="resizingPanel === 'sidebar' ? 'active' : ''"
        @mousedown="startResize('sidebar', $event)"
        @dblclick="resetPanelWidth('sidebar')"
      ></div>

      <!-- ========== 中间：编辑器 ========== -->
      <main data-guide="editor-main" class="flex-1 flex flex-col min-w-0 bg-white">
        <template v-if="currentChapter">
          <!-- 章节标题区 -->
          <div class="px-12 pt-8 pb-4">
            <input
              v-model="chapterTitle"
              class="text-2xl font-bold text-text-primary bg-transparent outline-none w-full border-none placeholder:text-text-muted"
              placeholder="章节标题"
            />
            <div class="mt-2 text-xs text-text-muted flex items-center gap-3">
              <span v-if="currentChapter.publishedAt">
                发布于 {{ new Date(currentChapter.publishedAt).toLocaleString('zh-CN') }} | 公众章节
              </span>
              <span v-else class="text-warning">草稿</span>
            </div>
          </div>

          <!-- 编辑器主体 -->
          <div class="flex-1 overflow-y-auto px-12 transition-colors duration-200" :style="{ backgroundColor: editorBgColor, fontSize: editorFontSize + 'px', lineHeight: String(editorLineHeight), color: bgOptions.find(b => b.value === editorBgColor)?.dark ? '#d4d4d4' : '#1a1a1a' }">
            <BubbleMenu
              v-if="editor"
              :editor="editor"
              :tippy-options="{ duration: 100 }"
              class="bg-white border border-border rounded-lg shadow-dropdown flex items-center gap-0.5 p-1"
            >
              <button @click="editor!.chain().focus().toggleBold().run()" :class="{ 'bg-brand-50 text-brand': editor!.isActive('bold') }" class="px-2 py-1 hover:bg-surface-hover rounded text-sm font-bold text-text-primary transition-colors">B</button>
              <button @click="editor!.chain().focus().toggleItalic().run()" :class="{ 'bg-brand-50 text-brand': editor!.isActive('italic') }" class="px-2 py-1 hover:bg-surface-hover rounded text-sm italic text-text-primary transition-colors">I</button>
              <button @click="editor!.chain().focus().toggleHighlight().run()" :class="{ 'bg-brand-50 text-brand': editor!.isActive('highlight') }" class="px-2 py-1 hover:bg-surface-hover rounded text-sm text-text-primary transition-colors">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9.53 16.122a3 3 0 00-5.78 1.128 2.25 2.25 0 01-2.4 2.245 4.5 4.5 0 008.4-2.245c0-.399-.078-.78-.22-1.128zm0 0a15.998 15.998 0 003.388-1.62m-5.043-.025a15.994 15.994 0 011.622-3.395m3.42 3.42a15.995 15.995 0 004.764-4.648l3.876-5.814a1.151 1.151 0 00-1.597-1.597L14.146 6.32a15.996 15.996 0 00-4.649 4.763m3.42 3.42a6.776 6.776 0 00-3.42-3.42"/></svg>
              </button>
              <div class="w-px h-5 bg-border mx-0.5"/>
              <button @click="editor!.chain().focus().toggleBlockquote().run()" class="px-2 py-1 hover:bg-surface-hover rounded text-sm text-text-primary transition-colors">引</button>
              <button @click="editor!.chain().focus().toggleCodeBlock().run()" class="px-2 py-1 hover:bg-surface-hover rounded text-sm text-text-primary transition-colors font-mono">&lt;&gt;</button>
            </BubbleMenu>
            <EditorContent :editor="editor" />

            <!-- 内联润色浮动审阅栏 -->
            <div v-if="polishMode" class="polish-review-bar">
              <!-- 加载提示 -->
              <template v-if="agentStore.polishLoading && agentStore.polishSuggestions.length === 0">
                <div class="flex items-center gap-2 text-xs text-text-muted">
                  <svg class="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" opacity="0.25"/><path d="M4 12a8 8 0 018-8" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>
                  AI 正在分析文本...
                </div>
              </template>

              <template v-else-if="agentStore.polishSuggestions.length > 0">
                <!-- 进度 + 加载指示 -->
                <div class="flex items-center gap-2 text-xs">
                  <span class="text-text-secondary font-medium">
                    润色 {{ agentStore.polishSuggestions.length - pendingPolishCount }}/{{ agentStore.polishSuggestions.length }}
                  </span>
                  <svg v-if="agentStore.polishLoading" class="w-3 h-3 animate-spin text-brand" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" opacity="0.25"/><path d="M4 12a8 8 0 018-8" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>
                </div>

                <!-- 当前建议详情 -->
                <div v-if="currentSuggestion && currentSuggestion.status === 'pending'" class="flex items-center gap-1.5">
                  <span class="text-xs text-text-muted max-w-[200px] truncate" :title="currentSuggestion.reason">{{ currentSuggestion.reason }}</span>
                  <div class="w-px h-4 bg-border mx-0.5"/>
                  <button @click="agentStore.prevPolishSuggestion(); nextTick(() => rebuildPolishDecorations())" title="上一处 (Shift+Tab)" class="polish-btn">
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5"/></svg>
                  </button>
                  <button @click="agentStore.nextPolishSuggestion(); nextTick(() => rebuildPolishDecorations())" title="下一处 (Tab)" class="polish-btn">
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5"/></svg>
                  </button>
                  <div class="w-px h-4 bg-border mx-0.5"/>
                  <button @click="acceptCurrentSuggestion" title="接受修改 (Enter)" class="polish-btn-accept">
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg>
                  </button>
                  <button @click="rejectCurrentSuggestion" title="跳过修改 (Esc)" class="polish-btn-reject">
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
                  </button>
                </div>

                <!-- 没有更多待处理 -->
                <div v-else class="text-xs text-success font-medium">全部处理完毕</div>

                <!-- 批量操作 -->
                <div class="flex items-center gap-1 ml-auto">
                  <span class="text-[10px] text-text-muted/60 hidden sm:inline mr-1">Enter=接受 Esc=跳过 Tab=下一处</span>
                  <button v-if="pendingPolishCount > 0" @click="acceptAllSuggestions" class="text-xs px-2 py-0.5 rounded bg-green-50 text-green-600 hover:bg-green-100 transition-colors">全部接受</button>
                  <button v-if="pendingPolishCount > 0" @click="rejectAllSuggestions" class="text-xs px-2 py-0.5 rounded bg-red-50 text-red-600 hover:bg-red-100 transition-colors">全部跳过</button>
                  <button @click="stopInlinePolish" class="text-xs px-2 py-0.5 rounded bg-surface-secondary text-text-muted hover:bg-surface-hover transition-colors">关闭</button>
                </div>
              </template>

              <!-- 无建议 -->
              <template v-else>
                <div class="flex items-center gap-2 text-xs text-success">文章无需润色修改</div>
                <button @click="stopInlinePolish" class="text-xs px-2 py-0.5 rounded bg-surface-secondary text-text-muted hover:bg-surface-hover ml-auto">关闭</button>
              </template>
            </div>
          </div>
        </template>

        <div v-else class="flex-1 flex items-center justify-center">
          <div class="text-center">
            <svg class="w-16 h-16 mx-auto mb-3 text-text-muted/30" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1">
              <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"/>
            </svg>
            <p class="text-sm text-text-muted">请选择或创建一个章节开始写作</p>
          </div>
        </div>
      </main>

      <!-- ========== 右侧：工具面板 ========== -->
      <div class="flex shrink-0">
        <!-- 右侧 sash -->
        <div
          v-if="activeRightPanel"
          class="sash-handle shrink-0"
          :class="resizingPanel === 'right' ? 'active' : ''"
          @mousedown="startResize('right', $event)"
          @dblclick="resetPanelWidth('right')"
        ></div>
        <!-- 右侧垂直工具栏 -->
        <div data-guide="right-toolbar" class="w-12 bg-white border-l border-border flex flex-col items-center py-3 gap-0.5">
          <button data-guide="tool-ai" @click="activeRightPanel = activeRightPanel === 'ai' ? null : 'ai'"
            class="w-9 h-9 flex flex-col items-center justify-center rounded-lg transition-colors text-[9px] leading-tight gap-0.5" :class="activeRightPanel === 'ai' ? 'bg-brand-50 text-brand' : 'text-text-muted hover:bg-surface-hover hover:text-text-secondary'" title="AI 助手">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"/></svg>
            <span>AI</span>
          </button>
          <div class="w-6 h-px bg-border my-1"></div>
          <button @click="agentStore.activeRightTool = agentStore.activeRightTool === 'proofread' ? null : 'proofread'; if(agentStore.activeRightTool) activeRightPanel = 'ai'"
            class="w-9 h-9 flex flex-col items-center justify-center rounded-lg transition-colors text-[9px] leading-tight gap-0.5" :class="agentStore.activeRightTool === 'proofread' ? 'bg-brand-50 text-brand' : 'text-text-muted hover:bg-surface-hover hover:text-text-secondary'" title="校对">
            <span class="text-sm">✓</span>
            <span>校对</span>
          </button>
          <button @click="agentStore.activeRightTool = agentStore.activeRightTool === 'spelling' ? null : 'spelling'; if(agentStore.activeRightTool) activeRightPanel = 'ai'"
            class="w-9 h-9 flex flex-col items-center justify-center rounded-lg transition-colors text-[9px] leading-tight gap-0.5" :class="agentStore.activeRightTool === 'spelling' ? 'bg-brand-50 text-brand' : 'text-text-muted hover:bg-surface-hover hover:text-text-secondary'" title="拼字">
            <span class="text-sm">字</span>
            <span>拼字</span>
          </button>
          <button data-guide="tool-outline" @click="activeRightPanel = activeRightPanel === 'outline' ? null : 'outline'"
            class="w-9 h-9 flex flex-col items-center justify-center rounded-lg transition-colors text-[9px] leading-tight gap-0.5" :class="activeRightPanel === 'outline' ? 'bg-brand-50 text-brand' : 'text-text-muted hover:bg-surface-hover hover:text-text-secondary'" title="大纲">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zM3.75 12h.007v.008H3.75V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm-.375 5.25h.007v.008H3.75v-.008zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z"/></svg>
            <span>大纲</span>
          </button>
          <button data-guide="tool-character" @click="activeRightPanel = activeRightPanel === 'character' ? null : 'character'"
            class="w-9 h-9 flex flex-col items-center justify-center rounded-lg transition-colors text-[9px] leading-tight gap-0.5" :class="activeRightPanel === 'character' ? 'bg-brand-50 text-brand' : 'text-text-muted hover:bg-surface-hover hover:text-text-secondary'" title="角色">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"/></svg>
            <span>角色</span>
          </button>
          <button @click="activeRightPanel = activeRightPanel === 'setting' ? null : 'setting'"
            class="w-9 h-9 flex flex-col items-center justify-center rounded-lg transition-colors text-[9px] leading-tight gap-0.5" :class="activeRightPanel === 'setting' ? 'bg-brand-50 text-brand' : 'text-text-muted hover:bg-surface-hover hover:text-text-secondary'" title="设定">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z"/><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
            <span>设定</span>
          </button>
          <div class="w-6 h-px bg-border my-1"></div>
          <button @click="agentStore.activeRightTool = agentStore.activeRightTool === 'inspiration' ? null : 'inspiration'; if(agentStore.activeRightTool) activeRightPanel = 'ai'"
            class="w-9 h-9 flex flex-col items-center justify-center rounded-lg transition-colors text-[9px] leading-tight gap-0.5" :class="agentStore.activeRightTool === 'inspiration' ? 'bg-yellow-50 text-yellow-600' : 'text-text-muted hover:bg-surface-hover hover:text-text-secondary'" title="灵感">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18"/></svg>
            <span>灵感</span>
          </button>
          <button @click="agentStore.activeRightTool = agentStore.activeRightTool === 'writing' ? null : 'writing'; if(agentStore.activeRightTool) activeRightPanel = 'ai'"
            class="w-9 h-9 flex flex-col items-center justify-center rounded-lg transition-colors text-[9px] leading-tight gap-0.5" :class="agentStore.activeRightTool === 'writing' ? 'bg-purple-50 text-purple-600' : 'text-text-muted hover:bg-surface-hover hover:text-text-secondary'" title="妙笔">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125"/></svg>
            <span>妙笔</span>
          </button>
          <div class="w-6 h-px bg-border my-1"></div>
          <button data-guide="tool-polish" @click="startInlinePolish" :disabled="polishMode || !currentChapter"
            class="w-9 h-9 flex flex-col items-center justify-center rounded-lg transition-colors text-[9px] leading-tight gap-0.5"
            :class="polishMode ? 'bg-green-50 text-green-600 ring-1 ring-green-300' : 'text-text-muted hover:bg-surface-hover hover:text-text-secondary'"
            title="智能润色（Copilot风格逐处修改）">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9.53 16.122a3 3 0 00-5.78 1.128 2.25 2.25 0 01-2.4 2.245 4.5 4.5 0 008.4-2.245c0-.399-.078-.78-.22-1.128zm0 0a15.998 15.998 0 003.388-1.62m-5.043-.025a15.994 15.994 0 011.622-3.395m3.42 3.42a15.995 15.995 0 004.764-4.648l3.876-5.814a1.151 1.151 0 00-1.597-1.597L14.146 6.32a15.996 15.996 0 00-4.649 4.763m3.42 3.42a6.776 6.776 0 00-3.42-3.42"/></svg>
            <span>润色</span>
          </button>
        </div>

        <!-- 展开面板 -->
        <transition name="slide-panel">
          <aside v-if="activeRightPanel" class="border-l border-border bg-white flex flex-col overflow-hidden" :style="{ width: rightPanelWidth + 'px' }">
            <ThreeLayerPanel
              :book-id="bookId"
              :chapter-id="currentChapter?.id"
              :chapter-title="chapterTitle"
              :content="agentContent"
              :active-tab="activeRightPanel"
              @apply="handleAgentApply"
              @insert="handleAgentInsert"
              @refresh-chapters="refreshChapterList"
              @show-diff="handleShowDiff"
              @close-panel="handleClosePanel"
            />
          </aside>
        </transition>
      </div>
    </div>

    <!-- ==================== 底部栏 ==================== -->
    <div data-guide="status-bar" class="h-9 bg-white border-t border-border flex items-center justify-between px-4 text-xs shrink-0">
      <div class="flex items-center gap-4">
        <button @click="createChapter" class="flex items-center gap-1 text-brand hover:text-brand-dark transition-colors">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>
          新建章节
        </button>
      </div>
      <div class="flex items-center gap-5 text-text-muted">
        <span>计划：剩 <span class="text-text-primary">{{ Math.max(0, planTarget - currentWordCount).toLocaleString() }}</span></span>
        <span class="text-brand cursor-pointer hover:text-brand-dark">点击纠错</span>
        <span>本章：<span class="text-text-primary font-medium">{{ currentWordCount.toLocaleString() }}</span></span>
      </div>
    </div>

    <!-- ==================== Diff 预览浮层 ==================== -->
    <div v-if="showDiffOverlay && diffData" class="modal-overlay" @click.self="closeDiffOverlay">
      <div class="modal-content w-full max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
        <!-- 头部 -->
        <div class="flex items-center justify-between mb-3 shrink-0">
          <div class="flex items-center gap-3">
            <h3 class="text-lg font-semibold text-text-primary flex items-center gap-2">
              <svg class="w-5 h-5 text-brand" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5"/></svg>
              变更对比
            </h3>
            <div class="flex items-center gap-2 text-xs">
              <span class="inline-flex items-center gap-1 px-2 py-0.5 bg-green-50 text-green-600 rounded border border-green-200">+{{ diffStats.added }} 行</span>
              <span class="inline-flex items-center gap-1 px-2 py-0.5 bg-red-50 text-red-600 rounded border border-red-200">-{{ diffStats.removed }} 行</span>
              <span v-if="diffData" class="text-text-muted">{{ diffData.oldContent.length }} → {{ diffData.newContent.length }} 字</span>
            </div>
          </div>
          <button @click="closeDiffOverlay" class="text-text-muted hover:text-text-primary">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>

        <!-- Diff 行列表 -->
        <div class="flex-1 overflow-y-auto rounded-lg border border-border font-mono text-sm leading-relaxed">
          <div
            v-for="(line, idx) in diffLines"
            :key="idx"
            class="flex"
            :class="{
              'bg-green-50': line.type === 'add',
              'bg-red-50': line.type === 'remove',
              'bg-white': line.type === 'same',
            }"
          >
            <div class="w-8 shrink-0 text-center text-xs py-0.5 select-none border-r border-border/40"
              :class="{
                'text-green-500 bg-green-100/50': line.type === 'add',
                'text-red-500 bg-red-100/50': line.type === 'remove',
                'text-text-muted': line.type === 'same',
              }"
            >
              {{ line.type === 'add' ? '+' : line.type === 'remove' ? '-' : '' }}
            </div>
            <div class="flex-1 px-3 py-0.5 whitespace-pre-wrap break-all"
              :class="{
                'text-green-800': line.type === 'add',
                'text-red-700 line-through': line.type === 'remove',
                'text-text-primary': line.type === 'same',
              }"
            >{{ line.text || '\u00A0' }}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- ==================== 历史版本弹窗 ==================== -->
    <div v-if="showHistoryModal" class="modal-overlay" @click.self="showHistoryModal = false">
      <div class="modal-content w-full max-w-xl">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg font-semibold text-text-primary">章节历史版本</h3>
          <button @click="showHistoryModal = false" class="text-text-muted hover:text-text-primary">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>

        <div v-if="loadingHistory" class="text-text-muted py-8 text-center">加载中...</div>
        <div v-else-if="historyVersions.length === 0" class="text-text-muted py-8 text-center">暂无历史版本</div>
        <ul v-else class="space-y-2 max-h-96 overflow-y-auto">
          <li v-for="version in historyVersions" :key="version.id" class="p-3 bg-surface-secondary rounded-lg flex items-center justify-between gap-4">
            <div class="min-w-0">
              <div class="text-sm text-text-primary font-medium">版本 #{{ version.version }}</div>
              <div class="text-xs text-text-muted mt-0.5">{{ new Date(version.createdAt).toLocaleString('zh-CN') }}</div>
            </div>
            <button @click="rollback(version)" class="px-3 py-1.5 text-xs bg-brand hover:bg-brand-dark text-white rounded-md transition-colors">回滚</button>
          </li>
        </ul>
      </div>
    </div>

    <!-- 新手引导卡片 -->
    <OnboardingCard
      v-if="showEditorGuide && editorStep"
      :title="editorStep.title"
      :content="editorStep.content"
      :step-index="editorStepIndex"
      :total-steps="editorTotalSteps"
      :position="editorPos"
      :arrow-top="editorPos.arrowTop"
      :arrow-left="editorPos.arrowLeft"
      :arrow-direction="editorPos.arrowDirection"
      :highlight-rect="editorHighlight"
      @next="nextEditorGuide"
      @prev="prevEditorGuide"
      @skip="skipEditorGuide"
    />
  </div>
</template>
<style scoped>
@keyframes slideUp {
  from { opacity: 0; transform: translateY(-8px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}
.animate-slide-up { animation: slideUp 0.15s ease-out; }
.animate-fade-in { animation: fadeIn 0.15s ease-out; }

/* VS Code 风格 sash 拖拽手柄 */
.sash-handle {
  width: 4px;
  position: relative;
  cursor: col-resize;
  z-index: 10;
}
.sash-handle::before {
  content: '';
  position: absolute;
  inset: 0 -2px;
  /* 扩大可点击区域到 8px */
}
.sash-handle::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 1px;
  width: 2px;
  background: transparent;
  transition: background 0.15s ease 0.3s; /* 300ms 延迟，模拟 VS Code */
  border-radius: 1px;
}
.sash-handle:hover::after,
.sash-handle.active::after {
  background: #4F7CFF;
  transition-delay: 0.3s;
}
.sash-handle.active::after {
  transition-delay: 0s;
}

/* 内联润色浮动审阅栏 */
.polish-review-bar {
  position: sticky;
  bottom: 0;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 16px;
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(8px);
  border-top: 1px solid #e5e7eb;
  box-shadow: 0 -2px 8px rgba(0,0,0,0.04);
  z-index: 20;
  flex-wrap: wrap;
  animation: polishBarSlideUp 0.2s ease-out;
}

@keyframes polishBarSlideUp {
  from { opacity: 0; transform: translateY(100%); }
  to { opacity: 1; transform: translateY(0); }
}

.polish-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 4px;
  color: #6b7280;
  transition: all 0.15s;
}
.polish-btn:hover {
  background: #f3f4f6;
  color: #374151;
}

.polish-btn-accept {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 6px;
  color: #16a34a;
  background: #f0fdf4;
  transition: all 0.15s;
}
.polish-btn-accept:hover {
  background: #dcfce7;
  color: #15803d;
}

.polish-btn-reject {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 6px;
  color: #dc2626;
  background: #fef2f2;
  transition: all 0.15s;
}
.polish-btn-reject:hover {
  background: #fee2e2;
  color: #b91c1c;
}
</style>