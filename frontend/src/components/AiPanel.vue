<script setup lang="ts">
import { ref } from 'vue';
import { useAiStore } from '@/stores/ai';
import { useDocumentStore } from '@/stores/document';

const props = defineProps<{
  documentId: string;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const aiStore = useAiStore();
const documentStore = useDocumentStore();

const question = ref('');
const activeCommand = ref<string | null>(null);

async function askAi() {
  if (!question.value.trim()) return;

  await aiStore.askQuestion(
    props.documentId,
    question.value,
    aiStore.selectedText
  );
  question.value = '';
}

async function runCommand(command: string) {
  activeCommand.value = command;
  await aiStore.getSuggestion(
    props.documentId,
    aiStore.selectedText,
    command
  );
  activeCommand.value = null;
}

function applySuggestion(text: string) {
  aiStore.setPendingInsert(text);
  aiStore.clearResponse();
}

function handleKeyDown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    emit('close');
  }
}
</script>

<template>
  <div class="h-full flex flex-col" @keydown="handleKeyDown">
    <!-- 面板头部 -->
    <div class="flex items-center justify-between p-4 border-b border-gray-800">
      <div class="flex items-center gap-2">
        <div class="w-8 h-8 bg-gradient-to-br from-accent to-purple-500 rounded-lg flex items-center justify-center">
          <svg class="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 20 20">
            <path d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z"/>
          </svg>
        </div>
        <span class="font-semibold text-gray-200">AI 助手</span>
      </div>
      <button
        @click="emit('close')"
        class="p-1.5 hover:bg-surface-light rounded-lg transition-colors"
      >
        <svg class="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>

    <!-- 快捷操作 -->
    <div class="p-4 border-b border-gray-800">
      <p class="text-xs text-gray-500 mb-3 uppercase tracking-wider">快捷操作</p>
      <div class="grid grid-cols-2 gap-2">
        <button
          @click="runCommand('continue')"
          :disabled="aiStore.isLoading"
          class="px-3 py-2 bg-surface-light hover:bg-accent/20 border border-gray-700 hover:border-accent/30 rounded-lg text-sm text-gray-300 transition-all text-left flex items-center gap-2 disabled:opacity-50"
        >
          <svg class="w-4 h-4 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 5l7 7-7 7M5 5l7 7-7 7" />
          </svg>
          续写
        </button>
        <button
          @click="runCommand('improve')"
          :disabled="aiStore.isLoading"
          class="px-3 py-2 bg-surface-light hover:bg-accent/20 border border-gray-700 hover:border-accent/30 rounded-lg text-sm text-gray-300 transition-all text-left flex items-center gap-2 disabled:opacity-50"
        >
          <svg class="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          改进
        </button>
        <button
          @click="runCommand('fix')"
          :disabled="aiStore.isLoading"
          class="px-3 py-2 bg-surface-light hover:bg-accent/20 border border-gray-700 hover:border-accent/30 rounded-lg text-sm text-gray-300 transition-all text-left flex items-center gap-2 disabled:opacity-50"
        >
          <svg class="w-4 h-4 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          纠错
        </button>
        <button
          @click="runCommand('summarize')"
          :disabled="aiStore.isLoading"
          class="px-3 py-2 bg-surface-light hover:bg-accent/20 border border-gray-700 hover:border-accent/30 rounded-lg text-sm text-gray-300 transition-all text-left flex items-center gap-2 disabled:opacity-50"
        >
          <svg class="w-4 h-4 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          总结
        </button>
      </div>
    </div>

    <!-- 选中文本显示 -->
    <div v-if="aiStore.selectedText" class="p-4 border-b border-gray-800">
      <p class="text-xs text-gray-500 mb-2 uppercase tracking-wider">选中文本</p>
      <p class="text-sm text-gray-400 bg-surface-light p-2 rounded-lg line-clamp-3">
        "{{ aiStore.selectedText }}"
      </p>
    </div>

    <!-- 问答输入 -->
    <div class="p-4 border-b border-gray-800">
      <div class="relative">
        <textarea
          v-model="question"
          @keydown.enter.exact.prevent="askAi"
          placeholder="向 AI 提问..."
          rows="2"
          class="w-full bg-surface-light border border-gray-700 rounded-lg px-3 py-2 pr-10 text-sm text-gray-300 placeholder-gray-600 resize-none focus:outline-none focus:border-accent/50"
        ></textarea>
        <button
          @click="askAi"
          :disabled="!question.trim() || aiStore.isLoading"
          class="absolute right-2 bottom-2 p-1.5 bg-accent hover:bg-accent/80 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <svg v-if="!aiStore.isLoading" class="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
          </svg>
          <svg v-else class="w-4 h-4 text-white animate-spin" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
        </button>
      </div>
    </div>

    <!-- AI 响应显示 -->
    <div class="flex-1 overflow-y-auto p-4">
      <div v-if="aiStore.isLoading" class="flex items-center justify-center py-8">
        <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-accent"></div>
      </div>

      <div v-else-if="aiStore.lastResponse">
        <div v-if="aiStore.lastResponse.answer" class="mb-4">
          <p class="text-xs text-gray-500 mb-2 uppercase tracking-wider">回复</p>
          <div class="bg-surface-light rounded-lg p-3 text-sm text-gray-300 leading-relaxed">
            {{ aiStore.lastResponse.answer }}
          </div>
        </div>

        <div v-if="aiStore.lastResponse.suggestion" class="mb-4">
          <p class="text-xs text-gray-500 mb-2 uppercase tracking-wider">建议</p>
          <div class="bg-gradient-to-r from-accent/10 to-purple-500/10 rounded-lg p-3 border border-accent/20">
            <p class="text-sm text-gray-300 leading-relaxed">
              {{ aiStore.lastResponse.suggestion }}
            </p>
            <button
              @click="applySuggestion(aiStore.lastResponse.suggestion!)"
              class="mt-3 px-3 py-1.5 bg-accent hover:bg-accent/80 text-white text-xs rounded-lg transition-colors"
            >
              应用建议
            </button>
          </div>
        </div>

        <div v-if="aiStore.lastResponse.suggestions?.length" class="space-y-2">
          <p class="text-xs text-gray-500 uppercase tracking-wider">建议列表</p>
          <button
            v-for="(suggestion, index) in aiStore.lastResponse.suggestions"
            :key="index"
            @click="applySuggestion(suggestion)"
            class="w-full text-left p-2 bg-surface-light hover:bg-accent/20 rounded-lg text-sm text-gray-400 hover:text-gray-300 transition-colors"
          >
            {{ suggestion }}
          </button>
        </div>
      </div>

      <div v-else class="text-center py-8 text-gray-500 text-sm">
        <p>选中文本或使用快捷操作</p>
        <p class="mt-1">获取 AI 辅助</p>
        <p class="mt-2 text-xs">按 ⌘K 快速唤起</p>
      </div>
    </div>
  </div>
</template>
