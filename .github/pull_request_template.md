## What changed

<!-- One or two sentences. Link the issue if there is one. -->

## Why

<!-- The defect, missing evidence, or protocol gap this addresses. -->

## Verification

- [ ] `npm test`
- [ ] `npm run audit:public`
- [ ] `npm run check` (if a demo, relay, or evidence path changed)

## Boundaries

- [ ] No credentials, `identity.key`, `habitat/`, `work/`, or local absolute paths are added.
- [ ] Claims still match archived evidence; negative results are recorded rather than removed.
- [ ] Documents are updated when a command, claim, or boundary changes.
