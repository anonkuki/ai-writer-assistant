/**
 * 文档实时通信网关（WebSocket）
 * ============================================
 * 本文件实现了实时多人协作功能，类似于对讲机让多方同时通话
 *
 * 什么是 WebSocket？
 * - WebSocket 是一种双向通信协议，不同于 HTTP 的请求-响应模式
 * - 建立了 WebSocket 连接后，服务器可以主动向客户端推送消息
 * - 就像打电话，双方可以随时说话，而不像发短信必须等对方回复
 *
 * Socket.IO 简介：
 * - 一个流行的 WebSocket 库，提供了更简单的 API 和更好的兼容性
 * - namespace（命名空间）：用于区分不同类型的连接
 * - room（房间）：用于分组通信，同一个房间的人可以互相聊天
 *
 * 核心功能：
 * 1. 文档房间管理 - 用户加入/离开文档时通知其他人
 * 2. 内容实时同步 - 一个用户编辑时，其他用户实时看到变化
 * 3. 光标位置同步 - 显示其他用户的光标位置
 * 4. 在线用户列表 - 维护当前文档的在线用户
 *
 * 事件说明（客户端 <-> 服务器）：
 * - join: 用户加入文档房间
 * - leave: 用户离开文档房间
 * - user-joined: 通知其他人有新用户加入
 * - user-left: 通知其他人有用户离开
 * - content-update: 文档内容更新
 * - content-updated: 广播内容更新给其他人
 * - cursor-update: 光标位置更新
 * - cursor-updated: 广播光标位置
 * - room-users: 发送当前房间用户列表
 */

import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import * as jwt from 'jsonwebtoken';
import { ConfigService } from '@nestjs/config';
import { DocumentService } from '../document/document.service';

/**
 * 房间用户接口
 * 用于记录加入文档房间的用户信息
 */
interface RoomUser {
  documentId: string; // 文档 ID
  userId: string; // 用户/客户端 ID（Socket ID）
  userName: string; // 用户名称
  realUserId: string; // JWT 中的真实用户 ID
}

/**
 * 文档网关
 * @WebSocketGateway 装饰器将此类标记为 WebSocket 网关
 * namespace: '/documents' 表示所有连接都在 /documents 路径下
 * 例如：连接地址为 http://localhost:3001/documents
 */
@WebSocketGateway({
  cors: {
    origin: true,
    credentials: true,
  },
  namespace: '/documents',
})
export class DocumentGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private jwtSecret: string;

  constructor(
    private configService: ConfigService,
    private documentService: DocumentService,
  ) {
    this.jwtSecret = this.configService.get<string>('JWT_SECRET') || 'default-secret';
  }

  /**
   * @WebSocketServer() 自动注入 Socket.IO 服务器实例
   * 用于向客户端发送消息
   */
  @WebSocketServer()
  server: Server;

  /**
   * 文档房间映射
   * 结构：Map<文档ID, Map<用户ID, 用户信息>>
   * 使用 Map 可以高效地添加、删除和查找用户
   */
  private documentRooms = new Map<string, Map<string, RoomUser>>();

  /**
   * 当客户端连接时调用
   * @param client - 连接的客户端 Socket 对象
   */
  handleConnection(client: Socket) {
    // 从 query 参数获取 token
    const token = client.handshake.auth?.token || client.handshake.query?.token;

    if (!token) {
      console.log(`🔌 Client ${client.id} disconnected: No token provided`);
      client.disconnect();
      return;
    }

    try {
      // 验证 JWT token
      const decoded = jwt.verify(token as string, this.jwtSecret) as any;
      // JWT 标准使用 sub 字段存储用户 ID
      (client as any).user = { userId: decoded.sub, username: decoded.username };
      console.log(`🔌 Client connected: ${client.id}, user: ${decoded.sub}`);
    } catch (error) {
      console.log(`🔌 Client ${client.id} disconnected: Invalid token`);
      client.disconnect();
    }
  }

  /**
   * 当客户端断开连接时调用
   * @param client - 断开的客户端 Socket 对象
   *
   * 逻辑说明：
   * 1. 遍历所有文档房间，找到断开连接的用户
   * 2. 从房间中移除该用户
   * 3. 通知房间内其他人该用户已离开
   */
  handleDisconnect(client: Socket) {
    console.log(`🔌 Client disconnected: ${client.id}`);

    // 遍历所有文档房间
    this.documentRooms.forEach((users, documentId) => {
      users.forEach((user, userId) => {
        if (userId === client.id) {
          // 从房间中删除用户
          users.delete(client.id);
          // 通知房间内其他人
          this.server.to(`document:${documentId}`).emit('user-left', {
            userId: client.id,
            userName: user.userName,
            users: Array.from(users.values()),
          });
        }
      });
    });
  }

  /**
   * 处理用户加入房间事件
   * 客户端发送 'join' 消息时调用
   *
   * @ConnectedSocket() - 获取发起请求的客户端 Socket
   * @MessageBody() - 获取客户端发送的数据
   */
  @SubscribeMessage('join')
  async handleJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { documentId: string; userName?: string },
  ) {
    const { documentId, userName = 'Anonymous' } = data;
    const roomName = `document:${documentId}`;

    // ======= 文档级权限校验 =======
    const user = (client as any).user;
    if (!user?.userId) {
      client.emit('error', { message: '未认证，无法加入房间' });
      return { success: false, error: 'Unauthorized' };
    }

    try {
      // 验证用户对该文档的访问权限（findOne 内部会检查 ownership）
      await this.documentService.findOne(documentId, user.userId);
    } catch {
      client.emit('error', { message: '无权限访问该文档' });
      return { success: false, error: 'Forbidden' };
    }

    // 让客户端加入房间
    client.join(roomName);

    // 如果房间不存在，创建新房间
    if (!this.documentRooms.has(documentId)) {
      this.documentRooms.set(documentId, new Map());
    }

    // 将用户添加到房间
    const users = this.documentRooms.get(documentId)!;
    users.set(client.id, {
      userId: client.id,
      documentId: documentId,
      userName: userName,
      realUserId: user.userId,
    });

    // 通知房间内其他人（有新用户加入）
    client.to(roomName).emit('user-joined', {
      userId: client.id,
      userName: userName,
      users: Array.from(users.values()),
    });

    // 发送当前房间用户列表给新加入的用户
    client.emit('room-users', {
      users: Array.from(users.values()),
    });

    console.log(`👤 ${userName} joined document ${documentId}`);

    // 返回结果给客户端
    return {
      success: true,
      userId: client.id,
      users: Array.from(users.values()),
    };
  }

  /**
   * 处理用户离开房间事件
   * 客户端发送 'leave' 消息时调用
   */
  @SubscribeMessage('leave')
  handleLeave(@ConnectedSocket() client: Socket, @MessageBody() data: { documentId: string }) {
    const { documentId } = data;
    const roomName = `document:${documentId}`;

    // 让客户端离开房间
    client.leave(roomName);

    // 从追踪中移除用户
    const users = this.documentRooms.get(documentId);
    if (users) {
      const user = users.get(client.id);
      users.delete(client.id);

      // 通知房间内其他人
      if (user) {
        this.server.to(roomName).emit('user-left', {
          userId: client.id,
          userName: user.userName,
          users: Array.from(users.values()),
        });
      }
    }

    console.log(`👋 User left document ${documentId}`);

    return { success: true };
  }

  /**
   * 处理文档内容更新事件
   * 当用户编辑文档时，实时同步给其他用户
   *
   * 注意：内容更新只广播给其他人，不广播给发送者自己
   * 这样可以避免编辑时的闪烁问题
   */
  @SubscribeMessage('content-update')
  handleContentUpdate(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      documentId: string;
      content: string;
      version: number;
      userName?: string;
    },
  ) {
    const { documentId, content, version, userName = 'Anonymous' } = data;
    const roomName = `document:${documentId}`;

    // 广播给房间内所有其他客户端（不包括发送者）
    client.to(roomName).emit('content-updated', {
      content,
      version,
      userId: client.id,
      userName: userName,
      timestamp: new Date().toISOString(),
    });

    console.log(`📝 Content updated in document ${documentId} (v${version})`);

    return { success: true };
  }

  /**
   * 处理光标位置更新事件
   * 用于显示其他用户的光标位置
   */
  @SubscribeMessage('cursor-update')
  handleCursorUpdate(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      documentId: string;
      position: { line: number; ch: number };
      userName?: string;
    },
  ) {
    const { documentId, position, userName = 'Anonymous' } = data;
    const roomName = `document:${documentId}`;

    // 广播光标位置给其他人
    client.to(roomName).emit('cursor-updated', {
      userId: client.id,
      userName: userName,
      position,
    });
  }
}
