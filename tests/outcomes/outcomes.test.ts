import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { OutcomeValidationError } from '../../src/errors.js';
import {
  JsonlOutcomeRecorder,
  joinDecisionOutcomes,
  loadDecisionOutcomes,
} from '../../src/outcomes/index.js';
import type { DecisionOutcome } from '../../src/outcomes/types.js';
import type { DecisionRecord } from '../../src/recorders/types.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function record(decisionId: string): DecisionRecord {
  return {
    format: 'jevpolicy.record/v1',
    decisionId,
    timestamp: '2026-09-24T08:00:00.000Z',
    policy: {
      name: 'outcome-contract',
      version: 1,
      fingerprint: 'a'.repeat(64),
    },
    facts: {},
    signals: {},
    originalDecision: 'review',
    matched: {},
    provider: {
      adapter: 'vercel-jev',
      model: 'typesafe-ai/jev',
      invoked: false,
    },
    mode: 'live',
  };
}

function outcome(decisionId: string, label = 'resolved'): DecisionOutcome {
  return {
    format: 'jevpolicy.outcome/v1',
    decisionId,
    label,
    observedAt: '2026-09-24T09:00:00.000Z',
  };
}

async function outcomeFile(lines: readonly string[]): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'jevpolicy-outcomes-'));
  temporaryDirectories.push(directory);
  const path = join(directory, 'outcomes.jsonl');
  await writeFile(path, `${lines.join('\n')}\n`, 'utf8');
  return path;
}

describe('decision outcomes', () => {
  it('serializes concurrent outcome writes into append-only JSON lines', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'jevpolicy-outcomes-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'outcomes.jsonl');
    const recorder = new JsonlOutcomeRecorder(path);

    await Promise.all([
      recorder.record(outcome('decision-1')),
      recorder.record(outcome('decision-2', 'escalated')),
    ]);

    const loaded = await loadDecisionOutcomes(path);
    expect(loaded).toEqual([
      outcome('decision-1'),
      outcome('decision-2', 'escalated'),
    ]);
    expect((await readFile(path, 'utf8')).trim().split('\n')).toHaveLength(2);
  });

  it('rejects an empty outcome recorder path', () => {
    expect(() => new JsonlOutcomeRecorder('   ')).toThrow(TypeError);
  });

  it('loads strict JSONL outcomes and ignores blank lines', async () => {
    const path = await outcomeFile([
      JSON.stringify(outcome('decision-1')),
      '',
      JSON.stringify(outcome('decision-2', 'escalated')),
    ]);

    await expect(loadDecisionOutcomes(path)).resolves.toEqual([
      outcome('decision-1'),
      outcome('decision-2', 'escalated'),
    ]);
  });

  it('rejects invalid and duplicate outcome records', async () => {
    const invalid = await outcomeFile([
      JSON.stringify({ ...outcome('decision-1'), extra: true }),
    ]);
    const duplicate = await outcomeFile([
      JSON.stringify(outcome('decision-1')),
      JSON.stringify(outcome('decision-1')),
    ]);

    await expect(loadDecisionOutcomes(invalid)).rejects.toThrow(
      OutcomeValidationError,
    );
    await expect(loadDecisionOutcomes(duplicate)).rejects.toThrow(
      /Duplicate outcome for decision 'decision-1'/,
    );
  });

  it('joins outcomes in decision-record order and reports missing labels', () => {
    const result = joinDecisionOutcomes(
      [record('decision-1'), record('decision-2'), record('decision-3')],
      [outcome('decision-3'), outcome('decision-1')],
    );

    expect(result.labeled.map(({ record: entry }) => entry.decisionId)).toEqual(
      ['decision-1', 'decision-3'],
    );
    expect(result.unlabeledDecisionIds).toEqual(['decision-2']);
    expect(result.summary).toEqual({
      records: 3,
      outcomes: 2,
      labeled: 2,
      unlabeled: 1,
    });
  });

  it('rejects unknown outcomes and ambiguous decision IDs', () => {
    expect(() =>
      joinDecisionOutcomes([record('decision-1')], [outcome('unknown')]),
    ).toThrow(/unknown decision 'unknown'/);
    expect(() =>
      joinDecisionOutcomes([record('decision-1'), record('decision-1')], []),
    ).toThrow(/Duplicate decision record 'decision-1'/);
    expect(() =>
      joinDecisionOutcomes(
        [record('decision-1')],
        [outcome('decision-1'), outcome('decision-1')],
      ),
    ).toThrow(/Duplicate outcome for decision 'decision-1'/);
  });
});
