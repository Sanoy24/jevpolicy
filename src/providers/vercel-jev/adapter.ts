import { gateway, GatewayError } from '@ai-sdk/gateway';
import { InvalidResponseDataError } from '@ai-sdk/provider';
import {
  RetryError,
  experimental_evaluate as evaluate,
  type Experimental_EvaluationQuestion as EvaluationQuestion,
  type Experimental_EvaluationResult as EvaluationResult,
} from 'ai';

import {
  ProviderError,
  ProviderResponseError,
  ProviderTimeoutError,
} from '../../errors.js';
import type { CompiledQuestion } from '../../policy/compiler.js';
import { validateSignalsForQuestions } from '../../core/validation.js';
import { validateEvaluationState } from '../state.js';
import type {
  DecisionProvider,
  GatewayMetadata,
  ProviderEvaluationOptions,
  ProviderEvaluationRequest,
  ProviderEvaluationResult,
  ProviderUsage,
} from '../types.js';

export const VERCEL_JEV_ADAPTER = 'vercel-jev' as const;
export const VERCEL_JEV_MODEL = 'typesafe-ai/jev' as const;

type EvaluationQuestions = Record<string, EvaluationQuestion>;
type JevEvaluationResult = EvaluationResult<EvaluationQuestions>;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function mapQuestions(
  questions: Readonly<Record<string, CompiledQuestion>>,
): EvaluationQuestions {
  const mapped: EvaluationQuestions = {};
  for (const [name, question] of Object.entries(questions)) {
    switch (question.type) {
      case 'boolean':
        mapped[name] = {
          type: 'boolean',
          instructions: question.instructions,
          ...(question.criteria === undefined
            ? {}
            : { criteria: question.criteria }),
        };
        break;
      case 'choice':
        mapped[name] = {
          type: 'choice',
          instructions: question.instructions,
          criteria: question.criteria,
        };
        break;
      case 'score':
        mapped[name] = {
          type: 'score',
          instructions: question.instructions,
          criteria: question.criteria,
        };
        break;
    }
  }
  return mapped;
}

function normalizeAnswers(
  questions: Readonly<Record<string, CompiledQuestion>>,
  result: JevEvaluationResult,
) {
  if (!isPlainRecord(result.answers)) {
    throw new ProviderResponseError('Provider answers must be an object', {
      provider: VERCEL_JEV_ADAPTER,
      model: VERCEL_JEV_MODEL,
    });
  }

  const expectedNames = Object.keys(questions);
  if (
    Object.keys(result.answers).length !== expectedNames.length ||
    expectedNames.some((name) => !hasOwn(result.answers, name))
  ) {
    throw new ProviderResponseError(
      'Provider must return exactly one answer for every question',
      { provider: VERCEL_JEV_ADAPTER, model: VERCEL_JEV_MODEL },
    );
  }

  const signals: Record<string, unknown> = {};
  for (const [name, question] of Object.entries(questions)) {
    const answer = result.answers[name] as unknown;
    if (!isPlainRecord(answer) || answer['type'] !== question.type) {
      throw new ProviderResponseError(
        `Provider returned the wrong answer type for question '${name}'`,
        { provider: VERCEL_JEV_ADAPTER, model: VERCEL_JEV_MODEL },
      );
    }
    switch (question.type) {
      case 'boolean':
        signals[name] = {
          type: 'boolean',
          probabilityTrue: answer['probability'],
        };
        break;
      case 'choice':
        signals[name] = {
          type: 'choice',
          value: answer['choice'],
          ...(answer['probabilities'] === undefined
            ? {}
            : { probabilities: answer['probabilities'] }),
        };
        break;
      case 'score':
        signals[name] = {
          type: 'score',
          value: answer['score'],
          ...(answer['probabilities'] === undefined
            ? {}
            : { probabilities: answer['probabilities'] }),
        };
        break;
    }
  }

  try {
    return validateSignalsForQuestions(questions, signals);
  } catch (error) {
    throw new ProviderResponseError('Provider returned invalid answers', {
      provider: VERCEL_JEV_ADAPTER,
      model: VERCEL_JEV_MODEL,
      cause: error,
    });
  }
}

function optionalUsage(result: JevEvaluationResult): ProviderUsage | undefined {
  const { inputTokens, outputTokens } = result.usage;
  if (inputTokens === undefined && outputTokens === undefined) return undefined;
  return {
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
  };
}

function optionalString(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function optionalGatewayMetadata(
  result: JevEvaluationResult,
): GatewayMetadata | undefined {
  const metadata = result.providerMetadata;
  if (!isPlainRecord(metadata) || !isPlainRecord(metadata['gateway'])) {
    return undefined;
  }
  const gatewayMetadata = metadata['gateway'];
  const routing = isPlainRecord(gatewayMetadata['routing'])
    ? gatewayMetadata['routing']
    : undefined;
  const generationId = optionalString(gatewayMetadata, 'generationId');
  const cost = optionalString(gatewayMetadata, 'cost');
  const resolvedProvider =
    optionalString(gatewayMetadata, 'resolvedProvider') ??
    (routing === undefined
      ? undefined
      : optionalString(routing, 'resolvedProvider'));
  if (
    generationId === undefined &&
    cost === undefined &&
    resolvedProvider === undefined
  ) {
    return undefined;
  }
  return {
    ...(generationId === undefined ? {} : { generationId }),
    ...(cost === undefined ? {} : { cost }),
    ...(resolvedProvider === undefined ? {} : { resolvedProvider }),
  };
}

function isNestedInvalidResponse(error: unknown): boolean {
  return (
    InvalidResponseDataError.isInstance(error) ||
    (RetryError.isInstance(error) &&
      InvalidResponseDataError.isInstance(error.lastError))
  );
}

function isNestedGatewayTimeout(error: unknown): boolean {
  return (
    (GatewayError.isInstance(error) && error.statusCode === 408) ||
    (RetryError.isInstance(error) &&
      GatewayError.isInstance(error.lastError) &&
      error.lastError.statusCode === 408)
  );
}

function validateOptions(options: ProviderEvaluationOptions): void {
  if (
    options.timeoutMs !== undefined &&
    (!Number.isInteger(options.timeoutMs) || options.timeoutMs <= 0)
  ) {
    throw new RangeError('timeoutMs must be a positive integer');
  }
  if (
    options.maxRetries !== undefined &&
    (!Number.isInteger(options.maxRetries) || options.maxRetries < 0)
  ) {
    throw new RangeError('maxRetries must be a non-negative integer');
  }
}

export class VercelJevProvider implements DecisionProvider {
  readonly adapter = VERCEL_JEV_ADAPTER;
  readonly model = VERCEL_JEV_MODEL;

  async evaluate(
    request: ProviderEvaluationRequest,
    options: ProviderEvaluationOptions = {},
  ): Promise<ProviderEvaluationResult> {
    validateOptions(options);
    const state = validateEvaluationState(request.state);
    const questions = mapQuestions(request.questions);
    const timeoutSignal =
      options.timeoutMs === undefined
        ? undefined
        : AbortSignal.timeout(options.timeoutMs);
    const abortSignal =
      options.abortSignal === undefined
        ? timeoutSignal
        : timeoutSignal === undefined
          ? options.abortSignal
          : AbortSignal.any([options.abortSignal, timeoutSignal]);

    let result: JevEvaluationResult;
    try {
      result = await evaluate({
        model: gateway.evaluationModel(VERCEL_JEV_MODEL),
        state,
        questions,
        ...(options.maxRetries === undefined
          ? {}
          : { maxRetries: options.maxRetries }),
        ...(abortSignal === undefined ? {} : { abortSignal }),
      });
    } catch (error) {
      if (timeoutSignal?.aborted === true || isNestedGatewayTimeout(error)) {
        throw new ProviderTimeoutError('Provider evaluation timed out', {
          provider: this.adapter,
          model: this.model,
          cause: error,
        });
      }
      if (isNestedInvalidResponse(error)) {
        throw new ProviderResponseError(
          'Provider returned an invalid response',
          {
            provider: this.adapter,
            model: this.model,
            cause: error,
          },
        );
      }
      throw new ProviderError('Provider evaluation failed', {
        provider: this.adapter,
        model: this.model,
        cause: error,
      });
    }

    const signals = normalizeAnswers(request.questions, result);
    const usage = optionalUsage(result);
    const gatewayMetadata = optionalGatewayMetadata(result);
    return Object.freeze({
      signals,
      ...(usage === undefined ? {} : { usage: Object.freeze(usage) }),
      ...(gatewayMetadata === undefined
        ? {}
        : { gateway: Object.freeze(gatewayMetadata) }),
    });
  }
}
