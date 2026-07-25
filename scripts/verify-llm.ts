import './load-env';
import {
  createLLMProvider,
  resolveLlmConfig,
  isLlmConfigured,
  SUPPORTED_PROVIDERS,
} from '../src/server/modules/evaluation/llm/provider';
import { evaluateQuality } from '../src/server/modules/evaluation/llm/quality';
import { readRepoAsText } from '../src/server/modules/evaluation/github-text';

/**
 * LLM backend configurability checks.
 *
 * Proves the engine is vendor-neutral: the provider is chosen purely by
 * LLM_PROVIDER/LLM_MODEL, and every failure path still degrades instead of
 * throwing.
 *
 *   npm run verify:llm                       # config + factory + degraded
 *   npm run verify:llm -- --live <repoUrl>   # also calls the real backend
 */

let failures = 0;
function check(label: string, condition: boolean, detail?: string) {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}`);
  if (!condition) {
    failures++;
    if (detail) console.log(`      ${detail}`);
  }
}

/** Run `fn` with temporary env overrides, always restoring afterwards. */
async function withEnv<T>(
  overrides: Record<string, string | undefined>,
  fn: () => Promise<T> | T,
): Promise<T> {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(overrides)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function main() {
  // ---------- Factory ----------
  check('supports openai + anthropic', SUPPORTED_PROVIDERS.length === 2);
  for (const name of SUPPORTED_PROVIDERS) {
    const p = createLLMProvider(name, 'test-model');
    check(`factory returns a ${name} provider`, p.name === name);
    check(`factory honours the model id (${name})`, p.modelId === 'test-model');
  }

  // ---------- Config comes from env only ----------
  await withEnv(
    { LLM_PROVIDER: 'anthropic', LLM_MODEL: 'claude-x' },
    async () => {
      const c = resolveLlmConfig();
      check('LLM_PROVIDER selects the backend', c.provider === 'anthropic');
      check('LLM_MODEL selects the model', c.model === 'claude-x');
    },
  );
  await withEnv({ LLM_PROVIDER: 'openai', LLM_MODEL: undefined }, async () => {
    check(
      'model defaults per provider when LLM_MODEL is unset',
      resolveLlmConfig().model === 'gpt-5.5',
    );
  });
  await withEnv({ LLM_PROVIDER: 'nonsense-vendor' }, async () => {
    check(
      'unknown provider falls back safely (no crash)',
      resolveLlmConfig().provider === 'openai',
    );
  });
  await withEnv({ LLM_TEMPERATURE: '0.7' }, async () => {
    check('LLM_TEMPERATURE is read', resolveLlmConfig().temperature === 0.7);
  });

  // ---------- Degraded mode ----------
  await withEnv(
    {
      LLM_PROVIDER: 'openai',
      OPENAI_API_KEY: undefined,
      ANTHROPIC_API_KEY: undefined,
    },
    async () => {
      check('no key => not configured', !isLlmConfigured());
      const r = await evaluateQuality({
        owner: 'a',
        repo: 'b',
        ref: 'main',
        commitSha: 'sha',
        files: [
          { path: 'README.md', content: '# hi', bytes: 4, truncated: false },
        ],
        totalFiles: 1,
        readFiles: 1,
        totalBytes: 4,
        warnings: [],
      });
      check('degraded: aiDegraded=true', r.degraded);
      check('degraded: neutral score 50, no crash', r.score === 50);
      check('degraded: evaluation still returns a result', Boolean(r.summary));
    },
  );

  await withEnv(
    { LLM_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: undefined },
    async () => {
      check(
        'anthropic selected without a key => degraded, not a throw',
        (
          await evaluateQuality({
            owner: 'a',
            repo: 'b',
            ref: 'main',
            commitSha: 's',
            files: [
              {
                path: 'x.ts',
                content: 'export {}',
                bytes: 9,
                truncated: false,
              },
            ],
            totalFiles: 1,
            readFiles: 1,
            totalBytes: 9,
            warnings: [],
          })
        ).degraded,
      );
    },
  );

  // ---------- Live backend (opt-in) ----------
  const liveIndex = process.argv.indexOf('--live');
  if (liveIndex === -1) {
    console.log('\nSKIP  live backend call (pass --live <repoUrl> to enable)');
  } else {
    const repoUrl = process.argv[liveIndex + 1];
    if (!repoUrl) throw new Error('--live requires a repository URL');

    const config = resolveLlmConfig();
    console.log(
      `\nLive run: provider=${config.provider} model=${config.model} temp=${config.temperature}`,
    );
    console.log(`Repository: ${repoUrl}`);

    const snapshot = await readRepoAsText(repoUrl);
    check(
      'repo read as text (no clone)',
      snapshot.readFiles > 0,
      `readFiles=${snapshot.readFiles} warnings=${snapshot.warnings.join('; ')}`,
    );
    console.log(
      `  files read: ${snapshot.readFiles}/${snapshot.totalFiles}, ${snapshot.totalBytes} bytes, commit ${snapshot.commitSha?.slice(0, 8)}`,
    );

    const result = await evaluateQuality(snapshot);
    console.log('\n--- AI quality result ---');
    console.log(`  aiDegraded : ${result.degraded}`);
    console.log(`  modelId    : ${result.modelId}`);
    console.log(`  score      : ${result.score}`);
    console.log(`  breakdown  : ${JSON.stringify(result.breakdown)}`);
    console.log(`  promptHash : ${result.promptHash.slice(0, 16)}…`);
    console.log(`  summary    : ${result.summary}`);
    const raw = result.raw as Record<string, unknown>;
    console.log(
      `  temperature: requested=${String(raw.temperatureRequested)} applied=${String(raw.temperatureApplied)}`,
    );

    check('live: aiDegraded=false', !result.degraded, result.summary);
    check(
      'live: modelId matches LLM_MODEL',
      result.modelId === config.model,
      `expected ${config.model}, got ${result.modelId}`,
    );
    check(
      'live: provider matches LLM_PROVIDER',
      (raw.provider as string) === config.provider,
    );
    check('live: score in range', result.score >= 0 && result.score <= 100);
    check(
      'live: prompt hash recorded for audit',
      result.promptHash.length === 64,
    );
    check(
      'live: rubric breakdown populated',
      typeof result.breakdown.codeOrganization === 'number' &&
        typeof result.breakdown.architecture === 'number',
    );
  }

  console.log(
    failures === 0
      ? '\nAll LLM checks passed.'
      : `\n${failures} check(s) FAILED.`,
  );
}

main()
  .catch((e) => {
    console.error('\nFAIL —', e);
    failures++;
  })
  .finally(() => process.exit(failures > 0 ? 1 : 0));
