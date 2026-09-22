import type { SignalSet } from '../core/types.js';
import type { CompiledQuestion } from '../policy/compiler.js';

export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export type EvaluationState = string | JsonObject | readonly JsonValue[];

export interface ProviderEvaluationRequest {
  readonly state: EvaluationState;
  readonly questions: Readonly<Record<string, CompiledQuestion>>;
}

export interface ProviderEvaluationOptions {
  readonly abortSignal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
}

export interface ProviderUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
}

export interface GatewayMetadata {
  readonly generationId?: string;
  readonly cost?: string;
  readonly resolvedProvider?: string;
}

export interface ProviderEvaluationResult {
  readonly signals: SignalSet;
  readonly usage?: ProviderUsage;
  readonly gateway?: GatewayMetadata;
}

export interface DecisionProvider {
  readonly adapter: string;
  readonly model: string;

  evaluate(
    request: ProviderEvaluationRequest,
    options?: ProviderEvaluationOptions,
  ): Promise<ProviderEvaluationResult>;
}
