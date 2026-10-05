# Changesets

Every user-facing change should include a changeset describing it.
Releases are cut manually: the pending changesets are folded into
`CHANGELOG.md`, `package.json` is bumped, and the consumed changesets are
deleted in the release PR.
