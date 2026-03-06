<script setup lang="ts">
import { ref, onMounted, nextTick } from 'vue';
import { useAgentStore } from '@/stores/agent';

const agentStore = useAgentStore();

const emit = defineEmits<{
  (e: 'toggleHistory'): void;
  (e: 'popout'): void;
  (e: 'close'): void;
  (e: 'newSession'): void;
}>();

const showNotifDot = ref(true);
const showModelDropdown = ref(false);
const modelBtnRef = ref<HTMLElement | null>(null);
const dropdownPos = ref({ top: 0, left: 0 });

onMounted(() => {
  agentStore.fetchAvailableModels();
});

function selectModel(modelId: string) {
  agentStore.setModel(modelId);
  showModelDropdown.value = false;
}

function toggleModelDropdown() {
  showModelDropdown.value = !showModelDropdown.value;
  if (showModelDropdown.value) {
    nextTick(() => {
      if (modelBtnRef.value) {
        const rect = modelBtnRef.value.getBoundingClientRect();
        dropdownPos.value = {
          top: rect.bottom + 4,
          left: rect.left,
        };
      }
    });
  }
}

function getSpeedIcon(speed: string) {
  if (speed === 'fast') return '⚡';
  if (speed === 'normal') return '🔷';
  return '🔶';
}
</script>

<template>
  <div class="ai-panel-header flex items-center justify-between px-3 py-2 border-b border-border/80 bg-gradient-to-r from-white via-white to-blue-50/30">
    <div class="flex items-center gap-2 min-w-0">
      <!-- 品牌标识 + 模型选择 -->
      <div class="relative flex items-center gap-1.5">
        <div class="w-6 h-6 rounded-lg bg-gradient-to-br from-blue-500 via-indigo-500 to-purple-600 flex items-center justify-center shadow-sm ring-1 ring-white/20">
          <svg class="w-3.5 h-3.5 text-white" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 2L1 12h3v9h6v-6h4v6h6v-9h3L12 2z"/>
          </svg>
        </div>
        <!-- 可点击的模型名称 -->
        <button
          ref="modelBtnRef"
          @click="toggleModelDropdown"
          class="flex flex-col leading-none text-left hover:bg-surface-hover rounded px-1 py-0.5 transition-colors"
          title="点击切换模型"
        >
          <span class="text-[11px] font-bold text-text-primary tracking-tight">{{ agentStore.currentModelLabel }}</span>
          <span class="text-[9px] text-ai-primary font-medium flex items-center gap-0.5">
            切换模型
            <svg class="w-2.5 h-2.5 transition-transform" :class="{ 'rotate-180': showModelDropdown }" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/>
            </svg>
          </span>
        </button>
        <span v-if="showNotifDot" class="relative flex h-2 w-2 ml-0.5">
          <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
          <span class="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
        </span>

        <!-- 模型选择下拉菜单 -->
        <Teleport to="body">
          <div
            v-if="showModelDropdown"
            class="fixed inset-0 z-[9998]"
            @click="showModelDropdown = false"
          ></div>
          <div
            v-if="showModelDropdown"
            class="fixed z-[9999] w-64 bg-white rounded-lg shadow-lg border border-border/60 py-1"
            :style="{ top: dropdownPos.top + 'px', left: dropdownPos.left + 'px' }"
          >
            <div class="px-3 py-1.5 text-[10px] text-text-muted font-medium uppercase tracking-wider">选择模型</div>
            <button
              v-for="model in agentStore.availableModels"
              :key="model.id"
              @click="selectModel(model.id)"
              class="w-full flex items-start gap-2 px-3 py-2 text-left hover:bg-surface-hover transition-colors"
              :class="{ 'bg-brand-50/50': model.id === agentStore.effectiveModelId }"
            >
              <span class="text-sm mt-0.5">{{ getSpeedIcon(model.speed) }}</span>
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-1.5">
                  <span class="text-[12px] font-semibold text-text-primary">{{ model.label }}</span>
                  <span
                    v-if="model.id === agentStore.effectiveModelId"
                    class="text-[9px] px-1 py-0.5 rounded bg-brand/10 text-brand font-medium"
                  >当前</span>
                </div>
                <p class="text-[10px] text-text-muted mt-0.5">{{ model.description }}</p>
              </div>
            </button>
          </div>
        </Teleport>
      </div>
    </div>

    <div class="flex items-center gap-0.5">
      <!-- 剩余次数 -->
      <div class="flex items-center gap-1 mr-1.5 px-2 py-0.5 rounded-full bg-brand-50/80 border border-brand/10">
        <span class="text-[9px] text-text-muted">剩</span>
        <span class="text-[10px] text-brand font-bold tabular-nums">{{ agentStore.remainingQuota }}</span>
        <span class="text-[9px] text-text-muted">次</span>
      </div>

      <!-- 新建对话 -->
      <button
        @click="emit('newSession')"
        class="w-7 h-7 flex items-center justify-center rounded-md text-text-muted hover:bg-surface-hover hover:text-text-primary transition-colors"
        title="新建对话"
      >
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/>
        </svg>
      </button>

      <!-- 历史记录 -->
      <button
        @click="emit('toggleHistory')"
        class="w-7 h-7 flex items-center justify-center rounded-md text-text-muted hover:bg-surface-hover hover:text-text-primary transition-colors"
        title="历史对话"
      >
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"/>
        </svg>
      </button>

      <!-- 弹出窗口 -->
      <button
        @click="emit('popout')"
        class="w-7 h-7 flex items-center justify-center rounded-md text-text-muted hover:bg-surface-hover hover:text-text-primary transition-colors"
        title="弹出窗口"
      >
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"/>
        </svg>
      </button>

      <!-- 关闭 -->
      <button
        @click="emit('close')"
        class="w-7 h-7 flex items-center justify-center rounded-md text-text-muted hover:bg-surface-hover hover:text-red-400 transition-colors"
        title="关闭"
      >
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
        </svg>
      </button>
    </div>
  </div>
</template>
