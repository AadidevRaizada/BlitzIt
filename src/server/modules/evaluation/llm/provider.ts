import 'server-only';
import { logger } from '@/lib/logger';

/**
 * Provider-agnostic LLM interface (D18).
 *
 * Claude is primary, OpenAI is the fallback. Call sites depend on this
 * interface only, so swapping or adding a provider never touches the rubric.
 */

export interface LlmRequest {
  system: string;
  user: string;
  maxTokens: number;
  /** Always 0 for evaluation — scores must be reproducible (D2). */
  temperature: number;
}

export interface LlmResponse {
  text: string;
  modelId: string;
  provider: 'anthropic' | 'openai';
}

export interface LlmProvider {
  readonly name: 'anthropic' | 'openai';
  readonly modelId: string;
  isConfigured(): boolean;
  complete(request: LlmRequest): Promise<LlmResponse>;
}

const REQUEST_TIMEOUT_MS = 60_000;

async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`${response.status}: ${detail.slice(0, 300)}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Claude — primary evaluator (D18). */
export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic' as const;
  readonly modelId: string;

  constructor(modelId = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-5') {
    this.modelId = modelId;
  }

  isConfigured(): boolean {
    return Boolean(process.env.ANTHROPIC_API_KEY);
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const json = (await postJson(
      'https://api.anthropic.com/v1/messages',
      {
        'x-api-key': process.env.ANTHROPIC_API_KEY ?? '',
        'anthropic-version': '2023-06-01',
      },
      {
        model: this.modelId,
        max_tokens: request.maxTokens,
        temperature: request.temperature,
        system: request.system,
        messages: [{ role: 'user', content: request.user }],
      },
    )) as { content?: Array<{ type: string; text?: string }> };

    const text =
      json.content
        ?.filter((block) => block.type === 'text')
        .map((block) => block.text ?? '')
        .join('') ?? '';

    return { text, modelId: this.modelId, provider: this.name };
  }
}

/** OpenAI — fallback only (D18). */
export class OpenAiProvider implements LlmProvider {
  readonly name = 'openai' as const;
  readonly modelId: string;

  constructor(modelId = process.env.OPENAI_MODEL ?? 'gpt-4.1') {
    this.modelId = modelId;
  }

  isConfigured(): boolean {
    return Boolean(process.env.OPENAI_API_KEY);
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const json = (await postJson(
      'https://api.openai.com/v1/chat/completions',
      { authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ''}` },
      {
        model: this.modelId,
        max_tokens: request.maxTokens,
        temperature: request.temperature,
        messages: [
          { role: 'system', content: request.system },
          { role: 'user', content: request.user },
        ],
      },
    )) as { choices?: Array<{ message?: { content?: string } }> };

    return {
      text: json.choices?.[0]?.message?.content ?? '',
      modelId: this.modelId,
      provider: this.name,
    };
  }
}

/**
 * Try Claude, then OpenAI. Returns null when neither is configured or both
 * fail — callers must degrade gracefully rather than fail the whole evaluation.
 */
export async function completeWithFallback(
  request: LlmRequest,
): Promise<LlmResponse | null> {
  const providers: LlmProvider[] = [
    new AnthropicProvider(),
    new OpenAiProvider(),
  ];

  for (const provider of providers) {
    if (!provider.isConfigured()) continue;
    try {
      return await provider.complete(request);
    } catch (error) {
      logger.warn(
        {
          provider: provider.name,
          err: error instanceof Error ? error.message : 'unknown',
        },
        'LLM provider failed; trying fallback',
      );
    }
  }

  return null;
}

/** True when at least one provider has credentials. */
export function anyProviderConfigured(): boolean {
  return (
    new AnthropicProvider().isConfigured() ||
    new OpenAiProvider().isConfigured()
  );
}
