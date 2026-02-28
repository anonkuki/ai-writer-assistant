<script setup lang="ts">
import { ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { useDocumentStore } from '@/stores/document';

const router = useRouter();
const documentStore = useDocumentStore();

const isCollapsed = ref(false);

// 获取文档列表
const documents = computed(() => documentStore.documents);

// 创建新文档
async function createNewDocument() {
  const doc = await documentStore.createDocument('Untitled');
  router.push(`/editor/${doc.id}`);
}

// 选择文档
function selectDocument(id: string) {
  router.push(`/editor/${id}`);
}

// 删除文档
async function deleteDoc(id: string, event: Event) {
  event.stopPropagation();
  if (confirm('确定要删除这个文档吗？')) {
    await documentStore.deleteDocument(id);
  }
}
</script>

<template>
  <aside
    class="h-full bg-surface-dark border-r border-gray-800 flex flex-col transition-all duration-300"
    :class="isCollapsed ? 'w-14' : 'w-64'"
  >
    <!-- 折叠按钮 -->
    <button
      @click="isCollapsed = !isCollapsed"
      class="p-3 hover:bg-surface-light transition-colors flex items-center justify-center"
    >
      <svg class="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path v-if="isCollapsed" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 5l7 7-7 7M5 5l7 7-7 7" />
        <path v-else stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
      </svg>
    </button>

    <!-- 新建文档按钮 -->
    <button
      @click="createNewDocument"
      class="mx-2 mb-3 px-3 py-2 bg-accent hover:bg-accent/80 text-white rounded-lg flex items-center gap-2 transition-colors"
      :class="isCollapsed ? 'justify-center' : ''"
    >
      <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
      </svg>
      <span v-if="!isCollapsed">新建文档</span>
    </button>

    <!-- 文档列表 -->
    <nav class="flex-1 overflow-y-auto">
      <div v-if="!isCollapsed" class="px-3 py-1 text-xs text-gray-500 uppercase tracking-wider">
        文档
      </div>

      <ul class="space-y-1 px-2">
        <li v-for="doc in documents" :key="doc.id">
          <button
            @click="selectDocument(doc.id)"
            class="w-full px-3 py-2 text-left rounded-lg hover:bg-surface-light group flex items-center gap-2 transition-colors"
            :class="[
              isCollapsed ? 'justify-center' : '',
              $route.params.id === doc.id ? 'bg-surface-light text-accent' : 'text-gray-300'
            ]"
          >
            <svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span v-if="!isCollapsed" class="truncate flex-1">{{ doc.title }}</span>
            <button
              v-if="!isCollapsed"
              @click="deleteDoc(doc.id, $event)"
              class="opacity-0 group-hover:opacity-100 p-1 hover:text-accent transition-opacity"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </button>
        </li>
      </ul>

      <!-- 空状态 -->
      <div v-if="documents.length === 0 && !isCollapsed" class="px-3 py-8 text-center text-gray-500">
        <svg class="w-12 h-12 mx-auto mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <p class="text-sm">暂无文档</p>
        <button @click="createNewDocument" class="text-accent hover:underline text-sm mt-2">
          创建第一个文档
        </button>
      </div>
    </nav>

    <!-- 用户信息 -->
    <div v-if="!isCollapsed" class="p-3 border-t border-gray-800">
      <div class="flex items-center gap-2">
        <div class="w-8 h-8 rounded-full bg-accent flex items-center justify-center text-white text-sm font-medium">
          U
        </div>
        <div class="flex-1">
          <p class="text-sm min-w-0 text-gray-300 truncate">用户</p>
          <p class="text-xs text-gray-500 truncate">在线</p>
        </div>
      </div>
    </div>
  </aside>
</template>
