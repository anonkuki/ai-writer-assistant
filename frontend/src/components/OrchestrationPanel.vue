<script setup lang="ts">
import { computed } from 'vue';
import { useAgentStore, type OrchestrationStep } from '@/stores/agent';
import { marked } from 'marked';

marked.setOptions({ breaks: true, gfm: true });

function renderMarkdown(text: string): string {
  if (!text) return '';
  return marked.parse(text) as string;
}

const agentStore = useAgentStore();
const emit = defineEmits<{
  (e: 'confirm'): void;
  (e: 'cancel'): void;
  (e: 'refreshChapters'): void;
}>();

const orch = computed(() => agentStore.orchestration);
const steps = computed(() => orch.value.steps);
const phase = computed(() => orch.value.phase);
const isAwaitingApproval = computed(() => phase.value === 'awaiting_approval');

const progressPercent = computed(() => {
  if (!steps.value.length) return 0;
  const done = steps.value.filter(s => s.status === 'done' || s.status === 'failed').length;
  return Math.round((done / steps.value.length) * 100);
});

function getStepIcon(step: OrchestrationStep): string {
  switch (step.status) {
    case 'done': return '✅';
    case 'failed': return '❌';
    case 'running': return '🔄';
    default: return '⏳';
  }
}

function getStepTypeIcon(type: string): string {
  const icons: Record<string, string> = {
    read: '📖',
    update_world: '🌍',
    update_character: '👤',
    update_plotline: '📖',
    update_foreshadowing: '🔮',
    create_outline: '📋',
    write_chapter: '✏️',
    consistency_check: '🔍',
  };
  return icons[type] || '⚙️';
}

function getStepStatusClass(step: OrchestrationStep): string {
  switch (step.status) {
    case 'done': return 'border-green-400/40 bg-green-50/30';
    case 'failed': return 'border-red-400/40 bg-red-50/30';
    case 'running': return 'border-blue-400/60 bg-blue-50/40 ring-1 ring-blue-300/30';
    default: return 'border-border/30 bg-surface/30 opacity-60';
  }
}
</script>

<template>
  <div v-if="steps.length > 0" class="orchestration-panel mx-3 mb-3">
    <!-- 进度条 -->
    <div class="flex items-center gap-2 mb-2">
      <div class="flex-1 h-1.5 bg-border/20 rounded-full overflow-hidden">
        <div
          class="h-full bg-gradient-to-r from-brand to-ai-primary rounded-full transition-all duration-500"
          :style="{ width: `${progressPercent}%` }"
        />
      </div>
      <span class="text-[10px] text-text-muted font-mono">{{ progressPercent }}%</span>
    </div>

    <!-- 步骤列表 -->
    <div class="space-y-1.5">
      <div
        v-for="(step, i) in steps"
        :key="step.id"
        class="rounded-lg border px-3 py-2 transition-all duration-300"
        :class="getStepStatusClass(step)"
      >
        <!-- 步骤头部 -->
        <div class="flex items-center gap-2">
          <span class="text-sm">{{ getStepIcon(step) }}</span>
          <span class="text-[10px] text-text-muted">{{ getStepTypeIcon(step.type) }}</span>
          <span class="text-xs font-medium text-text-primary flex-1">
            {{ i + 1 }}. {{ step.title }}
          </span>
          <span v-if="step.wordCount" class="text-[10px] text-text-muted">
            {{ step.wordCount }}字
          </span>
        </div>

        <!-- 步骤描述 -->
        <p class="text-[11px] text-text-muted mt-0.5 pl-6">{{ step.description }}</p>

        <!-- 思考过程（运行中展开） -->
        <div
          v-if="step.status === 'running' && step.thinking"
          class="mt-2 pl-6"
        >
          <div class="text-[10px] text-blue-500 font-medium mb-1 flex items-center gap-1">
            <svg class="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
            思考中...
          </div>
          <div
            class="text-[11px] text-text-secondary leading-relaxed max-h-40 overflow-y-auto rounded bg-white/60 p-2 border border-border/20 prose prose-xs"
            v-html="renderMarkdown(step.thinking)"
          />
        </div>

        <!-- 结果（完成后展示） -->
        <div
          v-if="step.status === 'done' && step.result"
          class="mt-2 pl-6"
        >
          <details class="group">
            <summary class="text-[10px] text-green-600 cursor-pointer hover:text-green-700 font-medium select-none">
              查看结果 ▸
            </summary>
            <div
              class="mt-1 text-[11px] text-text-secondary leading-relaxed max-h-48 overflow-y-auto rounded bg-white/60 p-2 border border-border/20 prose prose-xs"
              v-html="renderMarkdown(step.result)"
            />
          </details>
        </div>

        <!-- 失败信息 -->
        <div
          v-if="step.status === 'failed'"
          class="mt-1 pl-6 text-[10px] text-red-500"
        >
          执行失败，已跳过
        </div>
      </div>
    </div>

    <!-- 确认/取消按钮（等待用户批准时显示） -->
    <div v-if="isAwaitingApproval" class="mt-3 flex items-center gap-2 justify-end">
      <button
        @click="emit('cancel')"
        class="px-3 py-1.5 text-xs text-text-muted border border-border rounded-lg hover:bg-surface-hover transition-colors"
      >
        取消
      </button>
      <button
        @click="emit('confirm')"
        class="px-4 py-1.5 text-xs text-white bg-gradient-to-r from-brand to-brand-dark hover:from-brand-dark hover:to-brand rounded-lg shadow-sm hover:shadow-md transition-all active:scale-95"
      >
        ✅ 确认执行
      </button>
    </div>

    <!-- 状态指示 -->
    <div v-if="phase === 'completed' || phase === 'done'" class="mt-2 text-center">
      <span class="text-[11px] text-green-600 font-medium">✅ 所有步骤执行完成</span>
    </div>
    <div v-else-if="phase === 'error'" class="mt-2 text-center">
      <span class="text-[11px] text-red-500">执行过程中出现错误</span>
    </div>
  </div>
</template>

<style scoped>
.orchestration-panel .prose {
  color: #6b7280;
  font-size: 11px;
  line-height: 1.5;
}
.orchestration-panel .prose p {
  margin: 0.25em 0;
}
.orchestration-panel .prose ul,
.orchestration-panel .prose ol {
  margin: 0.25em 0;
  padding-left: 1.2em;
}
.orchestration-panel .prose li {
  margin: 0.1em 0;
}
</style>
