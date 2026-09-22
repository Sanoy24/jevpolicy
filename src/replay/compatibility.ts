import { evaluatePolicy } from '../core/evaluator.js';
import { validateFacts, validateSignals } from '../core/validation.js';
import { ReplayCompatibilityError } from '../errors.js';
import type { CompiledPolicy } from '../policy/compiler.js';
import type { DecisionRecord } from '../recorders/types.js';
import type {
  ReplayBatchResult,
  ReplayDecisionResult,
  ReplaySummary,
  ReplayTransition,
} from './types.js';

interface ReplayInputs {
  readonly facts: ReturnType<typeof validateFacts>;
  readonly signals: ReturnType<typeof validateSignals>;
}

export function validateReplayCompatibility(
  record: DecisionRecord,
  policy: CompiledPolicy,
): ReplayInputs {
  if (record.policy.name !== policy.name) {
    throw new ReplayCompatibilityError(
      `Record policy '${record.policy.name}' cannot be replayed against '${policy.name}'`,
    );
  }

  const signals: Record<string, unknown> = {};
  for (const [name, question] of Object.entries(policy.questions)) {
    const recorded = record.signals[name];
    if (recorded === undefined) {
      throw new ReplayCompatibilityError(
        `Record '${record.decisionId}' is missing signal '${name}'`,
      );
    }
    if (recorded.questionFingerprint !== question.fingerprint) {
      throw new ReplayCompatibilityError(
        `Signal '${name}' in record '${record.decisionId}' was produced by a different question definition`,
      );
    }
    signals[name] = recorded.signal;
  }

  try {
    return {
      facts: validateFacts(policy, record.facts),
      signals: validateSignals(policy, signals),
    };
  } catch (error) {
    throw new ReplayCompatibilityError(
      `Record '${record.decisionId}' is incompatible with the candidate policy`,
      { cause: error },
    );
  }
}

export function replayDecision(
  record: DecisionRecord,
  policy: CompiledPolicy,
): ReplayDecisionResult {
  const { facts, signals } = validateReplayCompatibility(record, policy);
  const candidate = evaluatePolicy({
    policy,
    facts,
    signals,
    mode: 'replay',
  });

  return Object.freeze({
    decisionId: record.decisionId,
    originalDecision: record.originalDecision,
    candidateDecision: candidate.decision,
    changed: record.originalDecision !== candidate.decision,
    ...(record.matched.ruleId === undefined
      ? {}
      : { originalMatchedRule: record.matched.ruleId }),
    ...(candidate.matched.ruleId === undefined
      ? {}
      : { candidateMatchedRule: candidate.matched.ruleId }),
    ...(record.matched.preconditionId === undefined
      ? {}
      : { originalMatchedPrecondition: record.matched.preconditionId }),
    ...(candidate.matched.preconditionId === undefined
      ? {}
      : { candidateMatchedPrecondition: candidate.matched.preconditionId }),
  });
}

export function summarizeReplay(
  results: readonly ReplayDecisionResult[],
): ReplaySummary {
  const transitions = new Map<string, ReplayTransition>();
  let changed = 0;
  for (const result of results) {
    if (!result.changed) continue;
    changed += 1;
    const key = `${result.originalDecision}\u0000${result.candidateDecision}`;
    const existing = transitions.get(key);
    transitions.set(key, {
      from: result.originalDecision,
      to: result.candidateDecision,
      count: (existing?.count ?? 0) + 1,
    });
  }
  return Object.freeze({
    records: results.length,
    unchanged: results.length - changed,
    changed,
    transitions: Object.freeze(
      [...transitions.values()].sort(
        (left, right) =>
          right.count - left.count ||
          left.from.localeCompare(right.from) ||
          left.to.localeCompare(right.to),
      ),
    ),
  });
}

export function replayRecords(
  records: readonly DecisionRecord[],
  policy: CompiledPolicy,
): ReplayBatchResult {
  const results = Object.freeze(
    records.map((record) => replayDecision(record, policy)),
  );
  return Object.freeze({ results, summary: summarizeReplay(results) });
}
