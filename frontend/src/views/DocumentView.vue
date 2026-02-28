<script setup lang="ts">
/**
 * 文档编辑页面视图组件（DocumentView.vue）
 * ============================================
 * 这是文档编辑的核心页面，类似于公司的会议室
 *
 * 核心功能：
 * 1. 加载和显示文档内容 - 从后端获取文档数据
 * 2. 实时协作连接 - 通过 WebSocket 与其他用户同步
 * 3. 文档标题编辑 - 可以修改文档标题
 * 4. 内容变化处理 - 编辑器内容变化时保存到后端
 * 5. AI 功能集成 - 选中文本后可以调用 AI
 * 6. 协作者显示 - 显示当前在线的其他用户
 *
 * 什么是 ref？
 * - Vue 3 的响应式数据
 * - ref() 创建响应式变量，值变化会自动更新界面
 */

import { ref, onMounted, onBeforeUnmount, watch } from 'vue';
// 引入路由，获取 URL 参数
import { useRoute, useRouter } from 'vue-router';
// 引入文档 store
import { useDocumentStore } from '@/stores/document';
// 引入 AI store
import { useAiStore } from '@/stores/ai';
// 引入 Socket 连接
import { useSocket } from '@/composables/useSocket';
// 引入 TipTap 编辑器组件
import TipTapEditor from '@/components/TipTapEditor.vue';
// 引入 AI 面板组件
import AiPanel from '@/components/AiPanel.vue';

/**
 * 获取路由信息
 * route.params.id 包含 URL 中的文档 ID
 */
const route = useRoute();
const router = useRouter();
const documentStore = useDocumentStore();
const aiStore = useAiStore();
const { joinDocument, leaveDocument, emitContentUpdate } = useSocket();

// 从 URL 参数获取文档 ID
const documentId = route.params.id as string;

// 文档标题（响应式变量）
const title = ref('');
// 是否正在编辑标题（目前未使用）
const isEditingTitle = ref(false);
// 保存定时器（用于防抖）- 标题和内容分开防抖，避免互相覆盖
const titleSaveTimeout = ref<number | null>(null);
const contentSaveTimeout = ref<number | null>(null);
// 编辑器组件引用
const editorRef = ref<any>(null);

/**
 * 监听 AI 待插入文本
 * 当用户在 AI 面板点击"应用建议"时触发
 * 将 AI 生成的文本插入到编辑器中
 */
watch(() => aiStore.pendingInsert, (text) => {
  if (text && editorRef.value?.editor) {
    // 在光标位置插入 AI 建议的文本
    editorRef.value.editor.chain().focus().insertContent(text).run();
    // 清除待插入状态
    aiStore.setPendingInsert(null);
  }
});

/**
 * 组件挂载时执行
 * 初始化页面：获取文档、连接 Socket
 */
onMounted(async () => {
  // 获取文档数据
  await documentStore.fetchDocument(documentId);
  if (documentStore.currentDocument) {
    // 设置标题
    title.value = documentStore.currentDocument.title;
    // 加入文档房间（用于实时协作）
    joinDocument(documentId, 'User');
  } else {
    // 文档不存在，返回首页
    router.push('/');
  }
});

/**
 * 组件卸载前执行
 * 离开文档房间，断开 Socket 连接
 */
onBeforeUnmount(() => {
  leaveDocument(documentId);
});

/**
 * 监听标题变化
 * 使用防抖保存，避免频繁请求后端
 */
watch(title, (newTitle) => {
  // 如果标题确实变化了
  if (newTitle !== documentStore.currentDocument?.title) {
    debouncedSaveTitle(newTitle);
  }
});

/**
 * 防抖保存标题
 * 延迟 500ms 后保存，避免每次按键都发送请求
 * @param newTitle - 新的标题
 */
function debouncedSaveTitle(newTitle: string) {
  // 清除之前的定时器
  if (titleSaveTimeout.value) {
    clearTimeout(titleSaveTimeout.value);
  }
  // 设置新的定时器
  titleSaveTimeout.value = window.setTimeout(async () => {
    await documentStore.updateDocument(documentId, { title: newTitle });
  }, 500);
}

/**
 * 处理编辑器内容变化
 * 1. 更新本地状态
 * 2. 通过 Socket 广播给其他用户
 * 3. 防抖保存到数据库
 * @param content - 新的文档内容
 */
function handleContentUpdate(content: string) {
  // 更新本地状态
  if (documentStore.currentDocument) {
    documentStore.currentDocument.content = content;
  }

  // 通过 Socket 广播给其他用户（实时协作）
  const version = documentStore.documentVersion;
  emitContentUpdate(documentId, content, version);

  // 防抖保存到数据库
  if (contentSaveTimeout.value) {
    clearTimeout(contentSaveTimeout.value);
  }
  contentSaveTimeout.value = window.setTimeout(async () => {
    await documentStore.updateDocument(documentId, { content });
  }, 1000);
}

/**
 * 处理文本选择变化
 * 当用户在编辑器中选中文本时，通知 AI store
 * @param selection - 选中的文本
 */
function handleSelectionChange(selection: string) {
  aiStore.setSelectedText(selection);
}

/**
 * 返回首页
 */
function goHome() {
  router.push('/');
}

// 计算属性：协作者数量
const collaboratorCount = documentStore.collaborators.length;
</script>

<template>
  <!-- 页面容器：flex 布局，占满整个屏幕 -->
  <div class="min-h-screen flex flex-col">

    <!-- 页面头部 -->
    <header class="h-14 bg-surface-dark/50 border-b border-white/5 flex items-center px-4 gap-4">
      <!-- 返回按钮 -->
      <button
        @click="goHome"
        class="p-2 hover:bg-white/10 rounded-lg transition-colors"
      >
        <svg class="w-5 h-5 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
        </svg>
      </button>

      <!-- 标题输入框 -->
      <div class="flex-1">
        <input
          v-model="title"
          type="text"
          placeholder="未命名文档"
          class="w-full bg-transparent border-none outline-none text-lg font-semibold text-text-primary placeholder-text-muted"
        />
      </div>

      <!-- 状态指示器 -->
      <div class="flex items-center gap-3">
        <!-- 同步状态 -->
        <div
          v-if="documentStore.isSyncing"
          class="flex items-center gap-1.5 text-xs text-text-muted"
        >
          <svg class="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          同步中
        </div>

        <!-- 协作者头像 -->
        <div v-if="collaboratorCount > 0" class="flex items-center gap-1 text-xs text-text-muted">
          <div class="flex -space-x-1">
            <div
              v-for="i in Math.min(collaboratorCount, 3)"
              :key="i"
              class="w-6 h-6 rounded-full bg-accent/80 border-2 border-surface-dark flex items-center justify-center text-white text-xs"
            >
              {{ String.fromCharCode(64 + i) }}
            </div>
          </div>
          <span>{{ collaboratorCount }}</span>
        </div>

        <!-- Socket 连接状态 -->
        <div
          :class="[
            'w-2 h-2 rounded-full',
            documentStore.socketStatus === 'connected' ? 'bg-success' :
            documentStore.socketStatus === 'connecting' ? 'bg-warning animate-pulse' :
            'bg-text-muted'
          ]"
        ></div>

        <!-- AI 按钮 -->
        <button
          @click="aiStore.togglePanel()"
          :class="[
            'px-3 py-1.5 rounded-lg text-sm font-medium transition-all flex items-center gap-1.5',
            aiStore.isPanelOpen
              ? 'bg-accent text-white'
              : 'bg-white/10 hover:bg-accent/20 text-text-primary'
          ]"
        >
          <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z"/>
          </svg>
          AI
        </button>
      </div>
    </header>

    <!-- 主内容区 -->
    <main class="flex-1 flex">
      <!-- 编辑器区域 -->
      <div class="flex-1 overflow-y-auto">
        <div class="max-w-editor mx-auto px-8 py-12">
          <!-- TipTap 编辑器组件 -->
          <TipTapEditor
            ref="editorRef"
            :document-id="documentId"
            :initial-content="documentStore.documentContent"
            @update:content="handleContentUpdate"
            @selection-change="handleSelectionChange"
          />
        </div>
      </div>
    </main>

    <!-- AI 面板（Teleport 到 body） -->
    <AiPanel :document-id="documentId" />
  </div>
</template>
