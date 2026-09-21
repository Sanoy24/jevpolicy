# Contributing to JevPolicy

JevPolicy is a deterministic policy runtime around probabilistic signals. Changes
must preserve provider isolation, replayability, strict validation, and the host
application's ownership of side effects.

## Development

Requirements:

- Node.js 22.18.0 or later
- npm

Run the local checks with:

```bash
npm install
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

Unit tests must not require network access. Live Gateway tests must remain opt-in.
Do not add provider-specific types to core or policy modules.
