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
  const mode = filter.mode ?? 'live';
  const includes = (record: DecisionRecord): boolean =>
    record.mode === mode &&
    (filter.policyFingerprint === undefined ||
      record.policy.fingerprint === filter.policyFingerprint);

  const selected = records.filter(includes);
  const labeled = joined.labeled.filter(({ record }) => includes(record));

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
    selection: Object.freeze({
      mode,
      ...(filter.policyFingerprint === undefined
        ? {}
        : { policyFingerprint: filter.policyFingerprint }),
    }),
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
    records: selected.length,
    labeled,
    unlabeled: selected.length - labeled.length,
  });
}
