import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

/**
 * 大纲数据类型
 */
export interface WorldSettingInput {
  genre?: string;
  theme?: string;
  tone?: string;
  targetWordCount?: number;
}

export interface PlotLineInput {
  title: string;
  description?: string;
  type?: 'MAIN' | 'SUB' | 'CHARACTER';
  order?: number;
}

export interface TimelineEventInput {
  title: string;
  description?: string;
  order?: number;
}

export interface ForeshadowingInput {
  title: string;
  content: string;
}

/**
 * Planner Service - 大纲管理服务
 * 负责 L3 战略层的数据管理
 */
@Injectable()
export class PlannerService {
  constructor(private prisma: PrismaService) {}

  // ==================== 世界观设置 ====================

  /**
   * 获取书籍的世界观设置
   */
  async getWorldSettings(bookId: string) {
    return this.prisma.worldSetting.findMany({
      where: { bookId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * 创建世界观设置
   */
  async createWorldSetting(bookId: string, input: WorldSettingInput) {
    return this.prisma.worldSetting.create({
      data: {
        bookId,
        ...input,
      },
    });
  }

  /**
   * 更新世界观设置
   */
  async updateWorldSetting(id: string, input: WorldSettingInput) {
    return this.prisma.worldSetting.update({
      where: { id },
      data: input,
    });
  }

  /**
   * 删除世界观设置
   */
  async deleteWorldSetting(id: string) {
    return this.prisma.worldSetting.delete({
      where: { id },
    });
  }

  // ==================== 剧情线 ====================

  /**
   * 获取书籍的剧情线
   */
  async getPlotLines(bookId: string) {
    return this.prisma.plotLine.findMany({
      where: { bookId },
      orderBy: { order: 'asc' },
    });
  }

  /**
   * 创建剧情线
   */
  async createPlotLine(bookId: string, input: PlotLineInput) {
    const maxOrder = await this.prisma.plotLine.findFirst({
      where: { bookId },
      orderBy: { order: 'desc' },
      select: { order: true },
    });

    return this.prisma.plotLine.create({
      data: {
        bookId,
        ...input,
        order: input.order ?? (maxOrder?.order ?? 0) + 1,
      },
    });
  }

  /**
   * 更新剧情线
   */
  async updatePlotLine(id: string, input: Partial<PlotLineInput>) {
    return this.prisma.plotLine.update({
      where: { id },
      data: input,
    });
  }

  /**
   * 删除剧情线
   */
  async deletePlotLine(id: string) {
    return this.prisma.plotLine.delete({
      where: { id },
    });
  }

  // ==================== 时间线 ====================

  /**
   * 获取时间线事件
   */
  async getTimelineEvents(bookId: string, chapterId?: string) {
    return this.prisma.timelineEvent.findMany({
      where: {
        bookId,
        chapterId: chapterId || undefined,
      },
      orderBy: { order: 'asc' },
    });
  }

  /**
   * 创建时间线事件
   */
  async createTimelineEvent(bookId: string, input: TimelineEventInput, chapterId?: string) {
    const maxOrder = await this.prisma.timelineEvent.findFirst({
      where: { bookId },
      orderBy: { order: 'desc' },
      select: { order: true },
    });

    return this.prisma.timelineEvent.create({
      data: {
        bookId,
        chapterId,
        ...input,
        order: input.order ?? (maxOrder?.order ?? 0) + 1,
      },
    });
  }

  /**
   * 删除时间线事件
   */
  async deleteTimelineEvent(id: string) {
    return this.prisma.timelineEvent.delete({
      where: { id },
    });
  }

  // ==================== 伏笔 ====================

  /**
   * 获取伏笔列表
   */
  async getForeshadowings(bookId: string, status?: string) {
    return this.prisma.foreshadowing.findMany({
      where: {
        bookId,
        status: (status as any) || undefined,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * 创建伏笔
   */
  async createForeshadowing(bookId: string, input: ForeshadowingInput, chapterId?: string) {
    return this.prisma.foreshadowing.create({
      data: {
        bookId,
        chapterId,
        title: input.title,
        content: input.content,
        status: 'PENDING',
      },
    });
  }

  /**
   * 更新伏笔状态
   */
  async resolveForeshadowing(id: string, resolveAt?: string) {
    return this.prisma.foreshadowing.update({
      where: { id },
      data: {
        status: 'RESOLVED',
        resolveAt,
      },
    });
  }

  /**
   * 更新伏笔（标题/内容）
   */
  async updateForeshadowing(id: string, data: { title?: string; content?: string }) {
    return this.prisma.foreshadowing.update({
      where: { id },
      data,
    });
  }

  /**
   * 废弃伏笔
   */
  async abandonForeshadowing(id: string) {
    return this.prisma.foreshadowing.update({
      where: { id },
      data: { status: 'ABANDONED' },
    });
  }

  /**
   * 删除伏笔
   */
  async deleteForeshadowing(id: string) {
    return this.prisma.foreshadowing.delete({
      where: { id },
    });
  }

  // ==================== 章纲（章节大纲） ====================

  /**
   * 获取书籍的章纲列表
   */
  async getOutlines(bookId: string) {
    return this.prisma.outline.findMany({
      where: { bookId },
      orderBy: { order: 'asc' },
    });
  }

  /**
   * 创建章纲
   */
  async createOutline(bookId: string, input: { title: string; content?: string }) {
    const maxOrder = await this.prisma.outline.findFirst({
      where: { bookId },
      orderBy: { order: 'desc' },
      select: { order: true },
    });

    return this.prisma.outline.create({
      data: {
        bookId,
        title: input.title,
        content: input.content || '',
        order: (maxOrder?.order ?? 0) + 1,
      },
    });
  }

  /**
   * 更新章纲
   */
  async updateOutline(id: string, input: { title?: string; content?: string; order?: number }) {
    return this.prisma.outline.update({
      where: { id },
      data: input,
    });
  }

  /**
   * 删除章纲
   */
  async deleteOutline(id: string) {
    return this.prisma.outline.delete({
      where: { id },
    });
  }
}
