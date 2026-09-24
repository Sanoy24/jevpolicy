import { OutcomeValidationError } from '../errors.js';
import type { DecisionRecord } from '../recorders/types.js';
import type {
  DecisionOutcome,
  LabeledDecisionRecord,
  OutcomeJoinResult,
} from './types.js';

export function joinDecisionOutcomes(
  records: readonly DecisionRecord[],
  outcomes: readonly DecisionOutcome[],
): OutcomeJoinResult {
  const recordsById = new Map<string, DecisionRecord>();
  for (const record of records) {
    if (recordsById.has(record.decisionId)) {
      throw new OutcomeValidationError(
        `Duplicate decision record '${record.decisionId}'`,
      );
    }
    recordsById.set(record.decisionId, record);
  }

  const outcomesById = new Map<string, DecisionOutcome>();
  for (const outcome of outcomes) {
    if (outcomesById.has(outcome.decisionId)) {
      throw new OutcomeValidationError(
        `Duplicate outcome for decision '${outcome.decisionId}'`,
      );
    }
    if (!recordsById.has(outcome.decisionId)) {
      throw new OutcomeValidationError(
        `Outcome references unknown decision '${outcome.decisionId}'`,
      );
    }
    outcomesById.set(outcome.decisionId, outcome);
  }

  const labeled: LabeledDecisionRecord[] = [];
  const unlabeledDecisionIds: string[] = [];
  for (const record of records) {
    const outcome = outcomesById.get(record.decisionId);
    if (outcome === undefined) {
      unlabeledDecisionIds.push(record.decisionId);
      continue;
    }
    labeled.push(Object.freeze({ record, outcome }));
  }

  return Object.freeze({
    labeled: Object.freeze(labeled),
    unlabeledDecisionIds: Object.freeze(unlabeledDecisionIds),
    summary: Object.freeze({
      records: records.length,
      outcomes: outcomes.length,
      labeled: labeled.length,
      unlabeled: unlabeledDecisionIds.length,
    }),
  });
}
