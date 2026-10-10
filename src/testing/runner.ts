import { evaluatePolicy } from '../core/evaluator.js';
import { hasOwn } from '../core/records.js';
import type { DeterministicDecision } from '../core/types.js';
import { validateSignalsForQuestions } from '../core/validation.js';
import { PolicyTestValidationError } from '../errors.js';
import type { CompiledPolicy } from '../policy/compiler.js';
import {
  validatePolicyTestSuite,
  type PolicyTestCase,
  type PolicyTestExpectation,
  type PolicyTestSuite,
} from './schema.js';
import type { PolicyTestReport, PolicyTestResult } from './types.js';

function validateCase(policy: CompiledPolicy, entry: PolicyTestCase): void {
  if (!policy.decisions.includes(entry.expect.decision)) {
    throw new PolicyTestValidationError(
      `Expected decision '${entry.expect.decision}' is not declared by the policy`,
    );
  }
  const match = entry.expect.matched;
  if (
    match?.ruleId !== undefined &&
    !policy.rules.some((rule) => rule.id === match.ruleId)
  ) {
    throw new PolicyTestValidationError(
      `Unknown expected rule '${match.ruleId}'`,
    );
  }
  if (
    match?.preconditionId !== undefined &&
    !policy.preconditions.some((rule) => rule.id === match.preconditionId)
  ) {
    throw new PolicyTestValidationError(
      `Unknown expected precondition '${match.preconditionId}'`,
    );
  }
  const unknownFacts = Object.keys(entry.facts ?? {}).filter(
    (name) => !hasOwn(policy.facts, name),
  );
  if (unknownFacts.length > 0) {
    throw new PolicyTestValidationError(
      `Unknown facts: ${unknownFacts.join(', ')}`,
    );
  }
  // Validate every supplied signal even when a precondition will terminate.
  // Missing signals are allowed here; evaluatePolicy requires the full set
  // only for cases that proceed beyond preconditions.
  const supplied = entry.signals ?? {};
  const questions = Object.fromEntries(
    Object.entries(policy.questions).filter(([name]) => hasOwn(supplied, name)),
  );
  validateSignalsForQuestions(questions, supplied);
}

function checkExpectations(
  expected: PolicyTestExpectation,
  actual: DeterministicDecision,
): readonly string[] {
  const failures: string[] = [];
  if (actual.decision !== expected.decision) {
    failures.push(
      `decision: expected '${expected.decision}', received '${actual.decision}'`,
    );
  }
  if (
    expected.matched !== undefined &&
    (expected.matched.ruleId !== actual.matched.ruleId ||
      expected.matched.preconditionId !== actual.matched.preconditionId)
  ) {
    failures.push(
      `matched: expected ${JSON.stringify(expected.matched)}, received ${JSON.stringify(actual.matched)}`,
    );
  }
  if (
    expected.fallback !== undefined &&
    (expected.fallback.used !== actual.fallback.used ||
      (expected.fallback.used &&
        actual.fallback.used &&
        expected.fallback.reason !== actual.fallback.reason))
  ) {
    failures.push(
      `fallback: expected ${JSON.stringify(expected.fallback)}, received ${JSON.stringify(actual.fallback)}`,
    );
  }
  return Object.freeze(failures);
}

/** Runs deterministic policy assertions entirely offline, without recording. */
export function runPolicyTests(
  policy: CompiledPolicy,
  suite: PolicyTestSuite,
): PolicyTestReport {
  const validated = validatePolicyTestSuite(suite);
  const results = validated.cases.map<PolicyTestResult>((entry) => {
    try {
      validateCase(policy, entry);
      const actual = evaluatePolicy({
        policy,
        facts: entry.facts ?? {},
        signals: entry.signals ?? {},
      });
      const failures = checkExpectations(entry.expect, actual);
      return Object.freeze({
        name: entry.name,
        status: failures.length === 0 ? 'passed' : 'failed',
        expected: entry.expect,
        actual,
        failures,
      });
    } catch (error) {
      return Object.freeze({
        name: entry.name,
        status: 'error',
        expected: entry.expect,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
  const summary = Object.freeze({
    cases: results.length,
    passed: results.filter((result) => result.status === 'passed').length,
    failed: results.filter((result) => result.status === 'failed').length,
    errors: results.filter((result) => result.status === 'error').length,
  });
  return Object.freeze({
    policy: Object.freeze({
      name: policy.name,
      version: policy.version,
      fingerprint: policy.fingerprint,
    }),
    passed: summary.passed === summary.cases,
    summary,
    results: Object.freeze(results),
  });
}
