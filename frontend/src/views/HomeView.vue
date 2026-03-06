<script setup lang="ts">
import { computed, onMounted, ref, nextTick } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useBookStore, type Book } from '@/stores/book';
import { apiPost } from '@/lib/api';
import { useOnboarding, type GuideStep } from '@/composables/useOnboarding';
import OnboardingCard from '@/components/OnboardingCard.vue';

const homeGuideSteps: GuideStep[] = [
  {
    target: '[data-guide="welcome-banner"]',
    title: '欢迎来到智文写作助手 🎉',
    content: '这里是您的专属写作工作台。智文集成了 AI 写作、角色管理、世界观设定等全套创作工具，帮助您高效写出精彩作品。',
    placement: 'bottom',
  },
  {
    target: '[data-guide="stats-cards"]',
    title: '写作数据总览',
    content: '这里实时显示您的写作进度：作品总数、今日字数和连续创作天数。持续写作，保持连续打卡吧！',
    placement: 'bottom',
  },
  {
    target: '[data-guide="new-book-btn"]',
    title: '创建新作品',
    content: '点击“新建作品”开始您的第一部作品。可以设置标题、简介和封面，随时开始您的创作之旅。',
    placement: 'bottom',
  },
  {
    target: '[data-guide="book-grid"]',
    title: '作品书架',
    content: '您的所有作品都会展示在这里。点击任意一部作品即可进入编辑器，开始写作和编辑。',
    placement: 'top',
  },
];

const {
  isActive: showHomeGuide,
  currentStep: homeStep,
  currentStepIndex: homeStepIndex,
  totalSteps: homeTotalSteps,
  position: homePos,
  highlightRect: homeHighlight,
  start: startHomeGuide,
  next: nextHomeGuide,
  prev: prevHomeGuide,
  skip: skipHomeGuide,
} = useOnboarding('onboarding_home_done', homeGuideSteps);

const router = useRouter();
const authStore = useAuthStore();
const bookStore = useBookStore();

const user = computed(() => authStore.user);

const showNewBookModal = ref(false);
const newBookTitle = ref('');
const newBookDescription = ref('');
const newBookCover = ref('');
const isCreating = ref(false);
const createError = ref('');
const uploadingCover = ref(false);

onMounted(async () => {
  try {
    await Promise.all([
      bookStore.fetchBooks(),
      bookStore.fetchStats(),
      bookStore.fetchWritingStats(),
    ]);
  } catch (err) {
    console.error('加载数据失败:', err);
  }
  // 首次访问时启动引导
  nextTick(() => { setTimeout(startHomeGuide, 600); });
});

async function createNewBook() {
  if (!newBookTitle.value.trim()) return;
  createError.value = '';
  isCreating.value = true;
  try {
    const book = await bookStore.createBook({
      title: newBookTitle.value.trim(),
      description: newBookDescription.value.trim() || undefined,
      cover: newBookCover.value.trim() || undefined,
    });
    showNewBookModal.value = false;
    resetModal();
    router.push(`/editor/${book.id}`);
  } catch (err: any) {
    createError.value = err?.response?.data?.message?.[0] || err?.message || '创建失败';
  } finally {
    isCreating.value = false;
  }
}

function resetModal() {
  newBookTitle.value = '';
  newBookDescription.value = '';
  newBookCover.value = '';
  createError.value = '';
}

function openBook(book: Book) {
  router.push(`/editor/${book.id}`);
}

async function deleteBook(book: Book, event: Event) {
  event.stopPropagation();
  if (!confirm(`确定删除《${book.title}》吗？此操作无法撤销。`)) return;
  try {
    await bookStore.deleteBook(book.id);
    await Promise.all([bookStore.fetchStats(), bookStore.fetchWritingStats()]);
  } catch (err: any) {
    alert(`删除失败: ${err.message || '网络错误，请稍后重试'}`);
  }
}

async function handleCoverFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  uploadingCover.value = true;
  createError.value = '';
  try {
    const formData = new FormData();
    formData.append('file', file);
    const result = await apiPost<{ coverUrl: string }>('/upload', formData);
    newBookCover.value = result.coverUrl;
  } catch (err: any) {
    createError.value = err?.response?.data?.message?.[0] || err?.message || '封面上传失败';
  } finally {
    uploadingCover.value = false;
    input.value = '';
  }
}

function getStatusLabel(status: string) {
  return { DRAFT: '草稿', SERIAL: '连载中', FINISHED: '已完结' }[status] || status;
}

function formatWordCount(count?: number | null) {
  if (!count) return '0';
  if (count >= 10000) return `${(count / 10000).toFixed(1)}万`;
  return String(count);
}
</script>

<template>
  <div class="flex-1 flex flex-col min-h-0 overflow-hidden relative bg-surface-secondary">

    <!-- 顶部区域：欢迎 + 统计 -->
    <div class="bg-white border-b border-border">
      <div class="max-w-content mx-auto px-6 py-6">
        <div class="flex items-center justify-between">
          <!-- 欢迎横幅 -->
          <div class="flex-1 relative">
            <div data-guide="welcome-banner" class="bg-gradient-to-r from-brand-50 via-blue-50 to-white rounded-2xl p-6 relative overflow-hidden shadow-sm border border-brand/10">
              <div class="relative z-10 flex items-center gap-5">
                <div class="w-16 h-16 rounded-2xl bg-brand border-2 border-white shadow-md flex items-center justify-center p-3 shrink-0 ring-1 ring-brand/10">
                  <img src="/logo.png" alt="智文写作助手" class="w-full h-full object-contain filter brightness-0 invert" />
                </div>
                <div>
                  <h1 class="text-2xl font-bold text-text-primary tracking-tight">与世界分享你的故事</h1>
                  <p class="text-brand-600/80 text-sm mt-1.5 font-medium flex items-center gap-2">
                    <span class="w-1.5 h-1.5 rounded-full bg-brand"></span>
                    欢迎使用智文写作助手，让灵感即刻成文
                  </p>
                </div>
              </div>
              
              <!-- 装饰背景 Logo -->
              <div class="absolute right-0 top-1/2 -translate-y-1/2 opacity-[0.03] pointer-events-none transform translate-x-1/4 scale-150">
                <img src="/logo.png" alt="" class="w-64 h-64 object-contain filter grayscale" />
              </div>
            </div>
          </div>

          <!-- 统计卡片 -->
          <div v-if="bookStore.stats && bookStore.writingStats" data-guide="stats-cards" class="ml-8 flex gap-4 shrink-0">
            <div class="bg-surface-secondary rounded-xl px-5 py-4 text-center min-w-[100px]">
              <div class="text-2xl font-bold text-brand">{{ bookStore.stats.totalBooks }}</div>
              <div class="text-xs text-text-muted mt-1">作品总数</div>
            </div>
            <div class="bg-surface-secondary rounded-xl px-5 py-4 text-center min-w-[100px]">
              <div class="text-2xl font-bold text-success">{{ formatWordCount(bookStore.writingStats.todayWordCount) }}</div>
              <div class="text-xs text-text-muted mt-1">今日字数</div>
            </div>
            <div class="bg-surface-secondary rounded-xl px-5 py-4 text-center min-w-[100px]">
              <div class="text-2xl font-bold text-ai-primary">{{ bookStore.writingStats.streakDays }}</div>
              <div class="text-xs text-text-muted mt-1">连续天数</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 操作栏 -->
    <div class="bg-white border-b border-border">
      <div class="max-w-content mx-auto px-6 py-3 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <button data-guide="new-book-btn" @click="showNewBookModal = true" class="btn-primary flex items-center gap-2">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/>
            </svg>
            新建作品
          </button>
        </div>

        <div class="flex items-center gap-3 text-sm text-text-muted">
          <span class="text-text-primary font-medium">全部</span>
          <span>|</span>
          <span class="cursor-pointer hover:text-text-primary">管理</span>
        </div>
      </div>
    </div>

    <!-- 书籍网格 -->
    <div class="flex-1 overflow-auto">
      <div class="max-w-content mx-auto px-6 py-6">
        <div v-if="bookStore.isLoading" class="py-16 text-center text-text-muted">
          <svg class="w-8 h-8 mx-auto mb-3 animate-spin text-brand" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
          </svg>
          加载中...
        </div>

        <div v-else-if="bookStore.books.length > 0" data-guide="book-grid" class="grid gap-5 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          <div
            v-for="book in bookStore.books"
            :key="book.id"
            @click="openBook(book)"
            class="group cursor-pointer animate-fade-in"
          >
            <!-- 封面 -->
            <div class="aspect-[3/4] rounded-lg overflow-hidden relative shadow-card group-hover:shadow-card-hover transition-shadow duration-200">
              <img v-if="book.cover" :src="book.cover" :alt="book.title" class="w-full h-full object-cover" />
              <div v-else class="w-full h-full bg-gradient-to-br from-brand-50 to-blue-100 flex items-center justify-center">
                <span class="text-brand/40 text-3xl font-serif">{{ book.title.charAt(0) }}</span>
              </div>

              <!-- 状态标签 -->
              <span class="absolute top-2 left-2 px-2 py-0.5 text-xs rounded font-medium text-white"
                :class="{
                  'bg-gray-400': book.status === 'DRAFT',
                  'bg-green-500': book.status === 'SERIAL',
                  'bg-indigo-500': book.status === 'FINISHED',
                }">
                {{ getStatusLabel(book.status) }}
              </span>

              <!-- 删除按钮 -->
              <button
                @click="deleteBook(book, $event)"
                class="absolute top-2 right-2 w-6 h-6 flex items-center justify-center bg-black/40 hover:bg-danger text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity text-xs"
              >✕</button>
            </div>

            <!-- 信息 -->
            <div class="mt-2.5 px-0.5">
              <div class="flex items-center gap-1.5">
                <h3 class="text-sm font-medium text-text-primary truncate flex-1">{{ book.title }}</h3>
              </div>
              <div class="flex items-center gap-2 mt-1 text-xs text-text-muted">
                <span v-if="book.wordCount">{{ formatWordCount(book.wordCount) }}字</span>
                <span v-if="book._count?.chapters">{{ book._count.chapters }}章</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 空状态 -->
        <div v-else class="text-center py-20">
          <div class="w-20 h-20 mx-auto mb-4 bg-surface-secondary rounded-full flex items-center justify-center">
            <svg class="w-10 h-10 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/>
            </svg>
          </div>
          <h2 class="text-lg font-semibold text-text-primary mb-2">暂无作品</h2>
          <p class="text-sm text-text-secondary mb-6">点击"新建草稿"开始你的第一部作品</p>
          <button @click="showNewBookModal = true" class="btn-primary">创建作品</button>
        </div>
      </div>
    </div>

    <!-- 新建作品弹窗 -->
    <div v-if="showNewBookModal" class="modal-overlay" @click.self="showNewBookModal = false; resetModal();">
      <div class="modal-content w-full max-w-md">
        <h3 class="text-lg font-semibold text-text-primary mb-5">新建作品</h3>

        <div class="space-y-4">
          <div>
            <label class="form-label">作品标题 <span class="text-danger">*</span></label>
            <input v-model="newBookTitle" type="text" class="form-input" placeholder="请输入作品标题" @keyup.enter="createNewBook" />
          </div>

          <div>
            <label class="form-label">作品简介</label>
            <textarea v-model="newBookDescription" rows="3" class="form-textarea" placeholder="简介（可选）" />
          </div>

          <div>
            <label class="form-label">封面图片</label>
            <input v-model="newBookCover" type="text" class="form-input mb-2" placeholder="封面 URL（可选）" />
            <label class="inline-flex items-center gap-2 px-3 py-1.5 bg-surface-secondary rounded-lg text-xs text-text-secondary cursor-pointer hover:bg-surface-hover">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"/>
              </svg>
              上传封面
              <input type="file" accept="image/*" @change="handleCoverFile" class="hidden" />
            </label>
            <span v-if="uploadingCover" class="text-xs text-text-muted ml-2">上传中...</span>
          </div>

          <div v-if="createError" class="text-sm text-danger bg-red-50 px-3 py-2 rounded-lg">{{ createError }}</div>
        </div>

        <div class="flex justify-end gap-3 mt-6">
          <button @click="showNewBookModal = false; resetModal();" class="btn-secondary">取消</button>
          <button @click="createNewBook" :disabled="!newBookTitle.trim() || isCreating || uploadingCover" class="btn-primary disabled:opacity-50">
            {{ isCreating ? '创建中...' : '创建' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 新手引导卡片 -->
    <OnboardingCard
      v-if="showHomeGuide && homeStep"
      :title="homeStep.title"
      :content="homeStep.content"
      :step-index="homeStepIndex"
      :total-steps="homeTotalSteps"
      :position="homePos"
      :arrow-top="homePos.arrowTop"
      :arrow-left="homePos.arrowLeft"
      :arrow-direction="homePos.arrowDirection"
      :highlight-rect="homeHighlight"
      @next="nextHomeGuide"
      @prev="prevHomeGuide"
      @skip="skipHomeGuide"
    />
  </div>
</template>
