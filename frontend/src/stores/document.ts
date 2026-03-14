/**
 * 文档状态管理
 * ============================================
 * 本文件使用 Pinia 管理文档相关的全局状态，类似于公司的数据中心
 *
 * 什么是状态管理？
 * - 状态就是应用中的数据，比如文档列表、当前文档、用户信息等
 * - 状态管理让我们可以在任意组件中访问和修改这些数据
 * - 类似于公司的数据库，集中存储所有重要信息
 *
 * Pinia 核心概念：
 * - State（状态）: 存储数据的地方，类似于 Vue 的 data
 * - Getters（计算属性）: 从 state 派生的数据，类似于 Vue 的 computed
 * - Actions（动作）: 修改 state 的方法，类似于 Vue 的 methods
 *
 * defineStore() 语法：
 * - Pinia 推荐的写法，使用函数形式定义 store
 * - 第一个参数是 store 的名称（'document'）
 * - 第二个参数是一个函数，返回 store 的内容
 */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import axios from 'axios';

const API_URL = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');
// 注意：axios 全局配置 (baseURL + 拦截器) 已在 main.ts 中统一注册

/**
 * 文档类型接口
 * 定义文档的数据结构，便于 TypeScript 类型检查
 */
export interface Document {
  id: string;           // 文档唯一标识（UUID）
  title: string;        // 文档标题
  content: string;      // 文档内容（JSON 字符串）
  ownerId: string;      // 文档所有者 ID
  version: number;      // 文档版本号
  createdAt: string;    // 创建时间
  updatedAt: string;    // 最后更新时间
}

/**
 * 房间用户类型接口
 * 用于实时协作时显示在线用户
 */
export interface RoomUser {
  userId: string;      // 用户 ID
  documentId: string;  // 文档 ID
  userName: string;  // 用户名称
}

/**
 * 创建文档 Store
 * 使用 defineStore 函数，名称为 'document'
 */
export const useDocumentStore = defineStore('document', () => {
  // ====== State（状态） ======
  // 类似于 Vue 组件中的 data，用于存储数据

  /**
   * 当前正在编辑的文档
   * 当用户打开一个文档时，这个值会被设置为该文档
   */
  const currentDocument = ref<Document | null>(null);

  /**
   * 文档列表
   * 存储所有文档的摘要信息，用于首页显示
   */
  const documents = ref<Document[]>([]);

  /**
   * 是否正在加载
   * 用于显示加载动画
   */
  const isLoading = ref(false);

  /**
   * 是否正在同步
   * 用于显示同步状态（如保存文档时）
   */
  const isSyncing = ref(false);

  /**
   * WebSocket 连接状态
   * 'disconnected': 未连接
   * 'connecting': 正在连接
   * 'connected': 已连接
   */
  const socketStatus = ref<'disconnected' | 'connecting' | 'connected'>('disconnected');

  /**
   * 当前文档的协作者列表
   * 存储正在同时编辑这个文档的用户
   */
  const collaborators = ref<RoomUser[]>([]);

  /**
   * 错误信息
   * 当操作失败时，存储错误消息
   */
  const error = ref<string | null>(null);

  // ====== Getters（计算属性） ======
  // 类似于 Vue 的 computed，从 state 派生新数据

  /**
   * 是否有当前文档
   */
  const hasDocument = computed(() => currentDocument.value !== null);

  /**
   * 获取当前文档标题（带默认值）
   */
  const documentTitle = computed(() => currentDocument.value?.title || 'Untitled');

  /**
   * 获取当前文档内容（带默认值）
   */
  const documentContent = computed(() => currentDocument.value?.content || '{}');

  /**
   * 获取当前文档版本号（带默认值）
   */
  const documentVersion = computed(() => currentDocument.value?.version || 1);

  // ====== Actions（动作） ======
  // 类似于 Vue 的 methods，用于修改 state

  /**
   * 获取所有文档列表
   * 调用后端 API GET /documents
   */
  async function fetchDocuments() {
    isLoading.value = true;
    error.value = null;
    try {
      const response = await axios.get('/documents');
      documents.value = response.data.data;
    } catch (err: any) {
      error.value = err.message || 'Failed to fetch documents';
      console.error('Error fetching documents:', err);
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * 获取单个文档
   * 调用后端 API GET /documents/:id
   * @param id - 文档 ID
   */
  async function fetchDocument(id: string) {
    isLoading.value = true;
    error.value = null;
    try {
      const response = await axios.get(`/documents/${id}`);
      currentDocument.value = response.data.data;
    } catch (err: any) {
      error.value = err.message || 'Failed to fetch document';
      console.error('Error fetching document:', err);
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * 创建新文档
   * 调用后端 API POST /documents
   * @param title - 文档标题（可选）
   * @returns 新创建的文档对象
   */
  async function createDocument(title?: string) {
    isLoading.value = true;
    error.value = null;
    try {
      const response = await axios.post('/documents', { title });
      const newDoc = response.data.data;
      // 将新文档添加到列表最前面
      documents.value.unshift(newDoc);
      return newDoc;
    } catch (err: any) {
      error.value = err.message || 'Failed to create document';
      console.error('Error creating document:', err);
      return null;
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * 更新文档
   * 调用后端 API PUT /documents/:id
   * @param id - 文档 ID
   * @param data - 要更新的数据（title 和/或 content）
   * @returns 更新后的文档对象
   */
  async function updateDocument(id: string, data: { title?: string; content?: string }) {
    isSyncing.value = true;
    error.value = null;
    try {
      const response = await axios.put(`/documents/${id}`, data);
      currentDocument.value = response.data.data;

      // 同时更新文档列表中的数据
      const index = documents.value.findIndex((d) => d.id === id);
      if (index !== -1) {
        documents.value[index] = response.data.data;
      }

      return response.data.data;
    } catch (err: any) {
      error.value = err.message || 'Failed to update document';
      console.error('Error updating document:', err);
      return null;
    } finally {
      isSyncing.value = false;
    }
  }

  /**
   * 删除文档
   * 调用后端 API DELETE /documents/:id
   * @param id - 文档 ID
   */
  async function deleteDocument(id: string) {
    isLoading.value = true;
    error.value = null;
    try {
      await axios.delete(`/documents/${id}`);
      // 从列表中移除
      documents.value = documents.value.filter((d) => d.id !== id);
      // 如果删除的是当前文档，清空当前文档
      if (currentDocument.value?.id === id) {
        currentDocument.value = null;
      }
    } catch (err: any) {
      error.value = err.message || 'Failed to delete document';
      console.error('Error deleting document:', err);
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * 设置当前文档（手动设置）
   * @param doc - 文档对象或 null
   */
  function setCurrentDocument(doc: Document | null) {
    currentDocument.value = doc;
  }

  /**
   * 设置 Socket 连接状态
   * @param status - 连接状态
   */
  function setSocketStatus(status: 'disconnected' | 'connecting' | 'connected') {
    socketStatus.value = status;
  }

  /**
   * 设置协作者列表
   * @param users - 用户数组
   */
  function setCollaborators(users: RoomUser[]) {
    collaborators.value = users;
  }

  /**
   * 添加协作者
   * @param user - 用户信息
   */
  function addCollaborator(user: RoomUser) {
    if (!collaborators.value.find((u) => u.userId === user.userId)) {
      collaborators.value.push(user);
    }
  }

  /**
   * 移除协作者
   * @param userId - 用户 ID
   */
  function removeCollaborator(userId: string) {
    collaborators.value = collaborators.value.filter((u) => u.userId !== userId);
  }

  /**
   * 从远程更新内容（用于实时协作）
   * 当收到其他用户的更新时调用
   * @param content - 新的文档内容
   * @param version - 新的版本号
   */
  function updateContentFromRemote(content: string, version: number) {
    if (currentDocument.value) {
      currentDocument.value.content = content;
      currentDocument.value.version = version;
    }
  }

  /**
   * 返回 store 的所有内容
   * 这样组件就可以使用这些状态和方法了
   */
  return {
    // State
    currentDocument,
    documents,
    isLoading,
    isSyncing,
    socketStatus,
    collaborators,
    error,
    // Getters
    hasDocument,
    documentTitle,
    documentContent,
    documentVersion,
    // Actions
    fetchDocuments,
    fetchDocument,
    createDocument,
    updateDocument,
    deleteDocument,
    setCurrentDocument,
    setSocketStatus,
    setCollaborators,
    addCollaborator,
    removeCollaborator,
    updateContentFromRemote,
  };
});
