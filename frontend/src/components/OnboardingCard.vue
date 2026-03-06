<script setup lang="ts">
defineProps<{
  title: string;
  content: string;
  stepIndex: number;
  totalSteps: number;
  position: { top: number; left: number };
  arrowTop: number;
  arrowLeft: number;
  arrowDirection: 'top' | 'bottom' | 'left' | 'right';
  highlightRect: { top: number; left: number; width: number; height: number };
}>();

const emit = defineEmits<{
  (e: 'next'): void;
  (e: 'prev'): void;
  (e: 'skip'): void;
}>();
</script>

<template>
  <Teleport to="body">
    <!-- 遮罩层（高亮区域挖空） -->
    <div class="fixed inset-0 z-[10000] pointer-events-none" style="animation: guideFadeIn 0.3s ease">
      <svg class="absolute inset-0 w-full h-full">
        <defs>
          <mask id="guide-mask">
            <rect width="100%" height="100%" fill="white" />
            <rect
              :x="highlightRect.left - 6"
              :y="highlightRect.top - 6"
              :width="highlightRect.width + 12"
              :height="highlightRect.height + 12"
              rx="10"
              fill="black"
            />
          </mask>
        </defs>
        <rect
          width="100%"
          height="100%"
          fill="rgba(15,23,42,0.5)"
          mask="url(#guide-mask)"
        />
      </svg>
    </div>

    <!-- 高亮呼吸光圈 -->
    <div
      class="fixed z-[10001] rounded-xl pointer-events-none transition-all duration-500 ease-out"
      :style="{
        top: highlightRect.top - 6 + 'px',
        left: highlightRect.left - 6 + 'px',
        width: highlightRect.width + 12 + 'px',
        height: highlightRect.height + 12 + 'px',
        boxShadow: '0 0 0 3px rgba(79,124,255,0.5), 0 0 20px rgba(79,124,255,0.15)',
      }"
    ></div>

    <!-- 卡片 -->
    <div
      class="fixed z-[10002] w-[340px] rounded-2xl overflow-hidden transition-all duration-500 ease-out"
      :style="{
        top: position.top + 'px',
        left: position.left + 'px',
        boxShadow: '0 25px 50px -12px rgba(0,0,0,0.15), 0 0 0 1px rgba(79,124,255,0.1)',
        animation: 'guideCardIn 0.4s cubic-bezier(0.16,1,0.3,1)',
      }"
    >
      <!-- 顶部装饰渐变条 -->
      <div class="h-1 bg-gradient-to-r from-brand via-indigo-500 to-purple-500"></div>

      <div class="bg-white p-5">
        <!-- 步骤指示 & 跳过 -->
        <div class="flex items-center justify-between mb-4">
          <div class="flex items-center gap-1.5">
            <span v-for="i in totalSteps" :key="i"
              class="w-1.5 h-1.5 rounded-full transition-all duration-300"
              :class="i - 1 <= stepIndex ? 'bg-brand w-4' : 'bg-gray-200'"
            ></span>
          </div>
          <button
            @click="emit('skip')"
            class="text-[11px] text-text-muted hover:text-text-secondary transition-colors flex items-center gap-1"
          >
            跳过
            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>

        <!-- 标题 -->
        <h3 class="text-[15px] font-bold text-text-primary mb-2 leading-snug">{{ title }}</h3>

        <!-- 内容 -->
        <p class="text-[13px] text-text-secondary leading-relaxed mb-5">{{ content }}</p>

        <!-- 底部操作 -->
        <div class="flex items-center justify-between">
          <button
            v-if="stepIndex > 0"
            @click="emit('prev')"
            class="flex items-center gap-1 px-3 py-2 text-[12px] text-text-muted hover:text-text-primary rounded-lg hover:bg-surface-secondary transition-all"
          >
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5"/></svg>
            上一步
          </button>
          <div v-else></div>

          <button
            @click="emit('next')"
            class="flex items-center gap-1.5 px-5 py-2 text-[12px] font-semibold text-white rounded-lg transition-all hover:shadow-lg active:scale-[0.97]"
            :style="{ background: 'linear-gradient(135deg, #4F7CFF 0%, #6366F1 100%)' }"
          >
            {{ stepIndex === totalSteps - 1 ? '开始使用 🎉' : '下一步' }}
            <svg v-if="stepIndex < totalSteps - 1" class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5"/></svg>
          </button>
        </div>

        <!-- 步骤数字 -->
        <div class="mt-3 text-center">
          <span class="text-[10px] text-text-muted">{{ stepIndex + 1 }} / {{ totalSteps }}</span>
        </div>
      </div>

      <!-- 箭头指示器 -->
      <div
        class="absolute w-3 h-3 bg-white transform rotate-45"
        :style="{
          top: arrowTop + 'px',
          left: arrowLeft + 'px',
          boxShadow: arrowDirection === 'top' ? '-1px -1px 2px rgba(0,0,0,0.06)' :
                     arrowDirection === 'bottom' ? '1px 1px 2px rgba(0,0,0,0.06)' :
                     arrowDirection === 'left' ? '-1px 1px 2px rgba(0,0,0,0.06)' :
                     '1px -1px 2px rgba(0,0,0,0.06)',
        }"
      ></div>
    </div>

    <!-- 隐形可点击遮罩阻止与引导区外交互 -->
    <div class="fixed inset-0 z-[10001]" @click.stop></div>
  </Teleport>
</template>

<style scoped>
@keyframes guideFadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes guideCardIn {
  from {
    opacity: 0;
    transform: translateY(8px) scale(0.96);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}
</style>
