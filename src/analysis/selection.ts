import { joinDecisionOutcomes } from '../outcomes/join.js';
import type {
  DecisionOutcome,
  LabeledDecisionRecord,
} from '../outcomes/types.js';
import type { DecisionRecord } from '../recorders/types.js';
import type {
  AnalysisPolicy,
  AnalysisSelection,
  DecisionRecordFilter,
} from './types.js';

export interface SelectedRecords {
  readonly selection: AnalysisSelection;
  readonly policies: readonly AnalysisPolicy[];
  readonly records: number;
  readonly labeled: readonly LabeledDecisionRecord[];
  readonly unlabeled: number;
}

export interface SelectedDecisionRecords {
  readonly selection: AnalysisSelection;
  readonly policies: readonly AnalysisPolicy[];
  readonly selected: readonly DecisionRecord[];
}

function includesRecord(
  record: DecisionRecord,
  selection: AnalysisSelection,
): boolean {
  return (
    record.mode === selection.mode &&
    (selection.policyFingerprint === undefined ||
      record.policy.fingerprint === selection.policyFingerprint)
  );
}

/** Selects records without requiring outcome labels. */
export function selectDecisionRecords(
  records: readonly DecisionRecord[],
  filter: DecisionRecordFilter = {},
): SelectedDecisionRecords {
  const selection: AnalysisSelection = Object.freeze({
    mode: filter.mode ?? 'live',
    ...(filter.policyFingerprint === undefined
      ? {}
      : { policyFingerprint: filter.policyFingerprint }),
  });
  const selected = records.filter((record) =>
    includesRecord(record, selection),
  );
  const policies = new Map<string, AnalysisPolicy>();
  for (const record of selected) {
    const existing = policies.get(record.policy.fingerprint);
    policies.set(record.policy.fingerprint, {
      name: record.policy.name,
      version: record.policy.version,
      fingerprint: record.policy.fingerprint,
      records: (existing?.records ?? 0) + 1,
    });
  }

  return Object.freeze({
    selection,
    policies: Object.freeze(
      [...policies.values()]
        .sort(
          (left, right) =>
            left.name.localeCompare(right.name) ||
            left.version - right.version ||
            left.fingerprint.localeCompare(right.fingerprint),
        )
        .map((policy) => Object.freeze(policy)),
    ),
    selected: Object.freeze(selected),
  });
}

/**
 * Joins the full decision log with its outcomes, then keeps only the records
 * in one mode (live by default) and, optionally, one policy fingerprint, so a
 * report never silently mixes live and shadow decisions.
 */
export function selectLabeledRecords(
  records: readonly DecisionRecord[],
  outcomes: readonly DecisionOutcome[],
  filter: DecisionRecordFilter = {},
): SelectedRecords {
  // Join against every record so outcome references stay strictly validated.
  const joined = joinDecisionOutcomes(records, outcomes);
  const selectedRecords = selectDecisionRecords(records, filter);
  const labeled = joined.labeled.filter(({ record }) =>
    includesRecord(record, selectedRecords.selection),
  );

  return Object.freeze({
    selection: selectedRecords.selection,
    policies: selectedRecords.policies,
    records: selectedRecords.selected.length,
    labeled,
    unlabeled: selectedRecords.selected.length - labeled.length,
  });
}
