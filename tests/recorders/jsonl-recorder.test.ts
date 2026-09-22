import { mkdtemp, readFile, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { JsonlRecorder } from '../../src/recorders/jsonl-recorder.js';
import type { DecisionRecord } from '../../src/recorders/types.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(join(directory, 'decisions.jsonl'), { force: true });
    await rmdir(directory);
  }
});

function record(decisionId: string): DecisionRecord {
  return {
    format: 'jevpolicy.record/v1',
    decisionId,
    timestamp: '2026-09-22T08:00:00.000Z',
    policy: {
      name: 'jsonl-contract',
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

describe('JsonlRecorder', () => {
  it('serializes concurrent calls into append-only JSON lines', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'jevpolicy-jsonl-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'decisions.jsonl');
    const recorder = new JsonlRecorder(path);

    await Promise.all([
      recorder.record(record('first')),
      recorder.record(record('second')),
    ]);

    const lines = (await readFile(path, 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(2);
    const parsed = lines.map((line): unknown => JSON.parse(line) as unknown);
    expect(parsed).toMatchObject([
      { decisionId: 'first' },
      { decisionId: 'second' },
    ]);
  });

  it('rejects an empty output path', () => {
    expect(() => new JsonlRecorder('   ')).toThrow(TypeError);
  });
});
