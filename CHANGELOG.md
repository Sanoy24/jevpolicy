# Changelog

All notable changes will be documented here.

## Unreleased

- Added the Node.js 22.18+, strict TypeScript, ESM, Vitest, ESLint, Prettier, and
  CI foundation.
- Added strict YAML policy parsing, schema and semantic validation, question and
  policy fingerprints, the support-routing example, and `jevpolicy validate`.
- Added the provider-independent signal model, fact and signal validation,
  recursive condition evaluator, deterministic preconditions, first-match rules,
  no-match fallback, and structured decision traces.
- Added the isolated AI SDK 7 Vercel JEV adapter for `typesafe-ai/jev`, explicit
  Gateway routing, strict Boolean/Choice/Score normalization, timeout handling,
  typed provider errors, mocked contract tests, and an opt-in live test.
- Added the dependency-injected decision runtime, stable decision envelopes,
  precondition short-circuiting, provider fallback orchestration, usage metadata,
  IDs, timestamps, and timing measurements.
- Added append-only JSONL recording, state privacy modes, redaction hooks,
  deterministic state fingerprints, declared-fact capture, and recorder errors
  that expose the already-computed envelope.
- Added fingerprint-compatible offline signal replay, change/transition
  summaries, strict JSONL loading, and `evaluate`/`replay` CLI commands.
