#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  PolicyParseError,
  PolicyValidationError,
  RecorderError,
  ReplayCompatibilityError,
  StateValidationError,
} from '../errors.js';
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
  jevpolicy evaluate <policy.yaml> --state <state.json> [--facts <facts.json>] [--record <decisions.jsonl> | --no-record] [--json]
  jevpolicy replay <decisions.jsonl> --policy <policy.yaml> [--json]`);
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
  const valueOptions = new Set(['--state', '--facts', '--record', '--policy']);
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

async function evaluateCommand(options: {
  readonly policyPath: string;
  readonly statePath: string;
  readonly factsPath?: string;
  readonly recordPath?: string;
  readonly noRecord: boolean;
  readonly json: boolean;
}): Promise<number> {
  const policy = await loadPolicyFile(resolve(options.policyPath));
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
  const result = await runtime.evaluate({ state, facts });

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
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
    error instanceof PolicyParseError ||
    error instanceof StateValidationError ||
    error instanceof ReplayCompatibilityError ||
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
      parsed.command === 'evaluate' &&
      parsed.positional.length === 1 &&
      parsed.values.has('--state') &&
      !parsed.values.has('--policy') &&
      !(parsed.flags.has('--no-record') && parsed.values.has('--record'))
    ) {
      return await evaluateCommand({
        policyPath: parsed.positional[0]!,
        statePath: parsed.values.get('--state')!,
        ...(parsed.values.get('--facts') === undefined
          ? {}
          : { factsPath: parsed.values.get('--facts')! }),
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
