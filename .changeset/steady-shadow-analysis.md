---
'@sanoy24/jevpolicy': minor
---

Harden decision evaluation and analysis: built-in object property names such as
`constructor` are no longer treated as declared facts, signals, or choice
values; shadow envelopes and records carry `activeDecisionId`; `RecorderError`
always exposes the live envelope (with `shadow` and `failedMode`); a caller
abort rejects instead of recording a fallback; custom providers receive
`providerOptions` through `createJevPolicyRuntime`; and calibration and
confidence reports analyze live records by default, accept `mode` and
`policyFingerprint` filters (`--mode`, `--policy-fingerprint`), score shadow
records against their live decision's outcome, and list the policies covered.
