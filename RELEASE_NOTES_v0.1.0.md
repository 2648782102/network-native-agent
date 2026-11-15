# network-native-agent v0.1.0

First public release of a reproducible research sandbox for network-native AI agent runtimes.

## What this is

The project tests one claim: if identity, memory, perception, and action belong to a signed, replayable event chain instead of a process, then process death no longer equals agent death.

An `agentId` comes from an Ed25519 genesis public key. Every wake creates a new `bodyId`. Death, resurrection, and lineage forks are first-class signed events. Replaying the chain reconstructs the same identity and state, and tampering fails closed.

## What is included

- **Runtime**: genesis identity, signed append-only events, replay, metabolic credits, death, resurrection, forks, observer forks.
- **Transport**: local bare Git relay and GitHub relay over `nna-events/<agentId>` branches, plus controlled LAN mode.
- **Cognition organs**: `deterministic` (default), `stochastic`, and optional `model` behind one adapter interface.
- **Model gateway**: provider-neutral HTTP integration via `NNA_MODEL_BASE_URL` and `NNA_MODEL_API_KEY`.
- **Experiments**: preregistered formal experiment, model qualification, end-to-end model run, stability study, offline baselines, annotation tooling.
- **Evidence**: raw NDJSON, JSON analyses, and six figures pinned by SHA-256 in `evidence/figures/manifest.json`.

## Headline results

| Organ | Compliance | Intent match |
| --- | ---: | ---: |
| `deterministic` | 72/72 | 0.1944 |
| `stochastic` | 72/72 | 0.2639 |
| `candidate-model-1` | 72/72 | 0.5833 |
| `candidate-model-2` | 58/72 | 0.5556 |

The conclusion is deliberately narrow: **structural compliance is not semantic correctness**. The candidate model emits valid four-word impulses every time, yet agrees with the preregistered intent only 58.3% of the time. The default organ therefore stays `deterministic`.

The intent labels are single-author and unverified. A simulated two-annotator check yields κ = 0.4836 with 7 of 18 tasks disagreeing, which is why intent match is reported as a diagnostic rather than a ranking signal.

## Try it

```bash
npm test
npm run sample:run
npm run check
```

No dependencies and no API key are required for the default path.

## Boundaries

This release does not show that an agent is alive on the open internet, that a model is intelligent, or that the runtime is production-ready. L4 is a local simulation. Real open-network operation requires a separate boundary review, dedicated credentials, a budget, and an explicit start and end time.

## Known limitations

- Intent labels await independent human annotation.
- Model evidence covers two candidate models from one gateway.
- The chart rendering script calls an external service; archived PNGs are the authoritative artifacts.

Full details: [README.md](README.md), [FINDINGS.md](FINDINGS.md), [CHANGELOG.md](CHANGELOG.md).
