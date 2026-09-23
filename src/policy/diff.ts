import type { CompiledPolicy } from './compiler.js';

export type PolicyChangeKind = 'added' | 'removed' | 'changed' | 'moved';

export type PolicyChangeCategory =
  | 'metadata'
  | 'decision'
  | 'fact'
  | 'question'
  | 'precondition'
  | 'rule'
  | 'fallback'
  | 'recording';

export interface PolicyChange {
  readonly kind: PolicyChangeKind;
  readonly category: PolicyChangeCategory;
  readonly path: string;
  readonly before?: unknown;
  readonly after?: unknown;
  readonly beforeIndex?: number;
  readonly afterIndex?: number;
}

export interface PolicyDiffIdentity {
  readonly name: string;
  readonly version: number;
  readonly fingerprint: string;
}

export interface PolicyDiffSummary {
  readonly total: number;
  readonly added: number;
  readonly removed: number;
  readonly changed: number;
  readonly moved: number;
}

export interface PolicyDiff {
  readonly base: PolicyDiffIdentity;
  readonly candidate: PolicyDiffIdentity;
  readonly changed: boolean;
  readonly summary: PolicyDiffSummary;
  readonly changes: readonly PolicyChange[];
}

type DecisionTarget = CompiledPolicy['rules'][number];

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function identity(policy: CompiledPolicy): PolicyDiffIdentity {
  return Object.freeze({
    name: policy.name,
    version: policy.version,
    fingerprint: policy.fingerprint,
  });
}

function addChange(changes: PolicyChange[], change: PolicyChange): void {
  changes.push(Object.freeze(change));
}

function addValueChange(
  changes: PolicyChange[],
  category: PolicyChangeCategory,
  path: string,
  before: unknown,
  after: unknown,
): void {
  if (sameValue(before, after)) return;
  addChange(changes, {
    kind: 'changed',
    category,
    path,
    ...(before === undefined ? {} : { before }),
    ...(after === undefined ? {} : { after }),
  });
}

function sortedUnion(
  left: Readonly<Record<string, unknown>>,
  right: Readonly<Record<string, unknown>>,
): readonly string[] {
  return [...new Set([...Object.keys(left), ...Object.keys(right)])].sort(
    (first, second) => first.localeCompare(second),
  );
}

function diffNamedValues(
  changes: PolicyChange[],
  category: PolicyChangeCategory,
  pathPrefix: string,
  base: Readonly<Record<string, unknown>>,
  candidate: Readonly<Record<string, unknown>>,
): void {
  for (const name of sortedUnion(base, candidate)) {
    const before = base[name];
    const after = candidate[name];
    if (before === undefined) {
      addChange(changes, {
        kind: 'added',
        category,
        path: `${pathPrefix}.${name}`,
        after,
      });
    } else if (after === undefined) {
      addChange(changes, {
        kind: 'removed',
        category,
        path: `${pathPrefix}.${name}`,
        before,
      });
    } else {
      addValueChange(changes, category, `${pathPrefix}.${name}`, before, after);
    }
  }
}

function diffDecisions(
  changes: PolicyChange[],
  base: readonly string[],
  candidate: readonly string[],
): void {
  const baseSet = new Set(base);
  const candidateSet = new Set(candidate);
  for (const decision of [...baseSet].sort()) {
    if (!candidateSet.has(decision)) {
      addChange(changes, {
        kind: 'removed',
        category: 'decision',
        path: `decisions.${decision}`,
        before: decision,
      });
    }
  }
  for (const decision of [...candidateSet].sort()) {
    if (!baseSet.has(decision)) {
      addChange(changes, {
        kind: 'added',
        category: 'decision',
        path: `decisions.${decision}`,
        after: decision,
      });
    }
  }
}

function targetsById(
  targets: readonly DecisionTarget[],
): ReadonlyMap<
  string,
  { readonly target: DecisionTarget; readonly index: number }
> {
  return new Map(
    targets.map((target, index) => [target.id, { target, index }] as const),
  );
}

function diffTargets(
  changes: PolicyChange[],
  category: 'precondition' | 'rule',
  pathPrefix: 'preconditions' | 'rules',
  baseTargets: readonly DecisionTarget[],
  candidateTargets: readonly DecisionTarget[],
): void {
  const base = targetsById(baseTargets);
  const candidate = targetsById(candidateTargets);
  const ids = [...new Set([...base.keys(), ...candidate.keys()])].sort(
    (left, right) => left.localeCompare(right),
  );

  for (const id of ids) {
    const before = base.get(id);
    const after = candidate.get(id);
    if (before === undefined) {
      addChange(changes, {
        kind: 'added',
        category,
        path: `${pathPrefix}.${id}`,
        after: after!.target,
        afterIndex: after!.index,
      });
    } else if (after === undefined) {
      addChange(changes, {
        kind: 'removed',
        category,
        path: `${pathPrefix}.${id}`,
        before: before.target,
        beforeIndex: before.index,
      });
    } else if (!sameValue(before.target, after.target)) {
      addChange(changes, {
        kind: 'changed',
        category,
        path: `${pathPrefix}.${id}`,
        before: before.target,
        after: after.target,
        beforeIndex: before.index,
        afterIndex: after.index,
      });
    } else if (before.index !== after.index) {
      addChange(changes, {
        kind: 'moved',
        category,
        path: `${pathPrefix}.${id}`,
        beforeIndex: before.index,
        afterIndex: after.index,
      });
    }
  }
}

function summarize(changes: readonly PolicyChange[]): PolicyDiffSummary {
  return Object.freeze({
    total: changes.length,
    added: changes.filter((change) => change.kind === 'added').length,
    removed: changes.filter((change) => change.kind === 'removed').length,
    changed: changes.filter((change) => change.kind === 'changed').length,
    moved: changes.filter((change) => change.kind === 'moved').length,
  });
}

export function diffPolicies(
  base: CompiledPolicy,
  candidate: CompiledPolicy,
): PolicyDiff {
  const changes: PolicyChange[] = [];

  addValueChange(changes, 'metadata', 'schema', base.schema, candidate.schema);
  addValueChange(changes, 'metadata', 'name', base.name, candidate.name);
  addValueChange(
    changes,
    'metadata',
    'version',
    base.version,
    candidate.version,
  );
  addValueChange(
    changes,
    'metadata',
    'description',
    base.description,
    candidate.description,
  );
  diffDecisions(changes, base.decisions, candidate.decisions);
  diffNamedValues(changes, 'fact', 'facts', base.facts, candidate.facts);
  diffNamedValues(
    changes,
    'question',
    'questions',
    base.questions,
    candidate.questions,
  );
  diffTargets(
    changes,
    'precondition',
    'preconditions',
    base.preconditions,
    candidate.preconditions,
  );
  diffTargets(changes, 'rule', 'rules', base.rules, candidate.rules);
  diffNamedValues(
    changes,
    'fallback',
    'fallback',
    base.fallback,
    candidate.fallback,
  );
  addValueChange(
    changes,
    'recording',
    'recording.state',
    base.recording.state,
    candidate.recording.state,
  );

  const frozenChanges = Object.freeze(changes);
  return Object.freeze({
    base: identity(base),
    candidate: identity(candidate),
    changed: frozenChanges.length > 0,
    summary: summarize(frozenChanges),
    changes: frozenChanges,
  });
}
