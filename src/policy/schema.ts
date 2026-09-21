import { z } from 'zod';

export const identifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(
    /^[A-Za-z][A-Za-z0-9_-]*$/,
    'must begin with a letter and contain only letters, numbers, underscores, or hyphens',
  );

export const operatorSchema = z.enum([
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'not_in',
]);

const primitiveValueSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
]);

export const conditionValueSchema = z.union([
  primitiveValueSchema,
  z.array(primitiveValueSchema).min(1),
]);

export type ConditionValue = z.infer<typeof conditionValueSchema>;
export type Operator = z.infer<typeof operatorSchema>;

export interface SignalCondition {
  readonly signal: string;
  readonly op: Operator;
  readonly value: ConditionValue;
}

export interface FactCondition {
  readonly fact: string;
  readonly op: Operator;
  readonly value: ConditionValue;
}

export interface AllCondition {
  readonly all: readonly Condition[];
}

export interface AnyCondition {
  readonly any: readonly Condition[];
}

export interface NotCondition {
  readonly not: Condition;
}

export type Condition =
  SignalCondition | FactCondition | AllCondition | AnyCondition | NotCondition;

const signalConditionSchema = z
  .object({
    signal: identifierSchema,
    op: operatorSchema,
    value: conditionValueSchema,
  })
  .strict();

const factConditionSchema = z
  .object({
    fact: identifierSchema,
    op: operatorSchema,
    value: conditionValueSchema,
  })
  .strict();

export const conditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    signalConditionSchema,
    factConditionSchema,
    z.object({ all: z.array(conditionSchema).min(1) }).strict(),
    z.object({ any: z.array(conditionSchema).min(1) }).strict(),
    z.object({ not: conditionSchema }).strict(),
  ]),
);

export const factDefinitionSchema = z
  .object({
    type: z.enum(['string', 'number', 'boolean']),
    required: z.boolean().default(false),
  })
  .strict();

const instructionsSchema = z.string().trim().min(1).max(16_000);
const criterionDescriptionSchema = z.string().trim().min(1).max(4_000);

const booleanQuestionSchema = z
  .object({
    type: z.literal('boolean'),
    instructions: instructionsSchema,
    criteria: z
      .object({
        true: criterionDescriptionSchema,
        false: criterionDescriptionSchema,
      })
      .strict()
      .optional(),
  })
  .strict();

const choiceCriteriaSchema = z
  .record(identifierSchema, criterionDescriptionSchema)
  .superRefine((criteria, context) => {
    if (Object.keys(criteria).length < 2) {
      context.addIssue({
        code: 'custom',
        message: 'choice criteria must declare at least two options',
      });
    }
  });

const choiceQuestionSchema = z
  .object({
    type: z.literal('choice'),
    instructions: instructionsSchema,
    criteria: choiceCriteriaSchema,
  })
  .strict();

const scoreQuestionSchema = z
  .object({
    type: z.literal('score'),
    instructions: instructionsSchema,
    criteria: z.array(criterionDescriptionSchema).min(2),
  })
  .strict();

export const questionSchema = z.discriminatedUnion('type', [
  booleanQuestionSchema,
  choiceQuestionSchema,
  scoreQuestionSchema,
]);

const decisionTargetSchema = z
  .object({
    id: identifierSchema,
    when: conditionSchema,
    decision: identifierSchema,
  })
  .strict();

const fallbackSchema = z
  .object({
    provider_error: identifierSchema,
    provider_timeout: identifierSchema,
    invalid_provider_response: identifierSchema,
    no_match: identifierSchema,
  })
  .strict();

const recordingSchema = z
  .object({
    state: z.enum(['none', 'redacted', 'full']).default('none'),
  })
  .strict();

export const policySchema = z
  .object({
    schema: z.literal('jevpolicy/v1'),
    name: identifierSchema,
    version: z.number().int().positive(),
    description: z.string().trim().min(1).max(4_000).optional(),
    decisions: z.array(identifierSchema).min(1),
    facts: z.record(identifierSchema, factDefinitionSchema).default({}),
    questions: z
      .record(identifierSchema, questionSchema)
      .refine((questions) => Object.keys(questions).length > 0, {
        message: 'at least one question is required',
      }),
    preconditions: z.array(decisionTargetSchema).default([]),
    rules: z.array(decisionTargetSchema).min(1),
    fallback: fallbackSchema,
    recording: recordingSchema.default({ state: 'none' }),
  })
  .strict();

export type FactDefinition = z.infer<typeof factDefinitionSchema>;
export type QuestionDefinition = z.infer<typeof questionSchema>;
export type PolicyDefinition = z.infer<typeof policySchema>;
