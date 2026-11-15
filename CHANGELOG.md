# Changelog

This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and uses a `0.x` research versioning scheme: minor versions may change experimental behaviour, and patch versions only fix defects or documentation.

## [Unreleased]

### Planned

- Independent human annotation for the 18 semantic tasks, with Cohen's kappa reported alongside the existing simulated agreement check.
- A second end-to-end model run on a different candidate model, keeping the same preregistered protocol.
- Optional real open-network experiment, gated on a separate boundary review.

## [0.1.0] - 2026-11-15

First public research release.

### Added

- Ed25519 genesis identity, signed append-only event chain, and replay that fails closed on tampering.
- Ephemeral bodies, perception, pulses, actions, memory, metabolic credits, death, resurrection, and lineage forks.
- Local Git bare relay plus GitHub relay transport over `nna-events/<agentId>` branches, with readonly observation and observer forks.
- `deterministic`, `stochastic`, and optional `model` cognition organs behind one adapter interface.
- Generic model gateway support through `NNA_MODEL_BASE_URL`, `NNA_MODEL_API_KEY`, and optional non-auth headers.
- `L4-simulation` for latency, duplication, conflict, and rate-limit conditions, plus a loopback-only dashboard.
- Preregistered formal experiment, model qualification, end-to-end model experiment, stability study, offline baselines, and annotation tooling.
- `evidence/` archive with raw NDJSON, JSON summaries, and six generated figures pinned by SHA-256.
- `npm run sample:run` synthetic onboarding run, `npm run audit:public`, and `npm run verify:repository`.
- MIT license, security policy, contribution guide, and public release checklist.

### Known limitations

- The default cognition organ remains `deterministic`; model compliance does not imply semantic correctness.
- The 18-task intent labels are single-author and unverified until independent annotation is complete.
- No public open-network run, distributed consensus, or multi-host scheduler exists yet.
- The model figures were produced through a remote chart rendering service; archived PNGs are authoritative.
