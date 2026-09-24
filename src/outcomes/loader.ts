import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

import { z } from 'zod';

import { OutcomeValidationError } from '../errors.js';
import type { DecisionOutcome } from './types.js';

const decisionOutcomeSchema = z
  .object({
    format: z.literal('jevpolicy.outcome/v1'),
    decisionId: z.string().min(1),
    label: z.string().refine((value) => value.trim().length > 0, {
      message: 'label must not be empty',
    }),
    observedAt: z.iso.datetime(),
  })
  .strict();

const maxOutcomeBytes = 64 * 1024;

export async function loadDecisionOutcomes(
  path: string,
): Promise<readonly DecisionOutcome[]> {
  const outcomes: DecisionOutcome[] = [];
  const decisionIds = new Set<string>();
  const lines = createInterface({
    input: createReadStream(path, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  let lineNumber = 0;
  for await (const line of lines) {
    lineNumber += 1;
    if (line.trim().length === 0) continue;
    if (Buffer.byteLength(line, 'utf8') > maxOutcomeBytes) {
      throw new OutcomeValidationError(
        `Decision outcome on line ${lineNumber} exceeds 64 KiB`,
      );
    }

    let input: unknown;
    try {
      input = JSON.parse(line) as unknown;
    } catch (error) {
      throw new OutcomeValidationError(
        `Invalid JSON decision outcome on line ${lineNumber}`,
        { cause: error },
      );
    }

    const parsed = decisionOutcomeSchema.safeParse(input);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new OutcomeValidationError(
        `Invalid decision outcome on line ${lineNumber}: ${issue?.message ?? 'unknown error'}`,
        { cause: parsed.error },
      );
    }
    if (decisionIds.has(parsed.data.decisionId)) {
      throw new OutcomeValidationError(
        `Duplicate outcome for decision '${parsed.data.decisionId}' on line ${lineNumber}`,
      );
    }

    decisionIds.add(parsed.data.decisionId);
    outcomes.push(Object.freeze(parsed.data));
  }
  return Object.freeze(outcomes);
}
