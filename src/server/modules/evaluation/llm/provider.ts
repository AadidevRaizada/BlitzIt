import 'server-only';
import { logger } from '@/lib/logger';

/**
 * Configurable LLM backend (supersedes the original "Claude primary / OpenAI
 * fallback" wiring in D18).
 *
 * The evaluation engine is deliberately NOT tied to any vendor. Switching
 * backends requires changing environment variables only:
 *
 *   LLM_PROVIDER=openai|anthropic
 *   LLM_MODEL=gpt-5.5
 *   LLM_TEMPERATURE=0
 *
 * Nothing above this layer — scoring, persistence, prompt hashing, evidence,
 * rubric — knows which provider is in use.
 */

export type LlmProviderName = 'openai' | 'anthropic';

export const SUPPORTED_PROVIDERS: readonly LlmProviderName[] = [
  'openai',
  'anthropic',
] as const;

/** Used when LLM_MODEL is unset, per provider. */
const DEFAULT_MODELS: Record<LlmProviderName, string> = {
  openai: 'gpt-5.5',
  anthropic: 'claude-sonnet-4-5',
};

export interface LlmRequest {
  system: string;
  user: string;
  maxTokens: number;
  /** Requested temperature. May be overridden by model capability — see below. */
  temperature: number;
}

export interface LlmResponse {
  text: string;
  modelId: string;
  provider: LlmProviderName;
  /**
   * The temperature the backend actually used. Some models (e.g. OpenAI's
   * gpt-5.x reasoning family) only accept their default, so the requested 0
   * cannot always be honoured. Recorded in the audit rather than silently
   * assumed, because reproducibility depends on it (D2).
   */
  temperatureApplied: number | null;
}

export interface LlmProvider {
  readonly name: LlmProviderName;
  readonly modelId: string;
  isConfigured(): boolean;
  complete(request: LlmRequest): Promise<LlmResponse>;
}

const REQUEST_TIMEOUT_MS = 120_000;

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

/**
 * OpenAI's gpt-5.x / o-series reasoning models changed the chat API contract:
 * `max_tokens` is rejected in favour of `max_completion_tokens`, and a custom
 * `temperature` is refused entirely (only the default is allowed).
 */
function isReasoningStyleModel(modelId: string): boolean {
  return /^(gpt-5|o[1-9])/i.test(modelId);
}

export class OpenAiProvider implements LlmProvider {
  readonly name = 'openai' as const;
  readonly modelId: string;

  constructor(modelId: string = DEFAULT_MODELS.openai) {
    this.modelId = modelId;
  }

  isConfigured(): boolean {
    return Boolean(process.env.OPENAI_API_KEY);
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const reasoningStyle = isReasoningStyleModel(this.modelId);

    const body: Record<string, unknown> = {
      model: this.modelId,
      messages: [
        { role: 'system', content: request.system },
        { role: 'user', content: request.user },
      ],
      // Reasoning models spend tokens on hidden reasoning before answering, so
      // a small cap can consume the whole budget and return an empty message.
      ...(reasoningStyle
        ? { max_completion_tokens: Math.max(request.maxTokens, 4000) }
        : { max_tokens: request.maxTokens }),
    };

    // Only send a temperature the model will accept.
    let temperatureApplied: number | null = null;
    if (!reasoningStyle) {
      body.temperature = request.temperature;
      temperatureApplied = request.temperature;
    } else if (request.temperature !== 1) {
      logger.warn(
        { modelId: this.modelId, requested: request.temperature },
        'model does not support a custom temperature; using its default',
      );
    }

    const json = (await postJson(
      'https://api.openai.com/v1/chat/completions',
      { authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ''}` },
      body,
    )) as { choices?: Array<{ message?: { content?: string } }> };

    return {
      text: json.choices?.[0]?.message?.content ?? '',
      modelId: this.modelId,
      provider: this.name,
      temperatureApplied,
    };
  }
}

export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic' as const;
  readonly modelId: string;

  constructor(modelId: string = DEFAULT_MODELS.anthropic) {
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

    return {
      text,
      modelId: this.modelId,
      provider: this.name,
      temperatureApplied: request.temperature,
    };
  }
}

/** Factory — the only place that maps a provider name to an implementation. */
export function createLLMProvider(
  provider: LlmProviderName,
  modelId?: string,
): LlmProvider {
  switch (provider) {
    case 'openai':
      return new OpenAiProvider(modelId ?? DEFAULT_MODELS.openai);
    case 'anthropic':
      return new AnthropicProvider(modelId ?? DEFAULT_MODELS.anthropic);
    default: {
      // Exhaustiveness guard — a new provider must be handled explicitly.
      const exhaustive: never = provider;
      throw new Error(`Unsupported LLM provider: ${String(exhaustive)}`);
    }
  }
}

export interface LlmConfig {
  provider: LlmProviderName;
  model: string;
  temperature: number;
}

/** Read the backend selection from the environment. */
export function resolveLlmConfig(): LlmConfig {
  const raw = (process.env.LLM_PROVIDER ?? 'openai').trim().toLowerCase();
  const provider = SUPPORTED_PROVIDERS.includes(raw as LlmProviderName)
    ? (raw as LlmProviderName)
    : 'openai';

  if (raw && provider !== raw) {
    logger.warn(
      { requested: raw, using: provider },
      'unknown LLM_PROVIDER; falling back to the default',
    );
  }

  const model = process.env.LLM_MODEL?.trim() || DEFAULT_MODELS[provider];

  const parsedTemp = Number(process.env.LLM_TEMPERATURE ?? '0');
  const temperature = Number.isFinite(parsedTemp) ? parsedTemp : 0;

  return { provider, model, temperature };
}

/**
 * The configured provider, or null when it has no credentials. Returning null
 * (rather than throwing) is what keeps evaluation in degraded mode instead of
 * failing the whole run.
 */
export function getConfiguredProvider(): LlmProvider | null {
  const { provider, model } = resolveLlmConfig();
  const instance = createLLMProvider(provider, model);
  return instance.isConfigured() ? instance : null;
}

/** True when the configured provider has credentials. */
export function isLlmConfigured(): boolean {
  return getConfiguredProvider() !== null;
}

/**
 * Run a completion against the configured backend. Returns null on any failure
 * so the caller degrades gracefully.
 */
export async function completeWithConfiguredProvider(
  request: Omit<LlmRequest, 'temperature'> & { temperature?: number },
): Promise<LlmResponse | null> {
  const config = resolveLlmConfig();
  const provider = getConfiguredProvider();

  if (!provider) {
    logger.warn(
      { provider: config.provider },
      'configured LLM provider has no API key',
    );
    return null;
  }

  try {
    return await provider.complete({
      ...request,
      temperature: request.temperature ?? config.temperature,
    });
  } catch (error) {
    logger.warn(
      {
        provider: provider.name,
        modelId: provider.modelId,
        err: error instanceof Error ? error.message : 'unknown',
      },
      'LLM provider call failed; evaluation will degrade',
    );
    return null;
  }
}
