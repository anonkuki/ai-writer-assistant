import {
  Injectable,
  Logger,
  ForbiddenException,
  BadGatewayException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError } from 'axios';
import * as http from 'http';
import * as https from 'https';
import { DocumentService } from '../document/document.service';
import { PrismaService } from '../prisma.service';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  // 硅基流动 API 配置
  private readonly apiKey: string;
  private readonly apiUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  /** HTTP keep-alive 连接池 */
  private readonly httpAgent = new http.Agent({ keepAlive: true, maxSockets: 10 });
  private readonly httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 10 });

  constructor(
    private documentService: DocumentService,
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {
    this.apiKey = this.configService.get<string>('SILICONFLOW_API_KEY') || '';
    this.apiUrl =
      this.configService.get<string>('SILICONFLOW_API_URL') ||
      'https://api.siliconflow.cn/v1/chat/completions';
    this.model = this.configService.get<string>('SILICONFLOW_MODEL') || 'Pro/deepseek-ai/DeepSeek-V3.2';
    this.timeoutMs = this.configService.get<number>('SILICONFLOW_TIMEOUT_MS') || 30000;

    if (!this.apiKey) {
      this.logger.warn('⚠️ SILICONFLOW_API_KEY 环境变量未设置，AI 功能将不可用');
    }
  }

  async ask(userId: string, documentId: string, question: string, selectedText?: string) {
    // Get document with permission check
    const document = await this.documentService.findOne(documentId, userId);

    // Build context from document
    const context = this.buildContext(document.content, selectedText);

    // Build prompt with prompt engineering
    const prompt = this.buildAskPrompt(context, question, selectedText);

    try {
      const answer = await this.requestCompletion({
        systemPrompt: `你是一个专业的AI写作助手，专门帮助用户编辑文档。你可以根据文档上下文提供有帮助的建议。
请用中文回复，保持文档的风格和语气。`,
        prompt,
        temperature: 0.7,
        maxTokens: 1000,
      });

      return {
        answer,
        suggestions: this.extractSuggestions(answer),
      };
    } catch (error: any) {
      throw this.wrapAiError(error, 'AI 服务调用失败');
    }
  }

  async suggest(userId: string, documentId: string, content: string, command?: string) {
    // Get full document with permission check
    const document = await this.documentService.findOne(documentId, userId);

    const prompt = this.buildSuggestPrompt(document.content, content, command);

    try {
      const suggestion = await this.requestCompletion({
        systemPrompt:
          '你是一个AI写作助手。根据文档上下文和用户操作，生成适当的内容建议。请用中文回复，简洁实用。',
        prompt,
        temperature: 0.8,
        maxTokens: 500,
      });

      return {
        suggestion,
        command: command || 'continue',
      };
    } catch (error: any) {
      throw this.wrapAiError(error, 'AI 建议服务调用失败');
    }
  }

  private buildContext(documentContent: string, selectedText?: string): string {
    try {
      const parsed = JSON.parse(documentContent);
      // Extract text from TipTap JSON content
      return this.extractTextFromTipTap(parsed);
    } catch {
      return documentContent || '';
    }
  }

  private extractTextFromTipTap(content: any): string {
    if (typeof content === 'string') return content;
    if (!content || !content.content) return '';

    let text = '';
    const extract = (node: any) => {
      if (node.type === 'text' && node.text) {
        text += node.text;
      }
      if (node.content) {
        node.content.forEach(extract);
      }
    };

    content.content.forEach(extract);
    return text;
  }

  private buildAskPrompt(context: string, question: string, selectedText?: string): string {
    let prompt = `Document Context:\n${context.substring(0, 2000)}\n\n`;

    if (selectedText) {
      prompt += `Selected Text: "${selectedText}"\n\n`;
    }

    prompt += `User Question: ${question}\n\n`;
    prompt += `Please provide a helpful response based on the document context.`;

    return prompt;
  }

  private buildSuggestPrompt(
    documentContent: string,
    selectedText: string,
    command?: string,
  ): string {
    const context = this.buildContext(documentContent);

    let prompt = `Document so far:\n${context.substring(0, 1500)}\n\n`;

    switch (command) {
      case 'continue':
        prompt += `The user wants to continue writing. Provide the next logical paragraph or section.`;
        break;
      case 'improve':
        prompt += `The user selected: "${selectedText}". Suggest improvements for clarity, style, and grammar.`;
        break;
      case 'fix':
        prompt += `The user selected: "${selectedText}". Fix any grammatical errors and improve readability.`;
        break;
      case 'summarize':
        prompt += `Summarize the main points of the document in 2-3 sentences.`;
        break;
      default:
        prompt += `Based on the selected text: "${selectedText}", provide a helpful suggestion.`;
    }

    return prompt;
  }

  private extractSuggestions(answer: string): string[] {
    // Extract bullet points or numbered items from the response
    const lines = answer.split('\n').filter((line) => {
      const trimmed = line.trim();
      return trimmed.startsWith('-') || trimmed.startsWith('*') || /^\d+\./.test(trimmed);
    });

    if (lines.length > 0) {
      return lines.map((line) => line.replace(/^[-*\d.]+\s*/, '').trim());
    }

    // If no bullet points, split by sentences
    const sentences = answer.split(/(?<=[.!?])\s+/).filter((s) => s.length > 10);
    return sentences.slice(0, 3);
  }

  private getMockResponse(question: string, selectedText?: string): any {
    const responses: Record<string, string> = {
      default: '我理解您的问题。根据文档内容，我建议您可以进一步完善当前的段落，使表达更加清晰。',
      grammar: '语法检查完成。选中的文本没有明显的语法错误，但可以考虑使用更简洁的表达方式。',
      improve: '建议将长句拆分为短句，并使用更具描述性的词汇来增强可读性。',
    };

    const key = question.toLowerCase().includes('语法')
      ? 'grammar'
      : question.toLowerCase().includes('改进')
        ? 'improve'
        : 'default';

    return {
      answer: responses[key],
      suggestions: ['添加更多细节描述', '使用更具体的例子', '简化复杂句子'],
    };
  }

  private getMockSuggestion(command?: string): any {
    const suggestions: Record<string, string> = {
      continue:
        '基于当前文档内容，您可以继续阐述下一个要点，或者添加一个实际应用场景来增强说服力。',
      improve: '建议使用更生动的描述性语言，并适当加入数据或案例来支撑观点。',
      fix: '已检查并修正了语法错误。现在句子更加清晰流畅。',
      summarize: '本文档主要讨论了核心主题，涵盖了主要观点和关键细节。',
    };

    return {
      suggestion: suggestions[command || 'continue'],
      command: command || 'continue',
    };
  }

  // ==================== 写作辅助方法 ====================

  /**
   * 写作辅助接口
   */
  async write(
    userId: string,
    bookId: string,
    chapterId: string | undefined,
    content: string,
    command: string,
    options?: any,
  ) {
    // 验证书籍权限
    const book = await this.prisma.book.findFirst({
      where: { id: bookId, ownerId: userId },
    });
    if (!book) {
      throw new NotFoundException('书籍不存在');
    }

    // 获取章节内容（如果有）
    let chapterContent = '';
    if (chapterId) {
      const chapter = await this.prisma.chapter.findFirst({
        where: { id: chapterId, bookId },
      });
      if (chapter) {
        chapterContent = chapter.content;
      }
    }

    const prompt = this.buildWritePrompt(book.title, chapterContent, content, command, options);

    try {
      const response = await this.callAiApi(prompt, this.getTemperatureForCommand(command));
      return {
        result: response,
        command,
        suggestions: this.extractSuggestions(response),
      };
    } catch (error: any) {
      this.logger.error('AI 写作辅助失败', error.message);
      throw new BadGatewayException({
        success: false,
        message: `AI 写作辅助失败: ${error.message}`,
      });
    }
  }

  /**
   * 文本编辑接口
   */
  async editText(userId: string, bookId: string, text: string, action: string, style?: string) {
    // 验证书籍权限
    const book = await this.prisma.book.findFirst({
      where: { id: bookId, ownerId: userId },
    });
    if (!book) {
      throw new NotFoundException('书籍不存在');
    }

    const prompt = this.buildEditPrompt(text, action, style);

    try {
      const response = await this.callAiApi(prompt, 0.7);
      return {
        result: response,
        action,
        original: text,
      };
    } catch (error: any) {
      this.logger.error('AI 文本编辑失败', error.message);
      throw new BadGatewayException({
        success: false,
        message: `AI 文本编辑失败: ${error.message}`,
      });
    }
  }

  /**
   * 大纲生成接口
   */
  async generateOutline(
    userId: string,
    bookId: string,
    title: string,
    genre?: string,
    chapterCount?: number,
    existingOutline?: string,
  ) {
    // 验证书籍权限
    const book = await this.prisma.book.findFirst({
      where: { id: bookId, ownerId: userId },
    });
    if (!book) {
      throw new NotFoundException('书籍不存在');
    }

    const prompt = this.buildOutlinePrompt(title, genre, chapterCount, existingOutline);

    try {
      const response = await this.callAiApi(prompt, 0.8);
      return {
        outline: response,
        title,
        genre,
      };
    } catch (error: any) {
      this.logger.error('AI 大纲生成失败', error.message);
      throw new BadGatewayException({
        success: false,
        message: `AI 大纲生成失败: ${error.message}`,
      });
    }
  }

  /**
   * 角色生成接口
   */
  async generateCharacter(
    userId: string,
    bookId: string,
    name?: string,
    role?: string,
    description?: string,
  ) {
    // 验证书籍权限
    const book = await this.prisma.book.findFirst({
      where: { id: bookId, ownerId: userId },
    });
    if (!book) {
      throw new NotFoundException('书籍不存在');
    }

    const prompt = this.buildCharacterPrompt(book.title, name, role, description);

    try {
      const response = await this.callAiApi(prompt, 0.7);
      return {
        character: response,
        name,
        role,
      };
    } catch (error: any) {
      this.logger.error('AI 角色生成失败', error.message);
      throw new BadGatewayException({
        success: false,
        message: `AI 角色生成失败: ${error.message}`,
      });
    }
  }

  // ==================== 辅助方法 ====================

  private async callAiApi(prompt: string, temperature: number = 0.7): Promise<string> {
    return this.requestCompletion({
      systemPrompt:
        '你是一个专业的网络小说作家助手，擅长创作各类网络文学作品。你需要根据用户的需求生成高质量的内容。',
      prompt,
      temperature,
      maxTokens: 2000,
    });
  }

  private ensureAiReady() {
    if (!this.apiKey) {
      throw new ServiceUnavailableException({
        success: false,
        message: 'AI 服务未配置：缺少 SILICONFLOW_API_KEY',
      });
    }
  }

  private async requestCompletion(options: {
    systemPrompt: string;
    prompt: string;
    temperature: number;
    maxTokens: number;
  }): Promise<string> {
    this.ensureAiReady();

    const MAX_RETRIES = 2;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await axios.post(
          this.apiUrl,
          {
            model: this.model,
            messages: [
              {
                role: 'system',
                content: options.systemPrompt,
              },
              {
                role: 'user',
                content: options.prompt,
              },
            ],
            temperature: options.temperature,
            max_tokens: options.maxTokens,
          },
          {
            timeout: this.timeoutMs,
            headers: {
              Authorization: `Bearer ${this.apiKey}`,
              'Content-Type': 'application/json',
            },
            httpAgent: this.httpAgent,
            httpsAgent: this.httpsAgent,
          },
        );

        const content = response.data?.choices?.[0]?.message?.content;
        if (!content) {
          throw new BadGatewayException({
            success: false,
            message: 'AI 服务返回数据格式异常',
          });
        }

        return content;
      } catch (error: any) {
        const status = error.response?.status;
        const isRetryable = !status || status === 429 || status >= 500;

        if (isRetryable && attempt < MAX_RETRIES) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 4000);
          this.logger.warn(
            `AI 请求第${attempt + 1}次失败 (status=${status || 'timeout'})，${delay}ms 后重试`,
          );
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        throw error;
      }
    }

    // 不可达
    throw new BadGatewayException({ success: false, message: 'AI 服务调用失败' });
  }

  private wrapAiError(error: unknown, businessMessage: string): BadGatewayException {
    const axiosError = error as AxiosError<any>;
    const remoteMessage =
      (typeof axiosError.response?.data === 'string'
        ? axiosError.response?.data
        : axiosError.response?.data?.message) || axiosError.message;

    this.logger.error(`${businessMessage}: ${remoteMessage}`);
    return new BadGatewayException({
      success: false,
      message: `${businessMessage}: ${remoteMessage}`,
    });
  }

  private getTemperatureForCommand(command: string): number {
    const tempMap: Record<string, number> = {
      generate: 0.8,
      continue: 0.7,
      improve: 0.6,
      expand: 0.8,
      summarize: 0.5,
      edit: 0.6,
      outline: 0.9,
      character: 0.7,
      plot: 0.8,
    };
    return tempMap[command] || 0.7;
  }

  private buildWritePrompt(
    bookTitle: string,
    chapterContent: string,
    content: string,
    command: string,
    options?: any,
  ): string {
    let prompt = `书籍标题：${bookTitle}\n\n`;

    if (chapterContent) {
      prompt += `当前章节内容：\n${chapterContent.substring(0, 2000)}\n\n`;
    }

    switch (command) {
      case 'generate':
        prompt += `请根据以下大纲生成章节内容：\n${content}`;
        break;
      case 'continue':
        prompt += `请续写以下内容，要求衔接自然、情节流畅：\n${content}`;
        break;
      case 'improve':
        prompt += `请改进以下内容，提升文笔和可读性：\n${content}`;
        break;
      case 'expand':
        prompt += `请扩展以下内容，增加细节和描写：\n${content}`;
        break;
      case 'summarize':
        prompt += `请用简洁的语言总结以下内容：\n${content}`;
        break;
      case 'outline':
        prompt += `请为以下章节生成详细大纲：\n标题：${options?.title || ''}\n${content}`;
        break;
      case 'character':
        prompt += `请为以下设定生成角色详细介绍：\n${content}`;
        break;
      case 'plot':
        prompt += `请提供的情节发展建议：\n${content}`;
        break;
      default:
        prompt += `请处理以下内容：\n${content}`;
    }

    return prompt;
  }

  private buildEditPrompt(text: string, action: string, style?: string): string {
    let prompt = `请对以下文本进行「${this.getActionName(action)}」`;

    if (style) {
      prompt += `，风格要求：${style}`;
    }

    prompt += `：\n\n${text}`;

    return prompt;
  }

  private getActionName(action: string): string {
    const actionMap: Record<string, string> = {
      improve: '改进表达',
      polish: '润色',
      shorten: '精简',
      expand: '扩展',
      fix: '纠错',
      change_style: '改变风格',
    };
    return actionMap[action] || action;
  }

  private buildOutlinePrompt(
    title: string,
    genre?: string,
    chapterCount?: number,
    existingOutline?: string,
  ): string {
    const count = chapterCount || 10;
    let prompt = `请为网络小说《${title}》生成大纲`;

    if (genre) {
      prompt += `，类型为：${genre}`;
    }

    prompt += `。请生成约 ${count} 章的大纲，每章需要包含：章节标题、主要情节、字数建议（1500-2000字）。`;

    if (existingOutline) {
      prompt += `\n\n已有大纲：\n${existingOutline}\n\n请在此基础上进行扩展或修改。`;
    }

    return prompt;
  }

  private buildCharacterPrompt(
    bookTitle: string,
    name?: string,
    role?: string,
    description?: string,
  ): string {
    let prompt = `请为小说《${bookTitle}》生成角色设定`;

    if (name) {
      prompt += `：${name}`;
    }

    if (role) {
      prompt += `，角色类型：${role}`;
    }

    prompt +=
      '。请包含以下内容：\n1. 角色基本信息（姓名、年龄、外貌）\n2. 性格特点\n3. 背景故事\n4. 在故事中的作用\n5. 与其他角色的关系';

    if (description) {
      prompt += `\n\n参考设定：\n${description}`;
    }

    return prompt;
  }
}
