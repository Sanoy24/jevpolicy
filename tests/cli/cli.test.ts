import { mkdtemp, rm, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { runCli } from '../../src/cli/index.js';
import type { DecisionOutcome } from '../../src/outcomes/types.js';
import { compilePolicy } from '../../src/policy/compiler.js';
import type { DecisionRecord } from '../../src/recorders/types.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(join(directory, 'records.jsonl'), { force: true });
    await rm(join(directory, 'outcomes.jsonl'), { force: true });
    await rm(join(directory, 'policy.yaml'), { force: true });
    await rm(join(directory, 'candidate-policy.yaml'), { force: true });
    await rm(join(directory, 'shadow-policy.yaml'), { force: true });
    await rm(join(directory, 'state.json'), { force: true });
    await rmdir(directory);
  }
});

function policyDefinition(threshold: number): Record<string, unknown> {
  return {
    schema: 'jevpolicy/v1',
    name: 'cli-replay',
    version: threshold === 0.7 ? 1 : 2,
    decisions: ['approve', 'review'],
    facts: { authenticated: { type: 'boolean', required: true } },
    questions: {
      urgent: {
        type: 'boolean',
        instructions: 'Is this urgent?',
      },
    },
    preconditions: [
      {
        id: 'require-authentication',
        when: { fact: 'authenticated', op: 'eq', value: false },
        decision: 'review',
      },
    ],
    rules: [
      {
        id: 'approve-urgent',
        when: { signal: 'urgent', op: 'gte', value: threshold },
        decision: 'approve',
      },
    ],
    fallback: {
      provider_error: 'review',
      provider_timeout: 'review',
      invalid_provider_response: 'review',
      no_match: 'review',
    },
  };
}

describe('CLI', () => {
  it('diffs two policy files offline and emits structured JSON', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'jevpolicy-cli-'));
    temporaryDirectories.push(directory);
    const basePath = join(directory, 'policy.yaml');
    const candidatePath = join(directory, 'candidate-policy.yaml');
    await Promise.all([
      writeFile(basePath, JSON.stringify(policyDefinition(0.7)), 'utf8'),
      writeFile(candidatePath, JSON.stringify(policyDefinition(0.9)), 'utf8'),
    ]);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const exitCode = await runCli(['diff', basePath, candidatePath, '--json']);

    expect(exitCode).toBe(0);
    const output: unknown = JSON.parse(String(log.mock.calls[0]?.[0]));
    expect(output).toMatchObject({
      base: { name: 'cli-replay', version: 1 },
      candidate: { name: 'cli-replay', version: 2 },
      changed: true,
      summary: { total: 2, changed: 2 },
      changes: [
        { kind: 'changed', category: 'metadata', path: 'version' },
        { kind: 'changed', category: 'rule', path: 'rules.approve-urgent' },
      ],
    });
  });

  it('evaluates a compatible shadow policy without invoking the provider', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'jevpolicy-cli-'));
    temporaryDirectories.push(directory);
    const policyPath = join(directory, 'policy.yaml');
    const shadowPolicyPath = join(directory, 'shadow-policy.yaml');
    const statePath = join(directory, 'state.json');
    await Promise.all([
      writeFile(policyPath, JSON.stringify(policyDefinition(0.7)), 'utf8'),
      writeFile(
        shadowPolicyPath,
        JSON.stringify(policyDefinition(0.9)),
        'utf8',
      ),
      writeFile(statePath, JSON.stringify({ authenticated: false }), 'utf8'),
    ]);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const exitCode = await runCli([
      'evaluate',
      policyPath,
      '--state',
      statePath,
      '--shadow-policy',
      shadowPolicyPath,
      '--no-record',
      '--json',
    ]);

    expect(exitCode).toBe(0);
    const output: unknown = JSON.parse(String(log.mock.calls[0]?.[0]));
    expect(output).toMatchObject({
      active: {
        policy: { version: 1 },
        mode: 'live',
        decision: 'review',
        provider: { invoked: false },
      },
      shadow: {
        policy: { version: 2 },
        mode: 'shadow',
        decision: 'review',
        provider: { invoked: false },
      },
      comparison: { decisionChanged: false, matchChanged: false },
    });
  });

  it('replays JSONL records offline and emits a JSON summary', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'jevpolicy-cli-'));
    temporaryDirectories.push(directory);
    const policyPath = join(directory, 'policy.yaml');
    const recordsPath = join(directory, 'records.jsonl');
    const original = compilePolicy(policyDefinition(0.7));
    const record: DecisionRecord = {
      format: 'jevpolicy.record/v1',
      decisionId: 'cli-decision',
      timestamp: '2026-09-22T08:00:00.000Z',
      policy: {
        name: original.name,
        version: original.version,
        fingerprint: original.fingerprint,
      },
      facts: { authenticated: true },
      signals: {
        urgent: {
          questionFingerprint: original.questions['urgent']!.fingerprint,
          signal: { type: 'boolean', probabilityTrue: 0.8 },
        },
      },
      originalDecision: 'approve',
      matched: { ruleId: 'approve-urgent' },
      provider: {
        adapter: 'vercel-jev',
        model: 'typesafe-ai/jev',
        invoked: true,
      },
      mode: 'live',
    };
    await Promise.all([
      writeFile(policyPath, JSON.stringify(policyDefinition(0.9)), 'utf8'),
      writeFile(recordsPath, `${JSON.stringify(record)}\n`, 'utf8'),
    ]);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const exitCode = await runCli([
      'replay',
      recordsPath,
      '--policy',
      policyPath,
      '--json',
    ]);

    expect(exitCode).toBe(0);
    const output: unknown = JSON.parse(String(log.mock.calls[0]?.[0]));
    expect(output).toMatchObject({
      summary: {
        records: 1,
        changed: 1,
        transitions: [{ from: 'approve', to: 'review', count: 1 }],
      },
    });
  });

  it('calibrates recorded decisions against ground-truth outcomes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'jevpolicy-cli-'));
    temporaryDirectories.push(directory);
    const recordsPath = join(directory, 'records.jsonl');
    const outcomesPath = join(directory, 'outcomes.jsonl');
    const original = compilePolicy(policyDefinition(0.7));
    const record: DecisionRecord = {
      format: 'jevpolicy.record/v1',
      decisionId: 'cli-calibration',
      timestamp: '2026-09-24T08:00:00.000Z',
      policy: {
        name: original.name,
        version: original.version,
        fingerprint: original.fingerprint,
      },
      facts: { authenticated: true },
      signals: {},
      originalDecision: 'approve',
      matched: { ruleId: 'approve-urgent' },
      provider: {
        adapter: 'vercel-jev',
        model: 'typesafe-ai/jev',
        invoked: true,
      },
      mode: 'live',
    };
    const outcome: DecisionOutcome = {
      format: 'jevpolicy.outcome/v1',
      decisionId: record.decisionId,
      label: 'review',
      observedAt: '2026-09-24T09:00:00.000Z',
    };
    await Promise.all([
      writeFile(recordsPath, `${JSON.stringify(record)}\n`, 'utf8'),
      writeFile(outcomesPath, `${JSON.stringify(outcome)}\n`, 'utf8'),
    ]);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const exitCode = await runCli([
      'calibrate',
      recordsPath,
      '--outcomes',
      outcomesPath,
      '--json',
    ]);

    expect(exitCode).toBe(0);
    const output: unknown = JSON.parse(String(log.mock.calls[0]?.[0]));
    expect(output).toMatchObject({
      summary: {
        records: 1,
        labeled: 1,
        coverage: 1,
        correct: 0,
        incorrect: 1,
        accuracy: 0,
      },
      transitions: [{ predicted: 'approve', observed: 'review', count: 1 }],
    });
  });

  it('returns usage status for malformed command arguments', async () => {
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    await expect(runCli(['replay', 'records.jsonl'])).resolves.toBe(2);
    expect(error).toHaveBeenCalledOnce();
  });
});
