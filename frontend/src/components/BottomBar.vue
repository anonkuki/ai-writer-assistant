<script setup lang="ts">
import { ref, computed } from 'vue';
import { useAiStore } from '@/stores/ai';
import { useDocumentStore } from '@/stores/document';

const props = defineProps<{
  documentId: string;
}>();

const aiStore = useAiStore();
const documentStore = useDocumentStore();

const emit = defineEmits<{
  (e: 'command', command: string): void;
}>();

// 快捷操作
const quickActions = [
  { id: 'continue', label: '续写', icon: 'M13 10V3L4 14h7v7l9-11h-7z', color: 'hover:text-blue-400' },
  { id: 'improve', label: '改进', icon: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z', color: 'hover:text-green-400' },
  { id: 'fix', label: '纠错', icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z', color: 'hover:text-yellow-400' },
  { id: 'summarize', label: '总结', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2', color: 'hover:text-purple-400' },
  { id: 'translate', label: '翻译', icon: 'M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129', color: 'hover:text-pink-400' },
  { id: 'expand', label: '扩写', icon: 'M4 6h16M4 12h16M4 18h7', color: 'hover:text-orange-400' },
];

const isExpanded = ref(false);

// 执行 AI 命令
async function executeCommand(command: string) {
  if (!props.documentId) return;

  const content = documentStore.currentDocument?.content || '';

  emit('command', command);

  // 调用 AI 服务
  try {
    await aiStore.getSuggestion(props.documentId, content, command as any);
  } catch (error) {
    console.error('AI command failed:', error);
  }
}
</script>

<template>
  <footer class="h-10 bg-surface-dark border-t border-gray-800 flex items-center justify-between px-4">
    <!-- 左侧: 状态信息 -->
    <div class="flex items-center gap-4 text-xs text-gray-500">
      <span v-if="documentStore.currentDocument">
        v{{ documentStore.currentDocument.version }}
      </span>
      <span class="flex items-center gap-1">
        <span
          class="w-1.5 h-1.5 rounded-full"
          :class="aiStore.isLoading ? 'bg-yellow-500 animate-pulse' : 'bg-green-500'"
        ></span>
        {{ aiStore.isLoading ? 'AI 工作中...' : 'AI 就绪' }}
      </span>
    </div>

    <!-- 右侧: AI 快捷操作 -->
    <div class="flex items-center gap-1">
      <!-- 收起时显示图标 -->
      <template v-if="!isExpanded">
        <button
          v-for="action in quickActions.slice(0, 4)"
          :key="action.id"
          @click="executeCommand(action.id)"
          :disabled="aiStore.isLoading"
          class="p-1.5 rounded hover:bg-surface-light text-gray-400 transition-colors disabled:opacity-50"
          :class="action.color"
          :title="action.label"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" :d="action.icon" />
          </svg>
        </button>
      </template>

      <!-- 展开时显示完整按钮 -->
      <div v-if="isExpanded" class="flex items-center gap-1">
        <button
          v-for="action in quickActions"
          :key="action.id"
          @click="executeCommand(action.id)"
          :disabled="aiStore.isLoading"
          class="px-2 py-1 text-xs rounded hover:bg-surface-light text-gray-400 transition-colors disabled:opacity-50 flex items-center gap-1"
          :class="action.color"
        >
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" :d="action.icon" />
          </svg>
          {{ action.label }}
        </button>
      </div>

      <!-- 展开/收起按钮 -->
      <button
        @click="isExpanded = !isExpanded"
        class="p-1.5 rounded hover:bg-surface-light text-gray-400 transition-colors ml-2"
        :title="isExpanded ? '收起' : '展开'"
      >
        <svg class="w-4 h-4 transition-transform" :class="isExpanded ? 'rotate-180' : ''" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7" />
        </svg>
      </button>
    </div>
  </footer>
</template>
