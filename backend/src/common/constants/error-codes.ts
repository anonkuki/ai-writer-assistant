export const ERROR_CODES = {
  // 通用错误 (1xxx)
  INVALID_PARAMETER: { code: 1001, message: '参数错误' },
  UNAUTHORIZED: { code: 1002, message: '未授权' },
  FORBIDDEN: { code: 1003, message: '禁止访问' },
  NOT_FOUND: { code: 1004, message: '资源不存在' },
  INTERNAL_ERROR: { code: 1005, message: '服务器内部错误' },
  SERVICE_UNAVAILABLE: { code: 1006, message: '服务不可用' },

  // 认证错误 (2xxx)
  INVALID_TOKEN: { code: 2001, message: 'Token 无效' },
  TOKEN_EXPIRED: { code: 2002, message: 'Token 已过期' },
  INVALID_CREDENTIALS: { code: 2003, message: '用户名或密码错误' },
  USER_EXISTS: { code: 2004, message: '用户已存在' },
  USER_NOT_FOUND: { code: 2005, message: '用户不存在' },

  // 文档错误 (3xxx)
  DOCUMENT_NOT_FOUND: { code: 3001, message: '文档不存在' },
  DOCUMENT_FORBIDDEN: { code: 3002, message: '无权限操作此文档' },
  DOCUMENT_LOCKED: { code: 3003, message: '文档已被锁定' },
  VERSION_CONFLICT: { code: 3004, message: '版本冲突' },

  // 团队错误 (4xxx)
  TEAM_NOT_FOUND: { code: 4001, message: '团队不存在' },
  TEAM_FULL: { code: 4002, message: '团队成员已满' },
  ALREADY_MEMBER: { code: 4003, message: '已是团队成员' },
  INVITE_EXPIRED: { code: 4004, message: '邀请已过期' },

  // AI 错误 (5xxx)
  AI_SERVICE_ERROR: { code: 5001, message: 'AI 服务错误' },
  AI_QUOTA_EXCEEDED: { code: 5002, message: 'AI 调用次数超限' },
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;
