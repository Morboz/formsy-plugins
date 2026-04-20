import type { PromptBundle, Message } from '@formsy/sdk-core';

/**
 * Injection mode for compiled context
 */
export type InjectionMode = 'augment' | 'replace' | 'prepend';

/**
 * Injects compiled context into agent messages
 */
export class PromptInjector {
  /**
   * Inject prompt bundle into messages based on mode
   */
  inject(
    messages: Message[],
    bundle: PromptBundle,
    mode: InjectionMode = 'augment'
  ): Message[] {
    switch (mode) {
      case 'augment':
        return this.augmentMessages(messages, bundle);
      case 'replace':
        return this.replaceMessages(messages, bundle);
      case 'prepend':
        return this.prependMessages(messages, bundle);
      default:
        return messages;
    }
  }

  /**
   * Augment existing messages with context
   */
  private augmentMessages(
    messages: Message[],
    bundle: PromptBundle
  ): Message[] {
    const result = [...messages];

    // Add system addendum to system message
    if (bundle.system_addendum) {
      const systemIdx = result.findIndex(m => m.role === 'system');
      if (systemIdx >= 0) {
        result[systemIdx] = {
          ...result[systemIdx],
          content: `${result[systemIdx].content}\n\n${bundle.system_addendum}`,
        };
      } else {
        result.unshift({
          role: 'system',
          content: bundle.system_addendum,
        });
      }
    }

    // Add user addendum to last user message
    if (bundle.user_addendum) {
      const lastUserIdx = result.findLastIndex(m => m.role === 'user');
      if (lastUserIdx >= 0) {
        result[lastUserIdx] = {
          ...result[lastUserIdx],
          content: `${result[lastUserIdx].content}\n\n${bundle.user_addendum}`,
        };
      }
    }

    return result;
  }

  /**
   * Replace user message with context
   */
  private replaceMessages(
    messages: Message[],
    bundle: PromptBundle
  ): Message[] {
    const result = [...messages];
    const lastUserIdx = result.findLastIndex(m => m.role === 'user');

    if (lastUserIdx >= 0 && bundle.user_addendum) {
      result[lastUserIdx] = {
        role: 'user',
        content: bundle.user_addendum,
      };
    }

    return result;
  }

  /**
   * Prepend context before user message
   */
  private prependMessages(
    messages: Message[],
    bundle: PromptBundle
  ): Message[] {
    const result = [...messages];

    if (bundle.user_addendum) {
      const lastUserIdx = result.findLastIndex(m => m.role === 'user');
      if (lastUserIdx >= 0) {
        result.splice(lastUserIdx, 0, {
          role: 'user',
          content: bundle.user_addendum,
        });
      }
    }

    return result;
  }

  /**
   * Format context package for display
   */
  formatForDisplay(bundle: PromptBundle): string {
    const parts: string[] = [];

    if (bundle.system_addendum) {
      parts.push('## System Context\n' + bundle.system_addendum);
    }

    if (bundle.developer_addendum) {
      parts.push('## Developer Context\n' + bundle.developer_addendum);
    }

    if (bundle.user_addendum) {
      parts.push('## Task Context\n' + bundle.user_addendum);
    }

    return parts.join('\n\n');
  }
}
