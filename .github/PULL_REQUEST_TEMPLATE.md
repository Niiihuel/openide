<!--
Thanks for contributing to OpenIDE. Keep this short: what changed and why, plus
enough for a reviewer to reproduce your verification. Delete anything that does
not apply.
-->

## What this changes

<!-- One or two sentences. What behaviour is different after this merges? -->

## Why

<!-- What problem does it solve? If it fixes a bug, describe how the bug shows
up for the user, not just where it is in the code. -->

## How it was verified

<!-- Paste what you ran and what it said. "Tests pass" is not verification; the
output is. See CONTRIBUTING.md for the full list of checks. -->

```sh
```

## Checklist

- [ ] Comments and docs are in English (`node dev/audit-comment-language.mjs`)
- [ ] `npm run compile` succeeds from a clean checkout
- [ ] Tests cover the change, or the PR says why they cannot
- [ ] If it touches an upstream file under `vscode/src`, the description says
      why the change could not live in an `openide*` folder — every such file is
      extra work on the next Code OSS update (see `docs/fork-architecture.md`)
