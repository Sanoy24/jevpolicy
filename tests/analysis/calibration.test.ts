import { describe, expect, it } from 'vitest';

import { createCalibrationReport } from '../../src/analysis/calibration.js';
import type { DecisionOutcome } from '../../src/outcomes/types.js';
import type { DecisionRecord } from '../../src/recorders/types.js';

function record(decisionId: string, decision: string): DecisionRecord {
  return {
    format: 'jevpolicy.record/v1',
    decisionId,
    timestamp: '2026-09-24T08:00:00.000Z',
    policy: {
      name: 'calibration-contract',
      version: 1,
      fingerprint: 'a'.repeat(64),
    },
    facts: {},
    signals: {},
    originalDecision: decision,
    matched: {},
    provider: {
      adapter: 'vercel-jev',
      model: 'typesafe-ai/jev',
      invoked: false,
    },
    mode: 'live',
  };
}

function outcome(decisionId: string, label: string): DecisionOutcome {
  return {
    format: 'jevpolicy.outcome/v1',
    decisionId,
    label,
    observedAt: '2026-09-24T09:00:00.000Z',
  };
}

describe('calibration reports', () => {
  it('reports coverage, accuracy, per-label metrics, and transitions', () => {
    const report = createCalibrationReport(
      [
        record('correct-approve', 'approve'),
        record('incorrect-approve', 'approve'),
        record('correct-review', 'review'),
        record('unlabeled', 'review'),
      ],
      [
        outcome('correct-approve', 'approve'),
        outcome('incorrect-approve', 'review'),
        outcome('correct-review', 'review'),
      ],
    );

    expect(report.summary).toEqual({
      records: 4,
      labeled: 3,
      unlabeled: 1,
      coverage: 0.75,
      correct: 2,
      incorrect: 1,
      accuracy: 2 / 3,
    });
    expect(report.labels).toEqual([
      {
        label: 'approve',
        predicted: 2,
        observed: 1,
        correct: 1,
        precision: 0.5,
        recall: 1,
      },
      {
        label: 'review',
        predicted: 1,
        observed: 2,
        correct: 1,
        precision: 1,
        recall: 0.5,
      },
    ]);
    expect(report.transitions).toEqual([
      { predicted: 'approve', observed: 'approve', count: 1 },
      { predicted: 'approve', observed: 'review', count: 1 },
      { predicted: 'review', observed: 'review', count: 1 },
    ]);
  });

  it('uses null for undefined ratios instead of NaN', () => {
    expect(createCalibrationReport([], []).summary).toEqual({
      records: 0,
      labeled: 0,
      unlabeled: 0,
      coverage: null,
      correct: 0,
      incorrect: 0,
      accuracy: null,
    });

    const report = createCalibrationReport([record('unlabeled', 'review')], []);
    expect(report.summary.coverage).toBe(0);
    expect(report.summary.accuracy).toBeNull();
    expect(report.labels).toEqual([]);
    expect(report.transitions).toEqual([]);
  });

  it('reports labels that are observed but never predicted', () => {
    const report = createCalibrationReport(
      [record('new-label', 'review')],
      [outcome('new-label', 'escalate')],
    );

    expect(report.labels).toEqual([
      {
        label: 'escalate',
        predicted: 0,
        observed: 1,
        correct: 0,
        precision: null,
        recall: 0,
      },
      {
        label: 'review',
        predicted: 1,
        observed: 0,
        correct: 0,
        precision: 0,
        recall: null,
      },
    ]);
  });
});
