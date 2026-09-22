import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

import { z } from 'zod';

import { ReplayCompatibilityError } from '../errors.js';
import { validateEvaluationState } from '../providers/state.js';
import type { EvaluationState } from '../providers/types.js';
import type { DecisionRecord } from '../recorders/types.js';

const fingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/);
const probabilitySchema = z.number().min(0).max(1);
const probabilitiesSchema = z.record(z.string(), probabilitySchema);
const signalSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('boolean'),
      probabilityTrue: probabilitySchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('choice'),
      value: z.string(),
      probabilities: probabilitiesSchema.optional(),
      confidence: z.number().finite().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('score'),
      value: z.number().finite(),
      probabilities: probabilitiesSchema.optional(),
      confidence: z.number().finite().optional(),
    })
    .strict(),
]);
const factValueSchema = z.union([z.string(), z.number().finite(), z.boolean()]);
const evaluationStateSchema = z.custom<EvaluationState>((value) => {
  try {
    validateEvaluationState(value);
    return true;
  } catch {
    return false;
  }
}, 'must be a JSON-compatible string, object, or array');

const decisionRecordSchema = z
  .object({
    format: z.literal('jevpolicy.record/v1'),
    decisionId: z.string().min(1),
    timestamp: z.iso.datetime(),
    policy: z
      .object({
        name: z.string().min(1),
        version: z.number().int().positive(),
        fingerprint: fingerprintSchema,
      })
      .strict(),
    state: evaluationStateSchema.optional(),
    stateFingerprint: fingerprintSchema.optional(),
    facts: z.record(z.string(), factValueSchema),
    signals: z.record(
      z.string(),
      z
        .object({
          questionFingerprint: fingerprintSchema,
          signal: signalSchema,
        })
        .strict(),
    ),
    originalDecision: z.string().min(1),
    matched: z
      .object({
        preconditionId: z.string().min(1).optional(),
        ruleId: z.string().min(1).optional(),
      })
      .strict(),
    provider: z
      .object({
        adapter: z.string().min(1),
        model: z.string().min(1),
        invoked: z.boolean(),
        usage: z
          .object({
            inputTokens: z.number().int().nonnegative().optional(),
            outputTokens: z.number().int().nonnegative().optional(),
          })
          .strict()
          .optional(),
        gateway: z
          .object({
            generationId: z.string().min(1).optional(),
            cost: z.string().min(1).optional(),
            resolvedProvider: z.string().min(1).optional(),
          })
          .strict()
          .optional(),
      })
      .strict(),
    mode: z.enum(['live', 'shadow', 'replay']),
  })
  .strict();

const maxRecordBytes = 1024 * 1024;

export async function loadDecisionRecords(
  path: string,
): Promise<readonly DecisionRecord[]> {
  const records: DecisionRecord[] = [];
  const lines = createInterface({
    input: createReadStream(path, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  let lineNumber = 0;
  for await (const line of lines) {
    lineNumber += 1;
    if (line.trim().length === 0) continue;
    if (Buffer.byteLength(line, 'utf8') > maxRecordBytes) {
      throw new ReplayCompatibilityError(
        `Decision record on line ${lineNumber} exceeds 1 MiB`,
      );
    }
    let input: unknown;
    try {
      input = JSON.parse(line) as unknown;
    } catch (error) {
      throw new ReplayCompatibilityError(
        `Invalid JSON decision record on line ${lineNumber}`,
        { cause: error },
      );
    }
    const parsed = decisionRecordSchema.safeParse(input);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new ReplayCompatibilityError(
        `Invalid decision record on line ${lineNumber}: ${issue?.message ?? 'unknown error'}`,
        { cause: parsed.error },
      );
    }
    records.push(parsed.data as DecisionRecord);
  }
  return Object.freeze(records);
}
