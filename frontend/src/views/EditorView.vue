<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue';
import { useRoute } from 'vue-router';
import TipTapEditor from '@/components/TipTapEditor.vue';
import TopBar from '@/components/TopBar.vue';
import BottomBar from '@/components/BottomBar.vue';
import AiPanel from '@/components/AiPanel.vue';
import { useDocumentStore } from '@/stores/document';
import { useAiStore } from '@/stores/ai';
import { useSocket } from '@/composables/useSocket';

const route = useRoute();
const documentStore = useDocumentStore();
const aiStore = useAiStore();
const { joinDocument, leaveDocument, emitContentUpdate } = useSocket();

const documentId = route.params.id as string;
const showAiPanel = ref(false);

// 加载文档
onMounted(async () => {
  if (documentId) {
    await documentStore.fetchDocument(documentId);
    joinDocument(documentId, 'User');
  }
});

onBeforeUnmount(() => {
  if (documentId) {
    leaveDocument(documentId);
  }
});

// 切换 AI 面板
function toggleAiPanel() {
  showAiPanel.value = !showAiPanel.value;
}

// 处理 AI 命令
function handleAiCommand(command: string) {
  // 命令处理逻辑已在 BottomBar 中实现
  showAiPanel.value = true;
}

// 处理内容更新
function handleContentUpdate(content: string) {
  if (documentStore.currentDocument) {
    documentStore.currentDocument.content = content;

    // 通过 Socket 广播
    const version = documentStore.currentDocument.version;
    emitContentUpdate(documentId, content, version);

    // 防抖保存
    documentStore.updateDocument(documentId, { content });
  }
}

// 监听键盘快捷键
function handleKeyDown(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
    event.preventDefault();
    toggleAiPanel();
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeyDown);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeyDown);
});
</script>

<template>
  <div class="h-screen flex flex-col bg-surface">
    <!-- 顶部导航 -->
    <TopBar :show-ai-panel="showAiPanel" @toggle-ai="toggleAiPanel" />

    <!-- 主内容区 -->
    <div class="flex-1 flex min-h-0">
      <!-- 编辑器区域 -->
      <main class="flex-1 flex flex-col min-w-0">
        <div class="flex-1 overflow-auto">
          <TipTapEditor
            v-if="documentStore.currentDocument"
            :document-id="documentId"
            :initial-content="documentStore.currentDocument.content"
            @update:content="handleContentUpdate"
            @selection-change="(text: string) => aiStore.setSelectedText(text)"
          />

        <!-- 空状态 -->
        <div v-else class="h-full flex items-center justify-center">
          <div class="text-center text-gray-500">
            <svg class="w-16 h-16 mx-auto mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p class="text-lg mb-2">加载文档中...</p>
          </div>
        </div>
        </div>

        <!-- 底部工具栏 -->
        <BottomBar :document-id="documentId" @command="handleAiCommand" />
      </main>

      <!-- AI 面板 (右侧浮动) -->
      <transition
        enter-active-class="transition-transform duration-300 ease-out"
        enter-from-class="translate-x-full"
        enter-to-class="translate-x-0"
        leave-active-class="transition-transform duration-300 ease-in"
        leave-from-class="translate-x-0"
        leave-to-class="translate-x-full"
      >
        <aside
          v-if="showAiPanel"
          class="w-80 border-l border-gray-800 bg-surface-dark flex flex-col"
        >
          <AiPanel :document-id="documentId" @close="showAiPanel = false" />
        </aside>
      </transition>
    </div>
  </div>
</template>
