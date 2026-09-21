export {
  createFallbackDecision,
  evaluatePolicy,
  evaluatePreconditions,
  evaluateRules,
} from './evaluator.js';
export type {
  EvaluatePolicyInput,
  TargetEvaluation,
  TargetMatch,
} from './evaluator.js';
export { evaluateOperator } from './operators.js';
export {
  SignalValidationError,
  validateFacts,
  validateSignals,
} from './validation.js';
export type {
  AllConditionTrace,
  AnyConditionTrace,
  BooleanSignal,
  ChoiceSignal,
  ConditionTrace,
  DecisionMatch,
  DecisionSignal,
  DecisionTrace,
  DecisionTraceSource,
  DeterministicDecision,
  FactSet,
  FactValue,
  FallbackReason,
  LeafConditionTrace,
  NotConditionTrace,
  ScoreSignal,
  SignalSet,
  TargetEvaluationTrace,
} from './types.js';
