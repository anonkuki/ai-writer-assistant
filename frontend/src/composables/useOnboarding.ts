import { ref, reactive, computed, nextTick, onUnmounted } from 'vue';

export interface GuideStep {
  /** 目标元素选择器，如 '[data-guide="new-book"]' */
  target: string;
  /** 标题 */
  title: string;
  /** 描述内容 */
  content: string;
  /** 卡片相对于目标元素的位置 */
  placement: 'top' | 'bottom' | 'left' | 'right';
}

interface CardPosition {
  top: number;
  left: number;
  arrowTop: number;
  arrowLeft: number;
  arrowDirection: 'top' | 'bottom' | 'left' | 'right';
}

const CARD_WIDTH = 320;
const CARD_HEIGHT_ESTIMATE = 180;
const ARROW_OFFSET = 12;
const GAP = 12;

function calcPosition(rect: DOMRect, placement: GuideStep['placement']): CardPosition {
  const pos: CardPosition = { top: 0, left: 0, arrowTop: 0, arrowLeft: 0, arrowDirection: placement };

  switch (placement) {
    case 'bottom':
      pos.top = rect.bottom + GAP;
      pos.left = rect.left + rect.width / 2 - CARD_WIDTH / 2;
      pos.arrowTop = -ARROW_OFFSET;
      pos.arrowLeft = CARD_WIDTH / 2 - 6;
      pos.arrowDirection = 'top';
      break;
    case 'top':
      pos.top = rect.top - CARD_HEIGHT_ESTIMATE - GAP;
      pos.left = rect.left + rect.width / 2 - CARD_WIDTH / 2;
      pos.arrowTop = CARD_HEIGHT_ESTIMATE - 2;
      pos.arrowLeft = CARD_WIDTH / 2 - 6;
      pos.arrowDirection = 'bottom';
      break;
    case 'right':
      pos.top = rect.top + rect.height / 2 - CARD_HEIGHT_ESTIMATE / 2;
      pos.left = rect.right + GAP;
      pos.arrowTop = CARD_HEIGHT_ESTIMATE / 2 - 6;
      pos.arrowLeft = -ARROW_OFFSET;
      pos.arrowDirection = 'left';
      break;
    case 'left':
      pos.top = rect.top + rect.height / 2 - CARD_HEIGHT_ESTIMATE / 2;
      pos.left = rect.left - CARD_WIDTH - GAP;
      pos.arrowTop = CARD_HEIGHT_ESTIMATE / 2 - 6;
      pos.arrowLeft = CARD_WIDTH - 2;
      pos.arrowDirection = 'right';
      break;
  }

  // 边界安全
  pos.left = Math.max(8, Math.min(pos.left, window.innerWidth - CARD_WIDTH - 8));
  pos.top = Math.max(8, pos.top);

  return pos;
}

/**
 * 通用引导系统 composable
 * @param storageKey localStorage 中标记完成的 key
 * @param steps 引导步骤列表
 */
export function useOnboarding(storageKey: string, steps: GuideStep[]) {
  const currentStepIndex = ref(-1);
  const isActive = ref(false);
  const position = reactive<CardPosition>({ top: 0, left: 0, arrowTop: 0, arrowLeft: 0, arrowDirection: 'top' });
  const highlightRect = reactive({ top: 0, left: 0, width: 0, height: 0 });

  const currentStep = computed(() => steps[currentStepIndex.value] || null);
  const totalSteps = steps.length;
  const hasCompleted = localStorage.getItem(storageKey) === '1';

  function updatePosition() {
    const step = currentStep.value;
    if (!step) return;
    const el = document.querySelector(step.target);
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const p = calcPosition(rect, step.placement);
    Object.assign(position, p);
    Object.assign(highlightRect, { top: rect.top, left: rect.left, width: rect.width, height: rect.height });
  }

  let resizeHandler: (() => void) | null = null;

  function start() {
    if (hasCompleted || steps.length === 0) return;
    isActive.value = true;
    currentStepIndex.value = 0;
    nextTick(updatePosition);
    resizeHandler = updatePosition;
    window.addEventListener('resize', resizeHandler);
  }

  function next() {
    if (currentStepIndex.value < totalSteps - 1) {
      currentStepIndex.value++;
      nextTick(updatePosition);
    } else {
      finish();
    }
  }

  function prev() {
    if (currentStepIndex.value > 0) {
      currentStepIndex.value--;
      nextTick(updatePosition);
    }
  }

  function finish() {
    isActive.value = false;
    currentStepIndex.value = -1;
    localStorage.setItem(storageKey, '1');
    if (resizeHandler) {
      window.removeEventListener('resize', resizeHandler);
      resizeHandler = null;
    }
  }

  function skip() {
    finish();
  }

  onUnmounted(() => {
    if (resizeHandler) {
      window.removeEventListener('resize', resizeHandler);
    }
  });

  return {
    isActive,
    currentStepIndex,
    currentStep,
    totalSteps,
    position,
    highlightRect,
    start,
    next,
    prev,
    skip,
    finish,
    updatePosition,
  };
}
