/**
 * AI 状态管理
 * ============================================
 * 本文件管理 AI 助手相关的所有状态，类似于 AI 部门的办公室
 *
 * 核心功能：
 * 1. 管理 AI 对话状态 - 问题、回答、建议
 * 2. 管理 AI 面板显示状态 - 打开/关闭
 * 3. 管理选中文本 - 用户选中的文本用于发送给 AI
 * 4. 管理待插入文本 - AI 建议插入到文档的文本
 *
 * 为什么需要 pendingInsert（待插入）？
 * - 用户点击"应用建议"时，需要将 AI 生成的文本插入到编辑器
 * - 但是 AiPanel 组件不知道编辑器在哪里
 * - 所以我们把文本放在 store 里，然后让 DocumentView 监听并插入
 * - 这是一种跨组件通信的技巧
 */

import { defineStore } from 'pinia';
import { ref } from 'vue';
import axios from 'axios';

const API_URL = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');
// 注意：axios 全局配置 (baseURL + 拦截器) 已在 main.ts 中统一注册

/**
 * AI 响应类型接口
 * 定义 AI 返回数据的结构
 */
export interface AiResponse {
  answer?: string;        // AI 的回答
  suggestion?: string;    // 建议内容（单个）
  suggestions?: string[]; // 建议列表（多个）
  command?: string;       // 命令类型
}

/**
 * 创建 AI Store
 * 名称为 'ai'
 */
export const useAiStore = defineStore('ai', () => {
  // ====== State（状态） ======

  /**
   * 是否正在等待 AI 响应
   * 用于显示加载动画
   */
  const isLoading = ref(false);

  /**
   * 错误信息
   */
  const error = ref<string | null>(null);

  /**
   * 最后一次 AI 响应
   * 用于在界面上显示 AI 的回答或建议
   */
  const lastResponse = ref<AiResponse | null>(null);

  /**
   * AI 面板是否打开
   * 控制右侧 AI 面板的显示/隐藏
   */
  const isPanelOpen = ref(false);

  /**
   * 用户选中的文本
   * 用户在编辑器中选中的文字，会发送给 AI 作为上下文
   */
  const selectedText = ref('');

  /**
   * 待插入的 AI 建议文本
   * 当用户点击"应用建议"时，文本会暂存到这里
   * 然后由 DocumentView 监听并插入到编辑器中
   */
  const pendingInsert = ref<string | null>(null);

  // ====== Actions（动作） ======

  /**
   * 向 AI 提问
   * 调用后端 API POST /ai/ask
   * @param documentId - 文档 ID
   * @param question - 问题内容
   * @param selectedText - 选中的文本（可选）
   */
  async function askQuestion(documentId: string, question: string, selectedText?: string) {
    isLoading.value = true;
    error.value = null;
    try {
      const response = await axios.post('/ai/ask', {
        documentId,
        question,
        selectedText,
      });
      lastResponse.value = response.data.data;
      return response.data.data;
    } catch (err: any) {
      error.value = err.message || 'Failed to get AI response';
      console.error('Error asking AI:', err);
      return null;
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * 获取 AI 建议
   * 调用后端 API POST /ai/suggest
   * @param documentId - 文档 ID
   * @param content - 文档内容或选中文本
   * @param command - 命令类型（continue/improve/fix/summarize）
   */
  async function getSuggestion(documentId: string, content: string, command?: string) {
    isLoading.value = true;
    error.value = null;
    try {
      const response = await axios.post('/ai/suggest', {
        documentId,
        content,
        command,
      });
      lastResponse.value = response.data.data;
      return response.data.data;
    } catch (err: any) {
      error.value = err.message || 'Failed to get AI suggestion';
      console.error('Error getting suggestion:', err);
      return null;
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * 设置选中的文本
   * 当用户在编辑器中选中文本时调用
   * @param text - 选中的文本
   */
  function setSelectedText(text: string) {
    selectedText.value = text;
  }

  /**
   * 打开 AI 面板
   */
  function openPanel() {
    isPanelOpen.value = true;
  }

  /**
   * 关闭 AI 面板
   */
  function closePanel() {
    isPanelOpen.value = false;
  }

  /**
   * 切换 AI 面板状态
   */
  function togglePanel() {
    isPanelOpen.value = !isPanelOpen.value;
  }

  /**
   * 清除 AI 响应
   * 关闭面板或应用建议后调用
   */
  function clearResponse() {
    lastResponse.value = null;
  }

  /**
   * 设置待插入的文本
   * 当用户点击"应用建议"时调用
   * @param text - 要插入的文本
   */
  function setPendingInsert(text: string | null) {
    pendingInsert.value = text;
  }

  /**
   * 消费待插入的文本
   * 取出文本后清空，用于一次性消费
   * @returns 待插入的文本
   */
  function consumePendingInsert() {
    const text = pendingInsert.value;
    pendingInsert.value = null;
    return text;
  }

  // ==================== 写作辅助方法 ====================

  /**
   * 写作辅助 - 生成内容
   */
  async function write(
    bookId: string,
    content: string,
    command: string,
    chapterId?: string,
    options?: any,
  ) {
    isLoading.value = true;
    error.value = null;
    try {
      const response = await axios.post('/ai/write', {
        bookId,
        chapterId,
        content,
        command,
        options,
      });
      lastResponse.value = response.data.data;
      return response.data.data;
    } catch (err: any) {
      error.value = err.response?.data?.message || 'AI 写作辅助失败';
      console.error('Error writing:', err);
      return null;
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * 文本编辑
   */
  async function editText(bookId: string, text: string, action: string, style?: string) {
    isLoading.value = true;
    error.value = null;
    try {
      const response = await axios.post('/ai/edit', {
        bookId,
        text,
        action,
        style,
      });
      lastResponse.value = response.data.data;
      return response.data.data;
    } catch (err: any) {
      error.value = err.response?.data?.message || 'AI 文本编辑失败';
      console.error('Error editing text:', err);
      return null;
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * 生成大纲
   */
  async function generateOutline(
    bookId: string,
    title: string,
    genre?: string,
    chapterCount?: number,
    existingOutline?: string,
  ) {
    isLoading.value = true;
    error.value = null;
    try {
      const response = await axios.post('/ai/outline', {
        bookId,
        title,
        genre,
        chapterCount,
        existingOutline,
      });
      lastResponse.value = response.data.data;
      return response.data.data;
    } catch (err: any) {
      error.value = err.response?.data?.message || 'AI 大纲生成失败';
      console.error('Error generating outline:', err);
      return null;
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * 生成角色
   */
  async function generateCharacter(
    bookId: string,
    name?: string,
    role?: string,
    description?: string,
  ) {
    isLoading.value = true;
    error.value = null;
    try {
      const response = await axios.post('/ai/character', {
        bookId,
        name,
        role,
        description,
      });
      lastResponse.value = response.data.data;
      return response.data.data;
    } catch (err: any) {
      error.value = err.response?.data?.message || 'AI 角色生成失败';
      console.error('Error generating character:', err);
      return null;
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * 返回 store 的所有内容
   */
  return {
    // State
    isLoading,
    error,
    lastResponse,
    isPanelOpen,
    selectedText,
    pendingInsert,
    // Actions
    askQuestion,
    getSuggestion,
    setSelectedText,
    openPanel,
    closePanel,
    togglePanel,
    clearResponse,
    setPendingInsert,
    consumePendingInsert,
    // Writing assistant
    write,
    editText,
    generateOutline,
    generateCharacter,
  };
});
