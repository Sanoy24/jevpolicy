import { readFile } from 'node:fs/promises';

import { parseDocument } from 'yaml';

import { PolicyTestValidationError } from '../errors.js';
import { validatePolicyTestSuite, type PolicyTestSuite } from './schema.js';

export function parsePolicyTests(
  text: string,
  source = '<inline>',
): PolicyTestSuite {
  if (Buffer.byteLength(text, 'utf8') > 1_048_576) {
    throw new PolicyTestValidationError(
      'Policy tests exceed the 1 MiB size limit',
      {
        source,
      },
    );
  }
  try {
    const document = parseDocument(text, {
      customTags: [],
      prettyErrors: true,
      strict: true,
      uniqueKeys: true,
      version: '1.2',
    });
    const issues = [...document.errors, ...document.warnings];
    if (issues.length > 0) {
      throw new PolicyTestValidationError(
        issues.map((issue) => issue.message).join('\n'),
        { source },
      );
    }
    return validatePolicyTestSuite(
      document.toJS({ maxAliasCount: 100 }),
      source,
    );
  } catch (error) {
    if (error instanceof PolicyTestValidationError) throw error;
    throw new PolicyTestValidationError(
      `Could not parse policy tests '${source}'`,
      {
        source,
        cause: error,
      },
    );
  }
}

export async function loadPolicyTests(path: string): Promise<PolicyTestSuite> {
  try {
    return parsePolicyTests(await readFile(path, 'utf8'), path);
  } catch (error) {
    if (error instanceof PolicyTestValidationError) throw error;
    throw new PolicyTestValidationError(
      `Could not read policy tests '${path}'`,
      {
        source: path,
        cause: error,
      },
    );
  }
}
