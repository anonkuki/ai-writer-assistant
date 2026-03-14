/**
 * Socket.io Composable（组合式函数）
 * ============================================
 * 本文件封装了 WebSocket 连接的所有逻辑，类似于对讲机的操作手册
 *
 * 什么是 Composables（组合式函数）？
 * - Vue 3 引入的一种代码复用方式
 * - 使用 Vue 的 Composition API
 * - 将相关的逻辑封装成可复用的函数
 * - 类似于 Vue 2 的 mixins，但更清晰、更易理解
 *
 * WebSocket/Socket.IO 作用：
 * - 实现实时通信，多人同时编辑同一文档
 * - 当一个用户编辑时，其他用户实时看到变化
 * - 类似于 Google Docs 的协作编辑功能
 *
 * Socket.IO 事件说明：
 * - connect: 连接成功
 * - disconnect: 断开连接
 * - join: 加入文档房间
 * - leave: 离开文档房间
 * - user-joined: 有人加入房间
 * - user-left: 有人离开房间
 * - content-updated: 文档内容更新
 * - cursor-update: 光标位置更新
 */

import { ref, onUnmounted } from 'vue';
import { io, Socket } from 'socket.io-client';
import { useDocumentStore } from '@/stores/document';
import { useAuthStore } from '@/stores/auth';

/**
 * 全局 Socket 实例
 * 使用单例模式，整个应用只有一个 Socket 连接
 * 类似于公司只有一部总机电话
 */
let socket: Socket | null = null;

/**
 * 远程内容更新回调
 * 允许外部组件（如编辑器）注册回调处理远程内容更新
 */
type ContentUpdateCallback = (data: { content: string; version: number; userId: string; userName: string }) => void;
let onContentUpdateCallback: ContentUpdateCallback | null = null;

/**
 * 使用 Socket 的组合式函数
 * 在组件中调用 useSocket() 即可使用所有 Socket 功能
 */
export function useSocket() {
  // 获取文档 store，用于更新状态
  const documentStore = useDocumentStore();
  const authStore = useAuthStore();

  // 本地连接状态（可选使用）
  const isConnected = ref(false);

  /**
   * 设置内容更新回调（供编辑器组件使用）
   */
  function onContentUpdate(callback: ContentUpdateCallback | null) {
    onContentUpdateCallback = callback;
  }

  /**
   * 连接到 Socket 服务器
   * 建立 WebSocket 连接
   */
  function connect() {
    // 如果已经连接，直接返回
    if (socket?.connected) return;

    // 创建新的 Socket 连接
    // 优先使用 VITE_SOCKET_URL；其次由 VITE_API_URL 推导；最终回退到本地默认值
    const apiBaseUrl = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
    const socketUrl =
      import.meta.env.VITE_SOCKET_URL ||
      (apiBaseUrl ? `${apiBaseUrl.replace(/\/api$/, '')}/documents` : `${window.location.origin}/documents`);

    // 从 auth store 获取 JWT token，传递给 WebSocket 握手
    const authToken = authStore.token;
    if (!authToken) {
      console.warn('🔌 Socket: 用户未登录，无法建立 WebSocket 连接');
      documentStore.setSocketStatus('disconnected');
      return;
    }

    socket = io(socketUrl, {
      // 传输方式：优先使用 WebSocket，如果失败则降级到轮询
      transports: ['websocket', 'polling'],
      // 通过 auth 传递 JWT token，后端 handleConnection 会验证
      auth: {
        token: authToken,
      },
    });

    // ====== 监听服务器发来的事件 ======

    // 连接成功
    socket.on('connect', () => {
      console.log('🔌 Socket connected');
      isConnected.value = true;
      documentStore.setSocketStatus('connected');
    });

    // 断开连接
    socket.on('disconnect', () => {
      console.log('🔌 Socket disconnected');
      isConnected.value = false;
      documentStore.setSocketStatus('disconnected');
    });

    // 连接错误
    socket.on('connect_error', (error) => {
      console.error('Socket connection error:', error);
      documentStore.setSocketStatus('disconnected');
    });

    // ====== 房间事件 ======

    // 收到当前房间用户列表
    socket.on('room-users', (data: { users: any[] }) => {
      documentStore.setCollaborators(data.users);
    });

    // 有用户加入
    socket.on('user-joined', (data: { userId: string; userName: string; users: any[] }) => {
      console.log(`👤 ${data.userName} joined`);
      documentStore.setCollaborators(data.users);
    });

    // 有用户离开
    socket.on('user-left', (data: { userId: string; userName: string; users: any[] }) => {
      console.log(`👋 ${data.userName} left`);
      documentStore.setCollaborators(data.users);
    });

    // ====== 内容同步事件 ======

    // 收到远程内容更新
    socket.on(
      'content-updated',
      (data: { content: string; version: number; userId: string; userName: string }) => {
        console.log('📝 Content updated from remote');
        // 调用外部回调（如编辑器组件）
        if (onContentUpdateCallback) {
          onContentUpdateCallback(data);
        }
        // 同时更新 documentStore（兼容旧逻辑）
        documentStore.updateContentFromRemote(data.content, data.version);
      },
    );
  }

  /**
   * 断开 Socket 连接
   */
  function disconnect() {
    if (socket) {
      socket.disconnect();
      socket = null;
    }
    isConnected.value = false;
    documentStore.setSocketStatus('disconnected');
  }

  /**
   * 加入文档房间
   * @param documentId - 文档 ID
   * @param userName - 用户名称（可选）
   */
  function joinDocument(documentId: string, userName?: string) {
    // 如果还没连接，先连接
    if (!socket) {
      connect();
    }

    documentStore.setSocketStatus('connecting');
    // 发送加入房间事件
    socket?.emit('join', { documentId, userName });
  }

  /**
   * 离开文档房间
   * @param documentId - 文档 ID
   */
  function leaveDocument(documentId: string) {
    socket?.emit('leave', { documentId });
  }

  /**
   * 发送内容更新
   * 当用户编辑文档时，通知其他用户
   * @param documentId - 文档 ID
   * @param content - 文档内容
   * @param version - 版本号
   * @param userName - 用户名称（可选）
   */
  function emitContentUpdate(documentId: string, content: string, version: number, userName?: string) {
    socket?.emit('content-update', { documentId, content, version, userName });
  }

  /**
   * 发送光标位置更新
   * @param documentId - 文档 ID
   * @param position - 光标位置
   * @param userName - 用户名称（可选）
   */
  function emitCursorUpdate(documentId: string, position: { line: number; ch: number }, userName?: string) {
    socket?.emit('cursor-update', { documentId, position, userName });
  }

  /**
   * 返回所有可用的函数和状态
   */
  return {
    socket,
    isConnected,
    connect,
    disconnect,
    joinDocument,
    leaveDocument,
    emitContentUpdate,
    emitCursorUpdate,
    onContentUpdate,
  };
}
