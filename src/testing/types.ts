import type { DeterministicDecision } from '../core/types.js';
import type { PolicyTestExpectation } from './schema.js';

export type {
  PolicyTestCase,
  PolicyTestExpectation,
  PolicyTestSuite,
} from './schema.js';

export type PolicyTestResult =
  | {
      readonly name: string;
      readonly status: 'passed' | 'failed';
      readonly expected: PolicyTestExpectation;
      readonly actual: DeterministicDecision;
      readonly failures: readonly string[];
    }
  | {
      readonly name: string;
      readonly status: 'error';
      readonly expected: PolicyTestExpectation;
      readonly error: string;
    };

export interface PolicyTestReport {
  readonly policy: {
    readonly name: string;
    readonly version: number;
    readonly fingerprint: string;
  };
  readonly passed: boolean;
  readonly summary: {
    readonly cases: number;
    readonly passed: number;
    readonly failed: number;
    readonly errors: number;
  };
  readonly results: readonly PolicyTestResult[];
}
