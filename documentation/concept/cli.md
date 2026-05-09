# CLI Reference

This document enumerates Overkill's command-line interface — subcommands
and flags. It is a reading aid: the canonical behavior of each option
lives in the relevant domain doc and is linked here.

The CLI surface follows `principles.md` § One First-Party Path Per
Layer: per-run intent lives on the CLI, persistent project policy lives
in the config file (`configuration.md`), and no setting is reachable
from both surfaces.

## Subcommands

### Run And Replay

| Command                          | Purpose                                                     | Reference                                               |
| -------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------- |
| `overkill run [paths...]`        | Default run mode — discover, plan, and execute.             | `runtime-behavior.md`                                   |
| `overkill list [paths...]`       | Print the resolved test plan without running it.            | `tests-as-values.md`                                    |
| `overkill replay <run-id>`       | Replay a recorded run from `.overkill/runs/<id>.json`.      | `reproducibility.md` § Replay                           |
| `overkill replay-witness <path>` | Replay a single property/simulation failure from a witness. | `failure-artifacts.md` § Witnesses And Replay Artifacts |

### Baseline

The `baseline` namespace groups operations on the on-disk baseline
artifacts. Verbs that execute tests (`update`, `apply`, `bootstrap`,
`diff`) accept the same selection, capability, output, and lifecycle
flags as `run` — they _are_ runs with different intended artifacts (see
`Flags vs Subcommands` below). `list` and `clean` operate on disk only
and do not run tests.

CI rejects every verb under `baseline` that writes to disk (`update`,
`apply`, `bootstrap`, `clean`); baseline writes require explicit intent
(an environment variable opt-in). `list` and `diff` are read-only and
allowed in CI.

| Command                                  | Behavior                                                                                                                     | Reference                                      |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `overkill baseline update [paths...]`    | **Day-to-day update.** Create missing, overwrite changed; **leave stale alone**. Default safe verb.                          | `baselines-and-snapshots.md` § Update Workflow |
| `overkill baseline apply [paths...]`     | **Full reconciliation.** Create missing, overwrite changed, **and remove stale orphans**. Explicit verb for the cleanup.     | same                                           |
| `overkill baseline bootstrap [paths...]` | **First-time setup.** Only create missing baselines; do not touch existing files. For brand-new suites.                      | same                                           |
| `overkill baseline list [paths...]`      | Print all baselines on disk with their resolved identities. Read-only; no test execution.                                    | same                                           |
| `overkill baseline clean [paths...]`     | Remove stale orphans only. Does not write or update active baselines. Use after deleting tests when you don't want to rerun. | same                                           |
| `overkill baseline diff [paths...]`      | Show what `apply` would change. Read-only; runs tests but writes nothing.                                                    | same                                           |

## Flags vs Subcommands

A subcommand exists when the _primary artifact_ the user expects from
the invocation is different from the default verdict:

-   `run` produces a verdict
-   `list` produces a printed plan
-   `replay` re-produces a past verdict
-   `replay-witness` re-produces a single failure
-   `baseline <verb>` produces or inspects baseline files (`update`,
    `apply`, and `bootstrap` write; `list`, `clean`, and `diff` do not
    write fresh content but operate inside the baseline namespace
    because the user's primary artifact is still baselines, not a
    verdict)

A flag refines or augments a `run`. It does not change what the user
asks for — they still want a verdict; the flag just shapes how the run
gets there or what extra artifacts are emitted alongside (`--coverage`,
`--debug`, `--watch`, `--filter`).

The destructive variant (`apply`, which removes stale entries) is its
own verb rather than a flag on `update` so that the dangerous behaviour
requires the user to type it deliberately.

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
