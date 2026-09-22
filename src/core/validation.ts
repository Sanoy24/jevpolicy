import { StateValidationError } from '../errors.js';
import type { CompiledPolicy, CompiledQuestion } from '../policy/compiler.js';
import type {
  ChoiceSignal,
  DecisionSignal,
  FactSet,
  FactValue,
  ScoreSignal,
  SignalSet,
} from './types.js';

export class SignalValidationError extends Error {
  readonly signalName: string | undefined;

  constructor(message: string, signalName?: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SignalValidationError';
    this.signalName = signalName;
  }
}

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

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isProbability(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0 && value <= 1;
}

function assertOnlyKeys(
  signalName: string,
  signal: Record<string, unknown>,
  allowed: ReadonlySet<string>,
): void {
  const unknownKeys = Object.keys(signal).filter((key) => !allowed.has(key));
  if (unknownKeys.length > 0) {
    throw new SignalValidationError(
      `Signal '${signalName}' contains unknown properties: ${unknownKeys.join(', ')}`,
      signalName,
    );
  }
}

function validateDistribution(
  signalName: string,
  value: unknown,
  allowedKeys: ReadonlySet<string>,
): Readonly<Record<string, number>> | undefined {
  if (value === undefined) return undefined;
  if (!isPlainRecord(value)) {
    throw new SignalValidationError(
      `Signal '${signalName}' probabilities must be an object`,
      signalName,
    );
  }

  const result: Record<string, number> = {};
  for (const [key, probability] of Object.entries(value)) {
    if (!allowedKeys.has(key)) {
      throw new SignalValidationError(
        `Signal '${signalName}' contains probability for unknown key '${key}'`,
        signalName,
      );
    }
    if (!isProbability(probability)) {
      throw new SignalValidationError(
        `Signal '${signalName}' probability '${key}' must be between 0 and 1`,
        signalName,
      );
    }
    result[key] = probability;
  }
  return Object.freeze(result);
}

function optionalConfidence(
  signalName: string,
  value: unknown,
): number | undefined {
  if (value === undefined) return undefined;
  if (!isFiniteNumber(value)) {
    throw new SignalValidationError(
      `Signal '${signalName}' confidence must be a finite number`,
      signalName,
    );
  }
  return value;
}

function validateBooleanSignal(
  signalName: string,
  raw: Record<string, unknown>,
): DecisionSignal {
  assertOnlyKeys(signalName, raw, new Set(['type', 'probabilityTrue']));
  if (!isProbability(raw['probabilityTrue'])) {
    throw new SignalValidationError(
      `Boolean signal '${signalName}' probabilityTrue must be between 0 and 1`,
      signalName,
    );
  }
  return Object.freeze({
    type: 'boolean' as const,
    probabilityTrue: raw['probabilityTrue'],
  });
}

function validateChoiceSignal(
  signalName: string,
  question: Extract<CompiledQuestion, { type: 'choice' }>,
  raw: Record<string, unknown>,
): ChoiceSignal {
  assertOnlyKeys(
    signalName,
    raw,
    new Set(['type', 'value', 'probabilities', 'confidence']),
  );
  if (
    typeof raw['value'] !== 'string' ||
    !(raw['value'] in question.criteria)
  ) {
    throw new SignalValidationError(
      `Choice signal '${signalName}' must select a declared criterion`,
      signalName,
    );
  }

  const probabilities = validateDistribution(
    signalName,
    raw['probabilities'],
    new Set(Object.keys(question.criteria)),
  );
  const confidence = optionalConfidence(signalName, raw['confidence']);
  return Object.freeze({
    type: 'choice' as const,
    value: raw['value'],
    ...(probabilities === undefined ? {} : { probabilities }),
    ...(confidence === undefined ? {} : { confidence }),
  });
}

function validateScoreSignal(
  signalName: string,
  question: Extract<CompiledQuestion, { type: 'score' }>,
  raw: Record<string, unknown>,
): ScoreSignal {
  assertOnlyKeys(
    signalName,
    raw,
    new Set(['type', 'value', 'probabilities', 'confidence']),
  );
  if (
    !isFiniteNumber(raw['value']) ||
    raw['value'] < 0 ||
    raw['value'] > question.criteria.length - 1
  ) {
    throw new SignalValidationError(
      `Score signal '${signalName}' value must be within its rubric range`,
      signalName,
    );
  }

  const rungKeys = new Set(question.criteria.map((_, index) => String(index)));
  const probabilities = validateDistribution(
    signalName,
    raw['probabilities'],
    rungKeys,
  );
  const confidence = optionalConfidence(signalName, raw['confidence']);
  return Object.freeze({
    type: 'score' as const,
    value: raw['value'],
    ...(probabilities === undefined ? {} : { probabilities }),
    ...(confidence === undefined ? {} : { confidence }),
  });
}

function validateSignal(
  signalName: string,
  question: CompiledQuestion,
  raw: unknown,
): DecisionSignal {
  if (!isPlainRecord(raw) || raw['type'] !== question.type) {
    throw new SignalValidationError(
      `Signal '${signalName}' must have type '${question.type}'`,
      signalName,
    );
  }
  switch (question.type) {
    case 'boolean':
      return validateBooleanSignal(signalName, raw);
    case 'choice':
      return validateChoiceSignal(signalName, question, raw);
    case 'score':
      return validateScoreSignal(signalName, question, raw);
  }
}

export function validateSignals(
  policy: CompiledPolicy,
  input: unknown,
): SignalSet {
  return validateSignalsForQuestions(policy.questions, input);
}

export function validateSignalsForQuestions(
  questions: Readonly<Record<string, CompiledQuestion>>,
  input: unknown,
): SignalSet {
  if (!isPlainRecord(input)) {
    throw new SignalValidationError('Signals must be an object');
  }

  const unknownNames = Object.keys(input).filter(
    (name) => !hasOwn(questions, name),
  );
  if (unknownNames.length > 0) {
    throw new SignalValidationError(
      `Signals contain unknown names: ${unknownNames.join(', ')}`,
    );
  }

  const result: Record<string, DecisionSignal> = {};
  for (const [name, question] of Object.entries(questions)) {
    if (!hasOwn(input, name)) {
      throw new SignalValidationError(
        `Required signal '${name}' is missing`,
        name,
      );
    }
    result[name] = validateSignal(name, question, input[name]);
  }
  return Object.freeze(result);
}

export function validateFacts(
  policy: CompiledPolicy,
  input: unknown = {},
): FactSet {
  if (!isPlainRecord(input)) {
    throw new StateValidationError('Facts must be an object');
  }

  const result: Record<string, FactValue | undefined> = {};
  for (const [name, definition] of Object.entries(policy.facts)) {
    const value = hasOwn(input, name) ? input[name] : undefined;
    if (value === undefined) {
      if (definition.required) {
        throw new StateValidationError(`Required fact '${name}' is missing`);
      }
      continue;
    }
    const correctType =
      typeof value === definition.type &&
      (definition.type !== 'number' || Number.isFinite(value));
    if (!correctType) {
      const expectedType =
        definition.type === 'number' ? 'finite number' : definition.type;
      throw new StateValidationError(
        `Fact '${name}' must be a ${expectedType}`,
      );
    }
    result[name] = value as FactValue;
  }
  return Object.freeze(result);
}
