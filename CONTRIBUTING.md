# Contributing

## Before you start

- Read `RESEARCH.md`, `BOUNDARY.md`, and `RUNTIME_SPEC.md`.
- Keep experiments inside the sandbox: local loopback, local bare Git remotes, or your own private relay.
- Do not add credentials, real user data, or third-party write operations.
- Run `npm run audit:public` before opening a pull request.

## Development

```bash
npm test
npm run check
npm run verify:repository
```

`npm run check` runs the full local suite. `npm run verify:repository` clones the repository into a temp directory, runs tests, checks archived evidence, scans for secret-like strings, and confirms retired commands stay retired.

## Pull requests

- Keep changes small and focused.
- Add or update a test for behavior changes.
- Update the relevant document when a claim, boundary, or command changes.
- Do not weaken a claim to make a test pass; record negative results instead.

## Evidence

Experiments that produce claims must archive raw data under `evidence/` and state:
sample size, exclusions, uncertainty, and interpretation boundaries. A result that cannot be reproduced from archived data is not accepted as evidence.
