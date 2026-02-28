<script setup lang="ts">
import { computed } from 'vue';
import { useDocumentStore } from '@/stores/document';
import { useAiStore } from '@/stores/ai';

const props = defineProps<{
  showAiPanel: boolean;
}>();

const emit = defineEmits<{
  (e: 'toggle-ai'): void;
}>();

const documentStore = useDocumentStore();
const aiStore = useAiStore();

const currentDoc = computed(() => documentStore.currentDocument);
const aiStatus = computed(() => aiStore.isLoading ? 'thinking' : 'ready');
const socketStatus = computed(() => documentStore.socketStatus);
</script>

<template>
  <header class="h-12 bg-surface-dark border-b border-gray-800 flex items-center justify-between px-4">
    <!-- 左侧: 项目名称 + 文档标题 -->
    <div class="flex items-center gap-4 min-w-0">
      <div class="flex items-center gap-2">
        <svg class="w-5 h-5 text-accent" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
        </svg>
        <span class="font-semibold text-gray-200">AI Writer</span>
      </div>

      <div v-if="currentDoc" class="flex items-center gap-2 min-w-0">
        <span class="text-gray-600">/</span>
        <input
          :value="currentDoc.title"
          @input="(e: Event) => {
            const target = e.target as HTMLInputElement;
            documentStore.updateDocument(currentDoc!.id, { title: target.value });
          }"
          class="bg-transparent border-none outline-none text-gray-300 placeholder-gray-600 min-w-0 truncate"
          placeholder="Untitled"
        />
      </div>
    </div>

    <!-- 右侧: AI 状态 + 快捷操作 -->
    <div class="flex items-center gap-3">
      <!-- 快捷键提示 -->
      <div class="hidden md:flex items-center gap-1 text-xs text-gray-500">
        <kbd class="px-1.5 py-0.5 bg-surface-light rounded border border-gray-700">⌘</kbd>
        <kbd class="px-1.5 py-0.5 bg-surface-light rounded border border-gray-700">K</kbd>
        <span>AI 助手</span>
      </div>

      <!-- AI 状态指示 -->
      <div class="flex items-center gap-2">
        <div class="flex items-center gap-1.5">
          <span
            class="w-2 h-2 rounded-full"
            :class="{
              'bg-green-500': socketStatus === 'connected',
              'bg-yellow-500': socketStatus === 'connecting',
              'bg-red-500': socketStatus === 'disconnected'
            }"
          ></span>
          <span class="text-xs text-gray-500">
            {{ socketStatus === 'connected' ? '已连接' : socketStatus === 'connecting' ? '连接中...' : '离线' }}
          </span>
        </div>
      </div>

      <!-- AI 按钮 -->
      <button
        @click="emit('toggle-ai')"
        class="flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors"
        :class="showAiPanel ? 'bg-accent text-white' : 'bg-surface-light text-gray-300 hover:bg-surface-hover'"
      >
        <svg class="w-4 h-4" :class="aiStore.isLoading ? 'animate-spin' : ''" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
        <span class="text-sm">{{ showAiPanel ? '关闭 AI' : 'AI 助手' }}</span>
      </button>
    </div>
  </header>
</template>
