# CLI Reference

This document enumerates Overkill's command-line interface — subcommands
and flags. It is a reading aid: the canonical behavior of each option
lives in the relevant domain doc and is linked here.

The CLI surface follows `principles.md` § One First-Party Path Per
Layer: per-run intent lives on the CLI, persistent project policy lives
in the config file (`configuration.md`), and no setting is reachable
from both surfaces.

## Subcommands

| Command                          | Purpose                                                     | Reference                                               |
| -------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------- |
| `overkill run [paths...]`        | Default run mode — discover, plan, and execute.             | `runtime-behavior.md`                                   |
| `overkill list [paths...]`       | Print the resolved test plan without running it.            | `tests-as-values.md`                                    |
| `overkill replay <run-id>`       | Replay a recorded run from `.overkill/runs/<id>.json`.      | `reproducibility.md` § Replay                           |
| `overkill replay-witness <path>` | Replay a single property/simulation failure from a witness. | `failure-artifacts.md` § Witnesses And Replay Artifacts |

## Selection And Iteration

| Flag                | Behavior                                                               | Reference                                               |
| ------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------- |
| `--filter '<expr>'` | Filter tests by metadata expression (tags, kind, runtime, owner, …).   | `metadata-and-selection.md` § Filter Expression Grammar |
| `--name '<text>'`   | Name substring or quoted exact match.                                  | `metadata-and-selection.md` § Local Iteration Workflow  |
| `--file <path>`     | Restrict the run to a single file.                                     | same                                                    |
| `--id <stable-id>`  | Restrict the run to a single case identity (IDE integration).          | same                                                    |
| `--last-failed`     | Run only tests that failed in the previous run.                        | same                                                    |
| `--changed`         | Run tests in files changed since `main`. Path-level only; no graph.    | same                                                    |
| `--watch`           | Rerun the selected suite on file change. Uses Node's built-in watcher. | `runtime-behavior.md` § Watch-Mode Targeting            |
| `--shard <i>/<n>`   | Select shard `i` of `n` from the filtered set.                         | `runtime-behavior.md` § Sharding                        |

## Capability And Execution

| Flag                | Behavior                                                                | Reference                                     |
| ------------------- | ----------------------------------------------------------------------- | --------------------------------------------- |
| `--profile <name>`  | Select a runner profile (e.g. `microtest`, `integration`, `benchmark`). | `microtests-and-capabilities.md`              |
| `--mode <strategy>` | Override the resolved execution strategy (serial, worker-pool, …).      | `runtime-behavior.md` § Parallelism Semantics |
| `--workers <n>`     | Override default worker count for worker-pool modes.                    | same                                          |

## Baselines

| Flag                    | Behavior                                                               | Reference                                      |
| ----------------------- | ---------------------------------------------------------------------- | ---------------------------------------------- |
| `--update-baselines`    | Full baseline update: create, overwrite, and remove stale. CI rejects. | `baselines-and-snapshots.md` § Update Workflow |
| `--no-update-baselines` | Force baseline-update mode off (already the default in CI).            | `runtime-behavior.md` § CI Auto-Detection      |

## Output And Reporters

| Flag                | Behavior                                              | Reference                                      |
| ------------------- | ----------------------------------------------------- | ---------------------------------------------- |
| `--reporter <name>` | Select a reporter; may be specified multiple times.   | `package-architecture.md` § Reporters          |
| `--no-capture`      | Pass stdout/stderr through live instead of buffering. | `runtime-behavior.md` § Console Output Capture |

## Lifecycle And Edge Cases

| Flag                | Behavior                                                             | Reference                                 |
| ------------------- | -------------------------------------------------------------------- | ----------------------------------------- |
| `--allow-empty`     | Treat zero-test runs as success instead of failure.                  | `runtime-behavior.md` § Zero-Test Runs    |
| `--ci`              | Force CI defaults on a developer host.                               | `runtime-behavior.md` § CI Auto-Detection |
| `--no-ci`           | Force developer-mode defaults on a CI host.                          | same                                      |
| `--seed <n>`        | Override the run seed (for reproducible randomization).              | `reproducibility.md`                      |
| `--debug`           | Emit a structured debug artifact for every test in the resolved set. | `runtime-behavior.md` § Test Debug Mode   |
| `--debug-test <id>` | Emit a debug artifact for a single test by ID or selector pattern.   | same                                      |

This list intentionally omits flags that are still under design (e.g.
`--coverage`, `--since <ref>`, `--shuffle`); when those land, this
table is the place they should be registered.
