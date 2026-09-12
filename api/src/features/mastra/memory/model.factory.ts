import { createGateway } from '@ai-sdk/gateway';
import type { MastraModelConfig } from '@mastra/core/llm';
import type { MastraConfig } from '../../../config/configurations/mastra.config';

/**
 * Returns a Vercel AI Gateway model object for the configured slug.
 * Model string is 'creator/model' (dots for versions), e.g. 'anthropic/claude-sonnet-4.6'.
 * Confirmed installed: `@ai-sdk/gateway@4.0.20` exports `createGateway({ apiKey })` returning a
 * `GatewayProvider`, which is callable as `gateway(modelId)` -> `LanguageModelV4`. `GatewayModelId`
 * includes a `(string & {})` fallback member, so a plain env-sourced `cfg.model` string is accepted.
 *
 * The explicit `MastraModelConfig` return annotation (deviation from the brief, which left the
 * return type inferred) is required: the raw inferred return type is `LanguageModelV4` from
 * `@ai-sdk/provider`, a transitive dependency reachable only through pnpm's nested
 * `.pnpm/@ai-sdk+gateway@.../node_modules/@ai-sdk/provider`, not hoisted to the top-level
 * `node_modules`. With `declaration: true` in tsconfig, tsc must be able to name every exported
 * function's inferred type in a portable way; it cannot name a `.pnpm`-nested path, and errors
 * with TS2742. `MastraModelConfig` (from `@mastra/core`, a direct, top-level dependency) is a
 * union that includes the equivalent `LanguageModelV4` shape, so the annotation is both portable
 * and structurally accurate for what `Agent`'s `model` field (consumed by later tasks) expects.
 */
export function buildModel(cfg: MastraConfig): MastraModelConfig {
  const gateway = createGateway({ apiKey: cfg.aiGatewayApiKey });
  return gateway(cfg.model);
}
