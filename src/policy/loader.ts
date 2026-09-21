import { readFile } from 'node:fs/promises';

import { parseDocument } from 'yaml';

import { PolicyParseError, PolicyValidationError } from '../errors.js';
import { compilePolicy, type CompiledPolicy } from './compiler.js';

const maximumPolicyBytes = 1_048_576;

export function parsePolicyText(
  sourceText: string,
  source = '<inline>',
): CompiledPolicy {
  if (Buffer.byteLength(sourceText, 'utf8') > maximumPolicyBytes) {
    throw new PolicyParseError('Policy exceeds the 1 MiB size limit', {
      source,
    });
  }

  try {
    const document = parseDocument(sourceText, {
      customTags: [],
      prettyErrors: true,
      strict: true,
      uniqueKeys: true,
      version: '1.2',
    });
    if (document.errors.length > 0) {
      throw new PolicyParseError(
        document.errors.map((error) => error.message).join('\n'),
        {
          source,
        },
      );
    }
    return compilePolicy(document.toJS({ maxAliasCount: 100 }));
  } catch (error) {
    if (
      error instanceof PolicyParseError ||
      error instanceof PolicyValidationError
    ) {
      throw error;
    }
    throw new PolicyParseError(`Could not parse policy '${source}'`, {
      source,
      cause: error,
    });
  }
}

export async function loadPolicyFile(path: string): Promise<CompiledPolicy> {
  try {
    return parsePolicyText(await readFile(path, 'utf8'), path);
  } catch (error) {
    if (error instanceof PolicyParseError) {
      throw error;
    }
    if (error instanceof PolicyValidationError) {
      throw error;
    }
    throw new PolicyParseError(`Could not read policy '${path}'`, {
      source: path,
      cause: error,
    });
  }
}
