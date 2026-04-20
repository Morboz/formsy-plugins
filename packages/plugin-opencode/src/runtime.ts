export interface PatchBudget {
  max_tokens?: number;
  max_time_seconds?: number;
}

export interface GeneratePatchOptions {
  type: 'swebench';
  case_id: string;
  stop_after?: string;
  enable_w2?: boolean;
  budget?: PatchBudget;
}

export interface GeneratePatchResult {
  status: number;
  upstreamUrl: string;
  data: unknown;
}

export class OpenCodeRuntime {
  private gatewayUrl: string;

  constructor() {
    this.gatewayUrl = process.env.FORMSY_GATEWAY_URL || 'http://localhost:3001';
  }

  async generatePatch(
    options: GeneratePatchOptions
  ): Promise<GeneratePatchResult> {
    const upstreamUrl = new URL('/patch', this.gatewayUrl).toString();

    let response: Response;
    try {
      response = await fetch(upstreamUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(options),
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to reach gateway service';
      throw new Error(`Patch gateway request failed: ${message}`);
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch (error) {
      throw new Error(
        `Patch gateway returned invalid JSON with status ${response.status}`
      );
    }

    if (!response.ok) {
      const message =
        typeof data === 'object' &&
        data !== null &&
        'error' in data &&
        typeof data.error === 'object' &&
        data.error !== null &&
        'message' in data.error &&
        typeof data.error.message === 'string'
          ? data.error.message
          : `Patch gateway returned status ${response.status}`;
      throw new Error(message);
    }

    return {
      status: response.status,
      upstreamUrl,
      data,
    };
  }
}
