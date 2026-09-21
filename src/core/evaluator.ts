import type { CompiledPolicy } from '../policy/compiler.js';
import type { Condition } from '../policy/schema.js';
import { evaluateOperator } from './operators.js';
import type {
  ConditionTrace,
  DecisionSignal,
  DeterministicDecision,
  FactSet,
  FallbackReason,
  SignalSet,
  TargetEvaluationTrace,
} from './types.js';
import { validateFacts, validateSignals } from './validation.js';

interface EvaluationContext {
  readonly facts: FactSet;
  readonly signals: SignalSet;
}

export interface TargetMatch {
  readonly id: string;
  readonly decision: string;
}

export interface TargetEvaluation {
  readonly match: TargetMatch | null;
  readonly evaluations: readonly TargetEvaluationTrace[];
}

function signalValue(signal: DecisionSignal): string | number {
  switch (signal.type) {
    case 'boolean':
      return signal.probabilityTrue;
    case 'choice':
    case 'score':
      return signal.value;
  }
}

function evaluateCondition(
  condition: Condition,
  context: EvaluationContext,
): ConditionTrace {
  if ('all' in condition) {
    const children: ConditionTrace[] = [];
    let passed = true;
    for (const child of condition.all) {
      const trace = evaluateCondition(child, context);
      children.push(trace);
      if (!trace.passed) {
        passed = false;
        break;
      }
    }
    return { kind: 'all', children, passed };
  }

  if ('any' in condition) {
    const children: ConditionTrace[] = [];
    let passed = false;
    for (const child of condition.any) {
      const trace = evaluateCondition(child, context);
      children.push(trace);
      if (trace.passed) {
        passed = true;
        break;
      }
    }
    return { kind: 'any', children, passed };
  }

  if ('not' in condition) {
    const child = evaluateCondition(condition.not, context);
    return { kind: 'not', child, passed: !child.passed };
  }

  if ('fact' in condition) {
    const observed = context.facts[condition.fact];
    const missing = observed === undefined;
    return {
      kind: 'fact',
      name: condition.fact,
      operator: condition.op,
      expected: condition.value,
      observed: observed ?? null,
      missing,
      passed:
        !missing && evaluateOperator(observed, condition.op, condition.value),
    };
  }

  const signal = context.signals[condition.signal];
  if (signal === undefined) {
    throw new Error(`Validated signal '${condition.signal}' is unavailable`);
  }
  const observed = signalValue(signal);
  return {
    kind: 'signal',
    name: condition.signal,
    operator: condition.op,
    expected: condition.value,
    observed,
    missing: false,
    passed: evaluateOperator(observed, condition.op, condition.value),
  };
}

type DecisionTarget = CompiledPolicy['rules'][number];

function evaluateTargets(
  targets: readonly DecisionTarget[],
  phase: 'precondition' | 'rule',
  context: EvaluationContext,
): TargetEvaluation {
  const evaluations: TargetEvaluationTrace[] = [];
  for (const target of targets) {
    const condition = evaluateCondition(target.when, context);
    evaluations.push({
      phase,
      id: target.id,
      decision: target.decision,
      matched: condition.passed,
      condition,
    });
    if (condition.passed) {
      return {
        match: { id: target.id, decision: target.decision },
        evaluations,
      };
    }
  }
  return { match: null, evaluations };
}

function evaluatePreconditionsWithFacts(
  policy: CompiledPolicy,
  facts: FactSet,
): TargetEvaluation {
  return evaluateTargets(policy.preconditions, 'precondition', {
    facts,
    signals: {},
  });
}

function evaluateRulesWithInputs(
  policy: CompiledPolicy,
  facts: FactSet,
  signals: SignalSet,
): TargetEvaluation {
  return evaluateTargets(policy.rules, 'rule', { facts, signals });
}

export function evaluatePreconditions(
  policy: CompiledPolicy,
  factsInput: unknown = {},
): TargetEvaluation {
  return evaluatePreconditionsWithFacts(
    policy,
    validateFacts(policy, factsInput),
  );
}

export function evaluateRules(
  policy: CompiledPolicy,
  factsInput: unknown,
  signalsInput: unknown,
): TargetEvaluation {
  return evaluateRulesWithInputs(
    policy,
    validateFacts(policy, factsInput),
    validateSignals(policy, signalsInput),
  );
}

export function createFallbackDecision(
  policy: CompiledPolicy,
  reason: FallbackReason,
  evaluations: readonly TargetEvaluationTrace[] = [],
): DeterministicDecision {
  return {
    decision: policy.fallback[reason],
    matched: {},
    fallback: { used: true, reason },
    trace: { source: 'fallback', evaluations },
  };
}

export interface EvaluatePolicyInput {
  readonly policy: CompiledPolicy;
  readonly facts?: unknown;
  readonly signals?: unknown;
  readonly mode?: 'live' | 'replay';
}

export function evaluatePolicy({
  policy,
  facts: factsInput = {},
  signals: signalsInput,
  mode = 'live',
}: EvaluatePolicyInput): DeterministicDecision {
  const facts = validateFacts(policy, factsInput);
  const preconditions = evaluatePreconditionsWithFacts(policy, facts);
  if (preconditions.match !== null) {
    return {
      decision: preconditions.match.decision,
      matched: { preconditionId: preconditions.match.id },
      fallback: { used: false },
      trace: {
        source: 'precondition',
        evaluations: preconditions.evaluations,
      },
    };
  }

  const signals = validateSignals(policy, signalsInput);
  const rules = evaluateRulesWithInputs(policy, facts, signals);
  const evaluations = [...preconditions.evaluations, ...rules.evaluations];
  if (rules.match !== null) {
    return {
      decision: rules.match.decision,
      matched: { ruleId: rules.match.id },
      fallback: { used: false },
      trace: {
        source: mode === 'replay' ? 'replay_policy_rule' : 'policy_rule',
        evaluations,
      },
    };
  }

  return createFallbackDecision(policy, 'no_match', evaluations);
}
