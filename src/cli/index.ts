#!/usr/bin/env node

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { PolicyParseError, PolicyValidationError } from '../errors.js';
import { loadPolicyFile } from '../policy/loader.js';

function usage(): void {
  console.error('Usage: jevpolicy validate <policy.yaml> [--json]');
}

async function validate(path: string, json: boolean): Promise<number> {
  try {
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
  } catch (error) {
    if (error instanceof PolicyValidationError) {
      if (json) {
        console.error(
          JSON.stringify(
            { valid: false, error: error.name, issues: error.issues },
            null,
            2,
          ),
        );
      } else {
        console.error(error.message);
        for (const entry of error.issues) {
          console.error(`  ${entry.path || '<root>'}: ${entry.message}`);
        }
      }
      return 1;
    }
    if (error instanceof PolicyParseError) {
      console.error(
        json
          ? JSON.stringify({
              valid: false,
              error: error.name,
              message: error.message,
            })
          : error.message,
      );
      return 1;
    }
    throw error;
  }
}

export async function runCli(args: readonly string[]): Promise<number> {
  const json = args.includes('--json');
  const positional = args.filter((argument) => argument !== '--json');
  if (positional[0] !== 'validate' || positional.length !== 2) {
    usage();
    return 2;
  }
  const policyPath = positional[1];
  if (policyPath === undefined) {
    usage();
    return 2;
  }
  return validate(policyPath, json);
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  process.exitCode = await runCli(process.argv.slice(2));
}
