import { z } from 'zod';

import { PolicyTestValidationError } from '../errors.js';

const nonemptyString = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0);
const matchSchema = z
  .strictObject({
    ruleId: nonemptyString.optional(),
    preconditionId: nonemptyString.optional(),
  })
  .refine(
    (match) => match.ruleId === undefined || match.preconditionId === undefined,
    'A match cannot specify both ruleId and preconditionId',
  );

const expectationSchema = z.strictObject({
  decision: nonemptyString,
  matched: matchSchema.optional(),
  fallback: z
    .discriminatedUnion('used', [
      z.strictObject({ used: z.literal(false) }),
      z.strictObject({ used: z.literal(true), reason: z.literal('no_match') }),
    ])
    .optional(),
});

const caseSchema = z.strictObject({
  name: nonemptyString,
  facts: z.record(z.string(), z.unknown()).optional(),
  signals: z.record(z.string(), z.unknown()).optional(),
  expect: expectationSchema,
});

const suiteSchema = z
  .strictObject({
    schema: z.literal('jevpolicy.tests/v1'),
    cases: z.array(caseSchema).min(1),
  })
  .superRefine((suite, context) => {
    const names = new Set<string>();
    suite.cases.forEach((entry, index) => {
      if (names.has(entry.name)) {
        context.addIssue({
          code: 'custom',
          path: ['cases', index, 'name'],
          message: `Duplicate test case '${entry.name}'`,
        });
      }
      names.add(entry.name);
    });
  });

export type PolicyTestExpectation = z.infer<typeof expectationSchema>;
export type PolicyTestCase = z.infer<typeof caseSchema>;
export type PolicyTestSuite = z.infer<typeof suiteSchema>;

export function validatePolicyTestSuite(
  input: unknown,
  source = '<inline>',
): PolicyTestSuite {
  const parsed = suiteSchema.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('\n');
    throw new PolicyTestValidationError(`Invalid policy tests:\n${issues}`, {
      source,
    });
  }
  return parsed.data;
}
