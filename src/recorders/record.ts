import { createHash } from 'node:crypto';

import { validateFacts } from '../core/validation.js';
import { StateValidationError } from '../errors.js';
import type { CompiledPolicy } from '../policy/compiler.js';
import { validateEvaluationState } from '../providers/state.js';
import type { EvaluationState, JsonValue } from '../providers/types.js';
import type { DecisionEnvelope } from '../runtime/types.js';
import type {
  DecisionRecord,
  RecordedSignal,
  StateRedactor,
} from './types.js';

function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    const items = value as readonly JsonValue[];
    return `[${items.map((item) => canonicalJson(item)).join(',')}]`;
  }
  const record = value as Readonly<Record<string, JsonValue>>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key]!)}`)
    .join(',')}}`;
}

export function fingerprintState(state: EvaluationState): string {
  return createHash('sha256').update(canonicalJson(state)).digest('hex');
}

export interface CreateDecisionRecordInput {
  readonly policy: CompiledPolicy;
  readonly envelope: DecisionEnvelope;
  readonly state: EvaluationState;
  readonly facts?: unknown;
  readonly redactState?: StateRedactor;
}

export async function createDecisionRecord({
  policy,
  envelope,
  state,
  facts = {},
  redactState,
}: CreateDecisionRecordInput): Promise<DecisionRecord> {
  const validatedFacts = validateFacts(policy, facts);
  const signals: Record<string, RecordedSignal> = {};
  for (const [name, signal] of Object.entries(envelope.signals)) {
    const question = policy.questions[name];
    if (question === undefined) {
      throw new StateValidationError(
        `Cannot record undeclared signal '${name}'`,
      );
    }
    signals[name] = Object.freeze({
      questionFingerprint: question.fingerprint,
      signal,
    });
  }

  let recordedState: EvaluationState | undefined;
  let stateFingerprint: string | undefined;
  if (policy.recording.state !== 'none') {
    const validatedState = validateEvaluationState(state);
    stateFingerprint = fingerprintState(validatedState);
    if (policy.recording.state === 'full') {
      recordedState = validatedState;
    } else {
      if (redactState === undefined) {
        throw new StateValidationError(
          "Policy recording mode 'redacted' requires a state redactor",
        );
      }
      recordedState = validateEvaluationState(await redactState(validatedState));
    }
  }

  return Object.freeze({
    format: 'jevpolicy.record/v1' as const,
    decisionId: envelope.decisionId,
    timestamp: envelope.timestamp,
    policy: Object.freeze({
      name: policy.name,
      version: policy.version,
      fingerprint: policy.fingerprint,
    }),
    ...(recordedState === undefined ? {} : { state: recordedState }),
    ...(stateFingerprint === undefined ? {} : { stateFingerprint }),
    facts: validatedFacts,
    signals: Object.freeze(signals),
    originalDecision: envelope.decision,
    matched: envelope.matched,
    provider: envelope.provider,
    mode: envelope.mode,
  });
}
