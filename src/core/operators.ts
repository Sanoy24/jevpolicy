import type { ConditionValue, Operator } from '../policy/schema.js';
import type { FactValue } from './types.js';

function numberOperands(
  observed: FactValue,
  expected: ConditionValue,
  operator: Operator,
): readonly [number, number] {
  if (typeof observed !== 'number' || typeof expected !== 'number') {
    throw new TypeError(`Operator '${operator}' requires numeric operands`);
  }
  return [observed, expected];
}

export function evaluateOperator(
  observed: FactValue,
  operator: Operator,
  expected: ConditionValue,
): boolean {
  switch (operator) {
    case 'eq':
      return observed === expected;
    case 'neq':
      return observed !== expected;
    case 'gt': {
      const [left, right] = numberOperands(observed, expected, operator);
      return left > right;
    }
    case 'gte': {
      const [left, right] = numberOperands(observed, expected, operator);
      return left >= right;
    }
    case 'lt': {
      const [left, right] = numberOperands(observed, expected, operator);
      return left < right;
    }
    case 'lte': {
      const [left, right] = numberOperands(observed, expected, operator);
      return left <= right;
    }
    case 'in':
      if (!Array.isArray(expected)) {
        throw new TypeError(
          "Operator 'in' requires an array as its expected value",
        );
      }
      return expected.some((candidate) => candidate === observed);
    case 'not_in':
      if (!Array.isArray(expected)) {
        throw new TypeError(
          "Operator 'not_in' requires an array as its expected value",
        );
      }
      return expected.every((candidate) => candidate !== observed);
  }
}
