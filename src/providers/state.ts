import { StateValidationError } from '../errors.js';
import type { EvaluationState } from './types.js';

function isPlainRecord(value: object): value is Record<string, unknown> {
  if (Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function validateJsonValue(
  value: unknown,
  path: string,
  ancestors: Set<object>,
): void {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return;
  }
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return;
    throw new StateValidationError(`${path} must contain only finite numbers`);
  }
  if (typeof value !== 'object') {
    throw new StateValidationError(`${path} must be JSON-compatible`);
  }
  if (ancestors.has(value)) {
    throw new StateValidationError(`${path} must not contain cycles`);
  }
  if (!Array.isArray(value) && !isPlainRecord(value)) {
    throw new StateValidationError(
      `${path} must contain only arrays and plain objects`,
    );
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new StateValidationError(`${path} must not contain symbol keys`);
  }

  ancestors.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      validateJsonValue(item, `${path}[${index}]`, ancestors),
    );
  } else {
    for (const [key, child] of Object.entries(value)) {
      validateJsonValue(child, `${path}.${key}`, ancestors);
    }
  }
  ancestors.delete(value);
}

export function validateEvaluationState(input: unknown): EvaluationState {
  if (
    typeof input !== 'string' &&
    !Array.isArray(input) &&
    (input === null || typeof input !== 'object' || !isPlainRecord(input))
  ) {
    throw new StateValidationError(
      'State must be a JSON-compatible string, object, or array',
    );
  }
  validateJsonValue(input, 'State', new Set());
  return input as EvaluationState;
}
