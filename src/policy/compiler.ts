import { createHash } from 'node:crypto';

import { PolicyValidationError, type PolicyIssue } from '../errors.js';
import {
  policySchema,
  type Condition,
  type ConditionValue,
  type FactDefinition,
  type Operator,
  type PolicyDefinition,
  type QuestionDefinition,
} from './schema.js';

export type CompiledQuestion = QuestionDefinition & {
  readonly fingerprint: string;
};

export type CompiledPolicy = Omit<PolicyDefinition, 'questions'> & {
  readonly questions: Readonly<Record<string, CompiledQuestion>>;
  readonly fingerprint: string;
};

const numericOperators = new Set<Operator>([
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
]);
const equalityOperators = new Set<Operator>(['eq', 'neq']);
const stringOperators = new Set<Operator>(['eq', 'neq', 'in', 'not_in']);
const choiceOperators = stringOperators;

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function questionFingerprintInput(question: QuestionDefinition): unknown {
  switch (question.type) {
    case 'boolean':
      return {
        type: question.type,
        instructions: question.instructions,
        ...(question.criteria === undefined
          ? {}
          : {
              criteria: [
                ['true', question.criteria.true],
                ['false', question.criteria.false],
              ],
            }),
      };
    case 'choice':
      return {
        type: question.type,
        instructions: question.instructions,
        criteria: Object.entries(question.criteria),
      };
    case 'score':
      return {
        type: question.type,
        instructions: question.instructions,
        criteria: question.criteria,
      };
  }
}

export function fingerprintQuestion(question: QuestionDefinition): string {
  return digest(questionFingerprintInput(question));
}

function issue(path: string, message: string, code = 'semantic'): PolicyIssue {
  return { path, message, code };
}

function isNumber(value: ConditionValue): value is number {
  return typeof value === 'number';
}

function isString(value: ConditionValue): value is string {
  return typeof value === 'string';
}

function isBoolean(value: ConditionValue): value is boolean {
  return typeof value === 'boolean';
}

function isStringArray(value: ConditionValue): value is string[] {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === 'string')
  );
}

function validateFactCondition(
  factName: string,
  operator: Operator,
  value: ConditionValue,
  definition: FactDefinition,
  path: string,
  issues: PolicyIssue[],
): void {
  const valid =
    definition.type === 'number'
      ? numericOperators.has(operator) && isNumber(value)
      : definition.type === 'boolean'
        ? equalityOperators.has(operator) && isBoolean(value)
        : stringOperators.has(operator) &&
          (operator === 'in' || operator === 'not_in'
            ? isStringArray(value)
            : isString(value));

  if (!valid) {
    issues.push(
      issue(
        path,
        `operator '${operator}' and its value are incompatible with ${definition.type} fact '${factName}'`,
        'invalid_fact_operator',
      ),
    );
  }
}

function validateSignalCondition(
  signalName: string,
  operator: Operator,
  value: ConditionValue,
  question: QuestionDefinition,
  path: string,
  issues: PolicyIssue[],
): void {
  if (question.type === 'boolean') {
    if (!numericOperators.has(operator) || !isNumber(value)) {
      issues.push(
        issue(
          path,
          `boolean signal '${signalName}' compares probabilityTrue and requires a numeric operator and value`,
          'invalid_signal_operator',
        ),
      );
      return;
    }
    if (value < 0 || value > 1) {
      issues.push(
        issue(
          `${path}.value`,
          `boolean probability threshold for '${signalName}' must be between 0 and 1`,
          'invalid_probability_threshold',
        ),
      );
    }
    return;
  }

  if (question.type === 'score') {
    if (!numericOperators.has(operator) || !isNumber(value)) {
      issues.push(
        issue(
          path,
          `score signal '${signalName}' requires a numeric operator and value`,
          'invalid_signal_operator',
        ),
      );
      return;
    }
    if (value < 0 || value > question.criteria.length - 1) {
      issues.push(
        issue(
          `${path}.value`,
          `score threshold for '${signalName}' must be between 0 and ${question.criteria.length - 1}`,
          'invalid_score_threshold',
        ),
      );
    }
    return;
  }

  const correctlyTyped =
    choiceOperators.has(operator) &&
    (operator === 'in' || operator === 'not_in'
      ? isStringArray(value)
      : isString(value));
  if (!correctlyTyped) {
    issues.push(
      issue(
        path,
        `choice signal '${signalName}' requires eq/neq with a string or in/not_in with a string array`,
        'invalid_signal_operator',
      ),
    );
    return;
  }

  const comparedValues = Array.isArray(value) ? value : [value];
  for (const comparedValue of comparedValues) {
    if (
      typeof comparedValue !== 'string' ||
      !(comparedValue in question.criteria)
    ) {
      issues.push(
        issue(
          `${path}.value`,
          `choice value '${String(comparedValue)}' is not declared by signal '${signalName}'`,
          'unknown_choice_value',
        ),
      );
    }
  }
}

interface ConditionValidationContext {
  readonly policy: PolicyDefinition;
  readonly allowSignals: boolean;
  readonly path: string;
  readonly issues: PolicyIssue[];
}

function validateCondition(
  condition: Condition,
  context: ConditionValidationContext,
): void {
  if ('all' in condition) {
    condition.all.forEach((child, index) =>
      validateCondition(child, {
        ...context,
        path: `${context.path}.all.${index}`,
      }),
    );
    return;
  }
  if ('any' in condition) {
    condition.any.forEach((child, index) =>
      validateCondition(child, {
        ...context,
        path: `${context.path}.any.${index}`,
      }),
    );
    return;
  }
  if ('not' in condition) {
    validateCondition(condition.not, {
      ...context,
      path: `${context.path}.not`,
    });
    return;
  }
  if ('fact' in condition) {
    const definition = context.policy.facts[condition.fact];
    if (definition === undefined) {
      context.issues.push(
        issue(
          `${context.path}.fact`,
          `fact '${condition.fact}' is not declared`,
          'unknown_fact',
        ),
      );
      return;
    }
    validateFactCondition(
      condition.fact,
      condition.op,
      condition.value,
      definition,
      context.path,
      context.issues,
    );
    return;
  }

  if (!context.allowSignals) {
    context.issues.push(
      issue(
        `${context.path}.signal`,
        'preconditions may reference only deterministic facts',
        'signal_in_precondition',
      ),
    );
    return;
  }
  const question = context.policy.questions[condition.signal];
  if (question === undefined) {
    context.issues.push(
      issue(
        `${context.path}.signal`,
        `signal '${condition.signal}' is not declared`,
        'unknown_signal',
      ),
    );
    return;
  }
  validateSignalCondition(
    condition.signal,
    condition.op,
    condition.value,
    question,
    context.path,
    context.issues,
  );
}

function validateSemantics(policy: PolicyDefinition): readonly PolicyIssue[] {
  const issues: PolicyIssue[] = [];
  const decisions = new Set<string>();
  policy.decisions.forEach((decision, index) => {
    if (decisions.has(decision)) {
      issues.push(
        issue(
          `decisions.${index}`,
          `decision '${decision}' is duplicated`,
          'duplicate_decision',
        ),
      );
    }
    decisions.add(decision);
  });

  const ids = new Set<string>();
  const targets = [
    ...policy.preconditions.map((target, index) => ({
      target,
      path: `preconditions.${index}`,
      allowSignals: false,
    })),
    ...policy.rules.map((target, index) => ({
      target,
      path: `rules.${index}`,
      allowSignals: true,
    })),
  ];

  for (const { target, path, allowSignals } of targets) {
    if (ids.has(target.id)) {
      issues.push(
        issue(`${path}.id`, `id '${target.id}' is duplicated`, 'duplicate_id'),
      );
    }
    ids.add(target.id);
    if (!decisions.has(target.decision)) {
      issues.push(
        issue(
          `${path}.decision`,
          `decision '${target.decision}' is not declared`,
          'unknown_decision',
        ),
      );
    }
    validateCondition(target.when, {
      policy,
      allowSignals,
      path: `${path}.when`,
      issues,
    });
  }

  for (const [reason, decision] of Object.entries(policy.fallback)) {
    if (!decisions.has(decision)) {
      issues.push(
        issue(
          `fallback.${reason}`,
          `fallback decision '${decision}' is not declared`,
          'unknown_decision',
        ),
      );
    }
  }

  return issues;
}

function policyFingerprintInput(policy: PolicyDefinition): unknown {
  return {
    schema: policy.schema,
    name: policy.name,
    version: policy.version,
    description: policy.description,
    decisions: policy.decisions,
    facts: Object.entries(policy.facts).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
    questions: Object.entries(policy.questions)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, question]) => [name, questionFingerprintInput(question)]),
    preconditions: policy.preconditions,
    rules: policy.rules,
    fallback: policy.fallback,
    recording: policy.recording,
  };
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
}

export function compilePolicy(input: unknown): CompiledPolicy {
  const parsed = policySchema.safeParse(input);
  if (!parsed.success) {
    throw new PolicyValidationError(
      parsed.error.issues.map((entry) => ({
        path: entry.path.join('.'),
        message: entry.message,
        code: entry.code,
      })),
    );
  }

  const semanticIssues = validateSemantics(parsed.data);
  if (semanticIssues.length > 0) {
    throw new PolicyValidationError(semanticIssues);
  }

  const questions = Object.fromEntries(
    Object.entries(parsed.data.questions).map(([name, question]) => [
      name,
      { ...question, fingerprint: fingerprintQuestion(question) },
    ]),
  );
  const compiled: CompiledPolicy = {
    ...parsed.data,
    questions,
    fingerprint: digest(policyFingerprintInput(parsed.data)),
  };
  return deepFreeze(compiled);
}
