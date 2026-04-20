import type {
  ClientConfig,
  ContextCompileRequest,
  ContextCompileResponse,
  FormsyError,
} from './types.js';

/**
 * Base client for Formsy API
 */
export class FormsyClient {
  private apiKey: string;
  private baseURL: string;
  private projectId?: string;
  private timeout: number;
  private retries: number;

  constructor(config: ClientConfig) {
    this.apiKey = config.apiKey;
    this.baseURL = config.baseURL || 'https://api.formsy.ai';
    this.projectId = config.projectId;
    this.timeout = config.timeout || 30000;
    this.retries = config.retries || 3;
  }

  /**
   * Compile context for a coding task
   */
  async compileContext(
    request: ContextCompileRequest
  ): Promise<ContextCompileResponse> {
    return this.request<ContextCompileResponse>('/v1/context/compile', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  /**
   * Make an authenticated request to the API
   */
  private async request<T>(
    path: string,
    options: RequestInit
  ): Promise<T> {
    const url = `${this.baseURL}${path}`;
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`,
      ...options.headers,
    };

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        const response = await fetch(url, {
          ...options,
          headers,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const error = await response.json().catch(() => ({}));
          throw new Error(
            error.message || `HTTP ${response.status}: ${response.statusText}`
          );
        }

        return await response.json();
      } catch (error) {
        lastError = error as Error;

        // Don't retry on client errors (4xx)
        if (error instanceof Error && error.message.includes('HTTP 4')) {
          throw error;
        }

        // Exponential backoff
        if (attempt < this.retries) {
          await new Promise(resolve =>
            setTimeout(resolve, Math.pow(2, attempt) * 1000)
          );
        }
      }
    }

    throw lastError || new Error('Request failed');
  }
}
