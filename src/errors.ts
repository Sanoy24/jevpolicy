import type { DecisionEnvelope } from './runtime/types.js';

export interface PolicyIssue {
  readonly path: string;
  readonly message: string;
  readonly code: string;
}

export class PolicyParseError extends Error {
  readonly source: string | undefined;

  constructor(message: string, options?: { source?: string; cause?: unknown }) {
    super(message, { cause: options?.cause });
    this.name = 'PolicyParseError';
    this.source = options?.source;
  }
}

export class PolicyValidationError extends Error {
  readonly issues: readonly PolicyIssue[];

  constructor(issues: readonly PolicyIssue[]) {
    super(
      issues.length === 1
        ? `Policy validation failed: ${issues[0]?.message ?? 'unknown error'}`
        : `Policy validation failed with ${issues.length} issues`,
    );
    this.name = 'PolicyValidationError';
    this.issues = issues;
  }
}

export class StateValidationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'StateValidationError';
  }
}

export class ProviderError extends Error {
  readonly provider: string;
  readonly model: string;

  constructor(
    message: string,
    options: ErrorOptions & { provider: string; model: string },
  ) {
    super(message, options);
    this.name = 'ProviderError';
    this.provider = options.provider;
    this.model = options.model;
  }
}

export class ProviderTimeoutError extends ProviderError {
  constructor(
    message: string,
    options: ErrorOptions & { provider: string; model: string },
  ) {
    super(message, options);
    this.name = 'ProviderTimeoutError';
  }
}

export class ProviderResponseError extends ProviderError {
  constructor(
    message: string,
    options: ErrorOptions & { provider: string; model: string },
  ) {
    super(message, options);
    this.name = 'ProviderResponseError';
  }
}

export class RecorderError extends Error {
  readonly envelope: DecisionEnvelope;

  constructor(
    message: string,
    envelope: DecisionEnvelope,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'RecorderError';
    this.envelope = envelope;
  }
}

export class ReplayCompatibilityError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ReplayCompatibilityError';
  }
}

export class ShadowCompatibilityError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ShadowCompatibilityError';
  }
}
