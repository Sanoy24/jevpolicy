export { compilePolicy, fingerprintQuestion } from './compiler.js';
export type { CompiledPolicy, CompiledQuestion } from './compiler.js';
export { diffPolicies } from './diff.js';
export type {
  PolicyChange,
  PolicyChangeCategory,
  PolicyChangeKind,
  PolicyDiff,
  PolicyDiffIdentity,
  PolicyDiffSummary,
} from './diff.js';
export { loadPolicyFile, parsePolicyText } from './loader.js';
export type {
  Condition,
  ConditionValue,
  FactDefinition,
  Operator,
  PolicyDefinition,
  QuestionDefinition,
} from './schema.js';
