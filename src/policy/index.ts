export { compilePolicy, fingerprintQuestion } from './compiler.js';
export type { CompiledPolicy, CompiledQuestion } from './compiler.js';
export { loadPolicyFile, parsePolicyText } from './loader.js';
export type {
  Condition,
  ConditionValue,
  FactDefinition,
  Operator,
  PolicyDefinition,
  QuestionDefinition,
} from './schema.js';
