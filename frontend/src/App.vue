<script setup lang="ts">
import Sidebar from '@/components/Sidebar.vue';
import EditorView from '@/views/EditorView.vue';
</script>

<template>
  <div class="h-screen flex bg-surface">
    <!-- 左侧边栏 -->
    <Sidebar />

    <!-- 主内容区 -->
    <div class="flex-1 flex flex-col min-w-0">
      <EditorView />
    </div>
  </div>
</template>
