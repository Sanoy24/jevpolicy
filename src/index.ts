export {
  PolicyParseError,
  PolicyValidationError,
  ReplayCompatibilityError,
  StateValidationError,
} from './errors.js';
export type { PolicyIssue } from './errors.js';
export {
  SignalValidationError,
  createFallbackDecision,
  evaluateOperator,
  evaluatePolicy,
  evaluatePreconditions,
  evaluateRules,
  validateFacts,
  validateSignals,
} from './core/index.js';
export type {
  BooleanSignal,
  ChoiceSignal,
  ConditionTrace,
  DecisionSignal,
  DecisionTrace,
  DeterministicDecision,
  FactSet,
  FactValue,
  FallbackReason,
  ScoreSignal,
  SignalSet,
  TargetEvaluationTrace,
} from './core/index.js';
export {
  compilePolicy,
  fingerprintQuestion,
  loadPolicyFile,
  parsePolicyText,
} from './policy/index.js';
export type {
  CompiledPolicy,
  CompiledQuestion,
  Condition,
  ConditionValue,
  FactDefinition,
  Operator,
  PolicyDefinition,
  QuestionDefinition,
} from './policy/index.js';
