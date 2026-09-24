#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { createCalibrationReport } from '../analysis/calibration.js';
import { createConfidenceBandReport } from '../analysis/confidence.js';
import {
  OutcomeValidationError,
  PolicyParseError,
  PolicyValidationError,
  RecorderError,
  ReplayCompatibilityError,
  ShadowCompatibilityError,
  StateValidationError,
} from '../errors.js';
import { loadDecisionOutcomes } from '../outcomes/loader.js';
import { diffPolicies, type PolicyChange } from '../policy/diff.js';
import { loadPolicyFile } from '../policy/loader.js';
import { validateEvaluationState } from '../providers/state.js';
import type { EvaluationState } from '../providers/types.js';
import { JsonlRecorder } from '../recorders/jsonl-recorder.js';
import { replayRecords } from '../replay/compatibility.js';
import { loadDecisionRecords } from '../replay/loader.js';
import { createJevPolicyRuntime } from '../runtime/factory.js';

function usage(): void {
  console.error(`Usage:
  jevpolicy validate <policy.yaml> [--json]
  jevpolicy diff <base-policy.yaml> <candidate-policy.yaml> [--json]
  jevpolicy evaluate <policy.yaml> --state <state.json> [--facts <facts.json>] [--shadow-policy <candidate.yaml>] [--record <decisions.jsonl> | --no-record] [--json]
  jevpolicy replay <decisions.jsonl> --policy <policy.yaml> [--json]
  jevpolicy calibrate <decisions.jsonl> --outcomes <outcomes.jsonl> [--json]
  jevpolicy confidence <decisions.jsonl> --outcomes <outcomes.jsonl> [--boundaries <0,0.2,...,1>] [--json]`);
}

interface ParsedArguments {
  readonly command: string | undefined;
  readonly positional: readonly string[];
  readonly values: ReadonlyMap<string, string>;
  readonly flags: ReadonlySet<string>;
}

function parseArguments(args: readonly string[]): ParsedArguments | null {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  const positional: string[] = [];
  const valueOptions = new Set([
    '--state',
    '--facts',
    '--record',
    '--policy',
    '--shadow-policy',
    '--outcomes',
    '--boundaries',
  ]);
  const flagOptions = new Set(['--json', '--no-record']);

  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === undefined) continue;
    if (valueOptions.has(argument)) {
      const value = args[index + 1];
      if (
        value === undefined ||
        value.startsWith('--') ||
        values.has(argument)
      ) {
        return null;
      }
      values.set(argument, value);
      index += 1;
    } else if (flagOptions.has(argument)) {
      if (flags.has(argument)) return null;
      flags.add(argument);
    } else if (argument.startsWith('--')) {
      return null;
    } else {
      positional.push(argument);
    }
  }

  return { command: args[0], positional, values, flags };
}

async function readJson(path: string): Promise<unknown> {
  const source = await readFile(resolve(path), 'utf8');
  if (Buffer.byteLength(source, 'utf8') > 1024 * 1024) {
    throw new StateValidationError(`JSON input '${path}' exceeds 1 MiB`);
  }
  try {
    return JSON.parse(source) as unknown;
  } catch (error) {
    throw new StateValidationError(`Invalid JSON input '${path}'`, {
      cause: error,
    });
  }
}

function deriveFacts(
  state: EvaluationState,
  factNames: readonly string[],
): Record<string, unknown> {
  if (state === null || typeof state !== 'object' || Array.isArray(state)) {
    return {};
  }
  const stateObject = state as Readonly<Record<string, unknown>>;
  return Object.fromEntries(
    factNames
      .filter((name) => Object.prototype.hasOwnProperty.call(stateObject, name))
      .map((name) => [name, stateObject[name]]),
  );
}

async function validateCommand(path: string, json: boolean): Promise<number> {
  const policy = await loadPolicyFile(resolve(path));
  if (json) {
    console.log(
      JSON.stringify(
        {
          valid: true,
          policy: {
            name: policy.name,
            version: policy.version,
            schema: policy.schema,
            fingerprint: policy.fingerprint,
          },
        },
        null,
        2,
      ),
    );
  } else {
    console.log(`Valid policy: ${policy.name}@${policy.version}`);
    console.log(`Fingerprint: ${policy.fingerprint}`);
  }
  return 0;
}

function formatChangeValue(value: unknown): string {
  return value === undefined ? '<absent>' : JSON.stringify(value);
}

function formatPolicyChange(change: PolicyChange): string {
  switch (change.kind) {
    case 'added':
      return `+ ${change.path}: ${formatChangeValue(change.after)}`;
    case 'removed':
      return `- ${change.path}: ${formatChangeValue(change.before)}`;
    case 'changed':
      return `~ ${change.path}: ${formatChangeValue(change.before)} -> ${formatChangeValue(change.after)}`;
    case 'moved':
      return `> ${change.path}: index ${change.beforeIndex} -> ${change.afterIndex}`;
  }
}

async function diffCommand(
  basePath: string,
  candidatePath: string,
  json: boolean,
): Promise<number> {
  const [base, candidate] = await Promise.all([
    loadPolicyFile(resolve(basePath)),
    loadPolicyFile(resolve(candidatePath)),
  ]);
  const result = diffPolicies(base, candidate);
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(
      `Policy         ${base.name}@${base.version} -> ${candidate.name}@${candidate.version}`,
    );
    console.log(
      `Changes        ${result.summary.total} (+${result.summary.added} -${result.summary.removed} ~${result.summary.changed} >${result.summary.moved})`,
    );
    for (const change of result.changes) {
      console.log(formatPolicyChange(change));
    }
  }
  return 0;
}

async function evaluateCommand(options: {
  readonly policyPath: string;
  readonly statePath: string;
  readonly factsPath?: string;
  readonly shadowPolicyPath?: string;
  readonly recordPath?: string;
  readonly noRecord: boolean;
  readonly json: boolean;
}): Promise<number> {
  const policy = await loadPolicyFile(resolve(options.policyPath));
  const shadowPolicy =
    options.shadowPolicyPath === undefined
      ? undefined
      : await loadPolicyFile(resolve(options.shadowPolicyPath));
  const state = validateEvaluationState(await readJson(options.statePath));
  const facts =
    options.factsPath === undefined
      ? deriveFacts(state, Object.keys(policy.facts))
      : await readJson(options.factsPath);
  const recorder = options.noRecord
    ? undefined
    : new JsonlRecorder(resolve(options.recordPath ?? 'decisions.jsonl'));
  const runtime = createJevPolicyRuntime({
    policy,
    provider: { type: 'vercel-jev', model: 'typesafe-ai/jev' },
    ...(recorder === undefined ? {} : { recorder }),
  });
  const result =
    shadowPolicy === undefined
      ? await runtime.evaluate({ state, facts })
      : await runtime.evaluateWithShadow({ shadowPolicy, state, facts });

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if ('active' in result) {
    const activeMatch =
      result.active.matched.preconditionId ??
      result.active.matched.ruleId ??
      '-';
    const shadowMatch =
      result.shadow.matched.preconditionId ??
      result.shadow.matched.ruleId ??
      '-';
    console.log(`Active         ${result.active.decision}`);
    console.log(`Shadow         ${result.shadow.decision}`);
    console.log(
      `Policy         ${policy.name}@${policy.version} -> ${shadowPolicy!.name}@${shadowPolicy!.version}`,
    );
    console.log(`Matched        ${activeMatch} -> ${shadowMatch}`);
    console.log(
      `Changed        ${result.comparison.decisionChanged ? 'yes' : 'no'}`,
    );
    console.log(`Provider       ${result.active.provider.model}`);
    console.log(`Latency        ${result.active.timing.totalMs.toFixed(1)}ms`);
  } else {
    console.log(`Decision       ${result.decision}`);
    console.log(`Policy         ${policy.name}@${policy.version}`);
    console.log(
      `Matched        ${result.matched.preconditionId ?? result.matched.ruleId ?? '-'}`,
    );
    console.log(`Mode           ${result.mode}`);
    console.log(`Provider       ${result.provider.model}`);
    console.log(`Latency        ${result.timing.totalMs.toFixed(1)}ms`);
    console.log(
      `Fallback       ${result.fallback.used ? result.fallback.reason : 'no'}`,
    );
  }
  return 0;
}

async function replayCommand(options: {
  readonly recordsPath: string;
  readonly policyPath: string;
  readonly json: boolean;
}): Promise<number> {
  const [records, policy] = await Promise.all([
    loadDecisionRecords(resolve(options.recordsPath)),
    loadPolicyFile(resolve(options.policyPath)),
  ]);
  const result = replayRecords(records, policy);
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Records        ${result.summary.records}`);
    console.log(`Unchanged      ${result.summary.unchanged}`);
    console.log(`Changed        ${result.summary.changed}`);
    for (const transition of result.summary.transitions) {
      console.log(
        `${transition.from} -> ${transition.to}  ${transition.count}`,
      );
    }
  }
  return 0;
}

function formatPercentage(value: number | null): string {
  return value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`;
}

async function calibrateCommand(options: {
  readonly recordsPath: string;
  readonly outcomesPath: string;
  readonly json: boolean;
}): Promise<number> {
  const [records, outcomes] = await Promise.all([
    loadDecisionRecords(resolve(options.recordsPath)),
    loadDecisionOutcomes(resolve(options.outcomesPath)),
  ]);
  const result = createCalibrationReport(records, outcomes);
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Records        ${result.summary.records}`);
    console.log(`Labeled        ${result.summary.labeled}`);
    console.log(`Unlabeled      ${result.summary.unlabeled}`);
    console.log(`Coverage       ${formatPercentage(result.summary.coverage)}`);
    console.log(`Accuracy       ${formatPercentage(result.summary.accuracy)}`);
    for (const transition of result.transitions) {
      console.log(
        `${transition.predicted} -> ${transition.observed}  ${transition.count}`,
      );
    }
  }
  return 0;
}

function parseConfidenceBoundaries(value: string): readonly number[] {
  const boundaries = value.split(',').map((entry) => Number(entry.trim()));
  if (boundaries.some((entry) => !Number.isFinite(entry))) {
    throw new RangeError(
      'Confidence boundaries must be comma-separated finite numbers',
    );
  }
  return boundaries;
}

async function confidenceCommand(options: {
  readonly recordsPath: string;
  readonly outcomesPath: string;
  readonly boundaries?: readonly number[];
  readonly json: boolean;
}): Promise<number> {
  const [records, outcomes] = await Promise.all([
    loadDecisionRecords(resolve(options.recordsPath)),
    loadDecisionOutcomes(resolve(options.outcomesPath)),
  ]);
  const result = createConfidenceBandReport(records, outcomes, {
    ...(options.boundaries === undefined
      ? {}
      : { boundaries: options.boundaries }),
  });
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Records        ${result.summary.records}`);
    console.log(`Labeled        ${result.summary.labeled}`);
    console.log(`Unlabeled      ${result.summary.unlabeled}`);
    console.log(`Coverage       ${formatPercentage(result.summary.coverage)}`);
    console.log(`Observations   ${result.summary.observations}`);
    console.log(`Out of range   ${result.summary.outOfRange}`);
    for (const group of result.groups) {
      console.log(`${group.question} [${group.signalType}/${group.measure}]`);
      for (const band of group.bands) {
        if (band.observations === 0) continue;
        const closing = band.upperInclusive ? ']' : ')';
        console.log(
          `  [${band.lower}, ${band.upper}${closing}  ${band.observations}  accuracy=${formatPercentage(band.decisionAccuracy)}`,
        );
      }
    }
  }
  return 0;
}

function reportError(error: unknown, json: boolean): number {
  if (error instanceof PolicyValidationError) {
    console.error(
      json
        ? JSON.stringify(
            { valid: false, error: error.name, issues: error.issues },
            null,
            2,
          )
        : error.message,
    );
    if (!json) {
      for (const entry of error.issues) {
        console.error(`  ${entry.path || '<root>'}: ${entry.message}`);
      }
    }
    return 1;
  }
  const knownError =
    error instanceof OutcomeValidationError ||
    error instanceof PolicyParseError ||
    error instanceof StateValidationError ||
    error instanceof ReplayCompatibilityError ||
    error instanceof ShadowCompatibilityError ||
    error instanceof RecorderError;
  if (knownError) {
    console.error(
      json
        ? JSON.stringify({
            error: error.name,
            message: error.message,
          })
        : error.message,
    );
    return 1;
  }
  if (error instanceof Error) {
    console.error(
      json
        ? JSON.stringify({ error: error.name, message: error.message })
        : error.message,
    );
    return 1;
  }
  console.error(
    json ? JSON.stringify({ error: 'UnknownError' }) : String(error),
  );
  return 1;
}

export async function runCli(args: readonly string[]): Promise<number> {
  const parsed = parseArguments(args);
  if (parsed === null) {
    usage();
    return 2;
  }
  const json = parsed.flags.has('--json');

  try {
    if (
      parsed.command === 'validate' &&
      parsed.positional.length === 1 &&
      parsed.values.size === 0 &&
      !parsed.flags.has('--no-record')
    ) {
      return await validateCommand(parsed.positional[0]!, json);
    }
    if (
      parsed.command === 'diff' &&
      parsed.positional.length === 2 &&
      parsed.values.size === 0 &&
      !parsed.flags.has('--no-record')
    ) {
      return await diffCommand(
        parsed.positional[0]!,
        parsed.positional[1]!,
        json,
      );
    }
    if (
      parsed.command === 'evaluate' &&
      parsed.positional.length === 1 &&
      parsed.values.has('--state') &&
      !parsed.values.has('--policy') &&
      !parsed.values.has('--outcomes') &&
      !parsed.values.has('--boundaries') &&
      !(parsed.flags.has('--no-record') && parsed.values.has('--record'))
    ) {
      return await evaluateCommand({
        policyPath: parsed.positional[0]!,
        statePath: parsed.values.get('--state')!,
        ...(parsed.values.get('--facts') === undefined
          ? {}
          : { factsPath: parsed.values.get('--facts')! }),
        ...(parsed.values.get('--shadow-policy') === undefined
          ? {}
          : { shadowPolicyPath: parsed.values.get('--shadow-policy')! }),
        ...(parsed.values.get('--record') === undefined
          ? {}
          : { recordPath: parsed.values.get('--record')! }),
        noRecord: parsed.flags.has('--no-record'),
        json,
      });
    }
    if (
      parsed.command === 'replay' &&
      parsed.positional.length === 1 &&
      parsed.values.size === 1 &&
      parsed.values.has('--policy') &&
      !parsed.flags.has('--no-record')
    ) {
      return await replayCommand({
        recordsPath: parsed.positional[0]!,
        policyPath: parsed.values.get('--policy')!,
        json,
      });
    }
    if (
      parsed.command === 'calibrate' &&
      parsed.positional.length === 1 &&
      parsed.values.size === 1 &&
      parsed.values.has('--outcomes') &&
      !parsed.flags.has('--no-record')
    ) {
      return await calibrateCommand({
        recordsPath: parsed.positional[0]!,
        outcomesPath: parsed.values.get('--outcomes')!,
        json,
      });
    }
    if (
      parsed.command === 'confidence' &&
      parsed.positional.length === 1 &&
      parsed.values.has('--outcomes') &&
      parsed.values.size <= 2 &&
      [...parsed.values.keys()].every(
        (key) => key === '--outcomes' || key === '--boundaries',
      ) &&
      !parsed.flags.has('--no-record')
    ) {
      const boundaries = parsed.values.get('--boundaries');
      return await confidenceCommand({
        recordsPath: parsed.positional[0]!,
        outcomesPath: parsed.values.get('--outcomes')!,
        ...(boundaries === undefined
          ? {}
          : { boundaries: parseConfidenceBoundaries(boundaries) }),
        json,
      });
    }
  } catch (error) {
    return reportError(error, json);
  }

  usage();
  return 2;
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  process.exitCode = await runCli(process.argv.slice(2));
}
