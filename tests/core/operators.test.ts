import { describe, expect, it } from 'vitest';

import { evaluateOperator } from '../../src/core/operators.js';
import type { FactValue } from '../../src/core/types.js';
import type { ConditionValue, Operator } from '../../src/policy/schema.js';

describe('evaluateOperator', () => {
  const cases: Array<[FactValue, Operator, ConditionValue, boolean]> = [
    [2, 'eq', 2, true],
    [2, 'neq', 3, true],
    [3, 'gt', 2, true],
    [3, 'gte', 3, true],
    [2, 'lt', 3, true],
    [3, 'lte', 3, true],
    ['billing', 'in', ['billing', 'technical'], true],
    ['account', 'not_in', ['billing', 'technical'], true],
  ];

  it.each(cases)('%j %s %j is %s', (observed, operator, expected, result) => {
    expect(evaluateOperator(observed, operator, expected)).toBe(result);
  });

  it('uses strict equality', () => {
    expect(evaluateOperator('1', 'eq', 1)).toBe(false);
  });

  it('rejects incompatible numeric operands defensively', () => {
    expect(() => evaluateOperator('3', 'gte', 2)).toThrow(TypeError);
  });
});
