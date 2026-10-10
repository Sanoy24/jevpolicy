import type { DecisionRecord } from '../recorders/types.js';
import { selectDecisionRecords } from './selection.js';
import type {
  RuleFrequencyMatch,
  RuleFrequencyMatchKind,
  RuleFrequencyOptions,
  RuleFrequencyPolicy,
  RuleFrequencyReport,
} from './types.js';

interface MutableMatch {
  readonly kind: RuleFrequencyMatchKind;
  readonly id?: string;
  readonly decision: string;
  count: number;
}

function matchFor(record: DecisionRecord): Omit<MutableMatch, 'count'> {
  if (record.matched.preconditionId !== undefined) {
    return {
      kind: 'precondition',
      id: record.matched.preconditionId,
      decision: record.originalDecision,
    };
  }
  if (record.matched.ruleId !== undefined) {
    return {
      kind: 'rule',
      id: record.matched.ruleId,
      decision: record.originalDecision,
    };
  }
  return { kind: 'unmatched', decision: record.originalDecision };
}

function matchKey(match: Omit<MutableMatch, 'count'>): string {
  return JSON.stringify([match.kind, match.id ?? null, match.decision]);
}

function compareMatches(
  left: RuleFrequencyMatch,
  right: RuleFrequencyMatch,
): number {
  return (
    right.count - left.count ||
    left.kind.localeCompare(right.kind) ||
    (left.id ?? '').localeCompare(right.id ?? '') ||
    left.decision.localeCompare(right.decision)
  );
}

/**
 * Counts the policy branches that produced recorded decisions. Results stay
 * separated by policy fingerprint so equal rule IDs in different versions are
 * never combined.
 */
export function createRuleFrequencyReport(
  records: readonly DecisionRecord[],
  options: RuleFrequencyOptions = {},
): RuleFrequencyReport {
  const selected = selectDecisionRecords(records, options);
  const byPolicy = new Map<string, Map<string, MutableMatch>>();
  let preconditionMatches = 0;
  let ruleMatches = 0;
  let unmatched = 0;

  for (const record of selected.selected) {
    const match = matchFor(record);
    if (match.kind === 'precondition') preconditionMatches += 1;
    else if (match.kind === 'rule') ruleMatches += 1;
    else unmatched += 1;

    let matches = byPolicy.get(record.policy.fingerprint);
    if (matches === undefined) {
      matches = new Map<string, MutableMatch>();
      byPolicy.set(record.policy.fingerprint, matches);
    }
    const key = matchKey(match);
    const existing = matches.get(key);
    if (existing === undefined) {
      matches.set(key, { ...match, count: 1 });
    } else {
      existing.count += 1;
    }
  }

  const policies: RuleFrequencyPolicy[] = selected.policies.map((policy) => {
    const matches = byPolicy.get(policy.fingerprint);
    const frequencies = [...(matches?.values() ?? [])]
      .map<RuleFrequencyMatch>((match) =>
        Object.freeze({
          kind: match.kind,
          ...(match.id === undefined ? {} : { id: match.id }),
          decision: match.decision,
          count: match.count,
          rate: match.count / policy.records,
        }),
      )
      .sort(compareMatches);
    return Object.freeze({ ...policy, matches: Object.freeze(frequencies) });
  });

  return Object.freeze({
    selection: selected.selection,
    summary: Object.freeze({
      records: selected.selected.length,
      policies: policies.length,
      preconditionMatches,
      ruleMatches,
      unmatched,
    }),
    policies: Object.freeze(policies),
  });
}
