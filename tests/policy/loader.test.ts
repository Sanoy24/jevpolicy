import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { PolicyParseError, PolicyValidationError } from '../../src/errors.js';
import { loadPolicyFile, parsePolicyText } from '../../src/policy/loader.js';

describe('policy loading', () => {
  it('loads the support-routing example without network access', async () => {
    const policy = await loadPolicyFile('examples/support-routing.policy.yaml');
    expect(policy.name).toBe('support-routing');
    expect(policy.questions['urgent']?.type).toBe('boolean');
  });

  it('rejects malformed YAML', () => {
    expect(() => parsePolicyText('schema: [')).toThrow(PolicyParseError);
  });

  it('rejects duplicate YAML keys', () => {
    expect(() => parsePolicyText('name: one\nname: two')).toThrow(
      PolicyParseError,
    );
  });

  it('reports schema failures separately from YAML failures', async () => {
    const text = await readFile('examples/support-routing.policy.yaml', 'utf8');
    expect(() =>
      parsePolicyText(text.replace('version: 1', 'version: zero')),
    ).toThrow(PolicyValidationError);
  });
});
