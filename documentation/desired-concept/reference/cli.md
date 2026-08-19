# CLI Reference

This doc captures the current CLI surface and CLI runtime behavior.
The public `overkill` binary is shipped by `@overkill-dev/test`, the standard
user-facing distribution. Command semantics belong to `@overkill-dev/run`;
the binary wrapper parses argv and delegates typed command intent to that
package instead of defining a separate control surface.

This document enumerates Overkill's command-line interface: subcommands
and flags. It is a reading aid: the canonical behavior of each option
lives in the relevant domain doc and is linked here.

The CLI surface follows [Principles § One First-Party Path Per Layer](../decisions/principles.md#one-first-party-path-per-layer): per-run intent lives on the CLI, persistent project policy lives
in the configuration file ([Configuration](../architecture/configuration.md)),
and those two surfaces should not define the same policy.

This does **not** mean the CLI is the only programmatic path. The binary parser
should desugar to the same typed request objects that `@overkill-dev/run`
exposes.
There should be no meaningful "CLI-only flag" whose behavior cannot also be
requested through the public programmatic API.

The CLI may discover `overkill.config.ts` because it is the project-facing
entry point. Programmatic `@overkill-dev/run` calls do not auto-load config
files; callers either pass a `RunConfig` value or explicitly call
`loadRunConfig(...)`.

## Distribution And Loading

`@overkill-dev/test` is the normal install package and the only first-party
package that declares `bin: overkill`. `@overkill-dev/run` exposes reusable
command implementation APIs for that binary and for custom orchestrators.

The binary uses command-selected modules: a tiny fixed argv parser resolves the
command name and `--config`, then delegates to the selected
`commandLineRunner` method from `@overkill-dev/run/command-line`.
`commandLineRunner` is one fixed first-party command namespace with methods
for `runTests`, `listTests`, replay, baseline, benchmark, and benchmark
baseline commands. Config loading is common command-line infrastructure shared
by those methods.

Installing a package does not add commands. There is no package-name scan,
implicit npm discovery, dynamic command registry, or plugin lifecycle in the
current concept.

## Subcommands

### Run And Replay

| Command                          | Purpose                                                     | Reference                                                                                                              |
| -------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `overkill run [paths...]`        | Default ordinary test mode: discover, plan, and execute.    | [Runtime Behavior](../architecture/runtime-behavior.md)                                                                |
| `overkill list [paths...]`       | Print the resolved test plan without running it.            | [Tests As Values](../authoring/tests-as-values.md)                                                                     |
| `overkill replay <run-id>`       | Replay a recorded run from `.overkill/runs/<id>.json`.      | [Reproducibility § Replay](../architecture/reproducibility.md#replay)                                                  |
| `overkill replay-witness <path>` | Replay a single property/simulation failure from a witness. | [Failure Artifacts § Witnesses And Replay Artifacts](../authoring/failure-artifacts.md#witnesses-and-replay-artifacts) |

### Baseline

The `baseline` namespace groups operations on the on-disk baseline
artifacts. Verbs that execute tests (`update`, `apply`, `bootstrap`,
`diff`) accept the same selection, capability, output, and lifecycle
flags as `run`; they _are_ runs with different intended artifacts (see
`Flags vs Subcommands` below). `list` operates on disk only and does
not run tests.

The runner trusts the verb the user typed. `update`, `apply`,
and `bootstrap` write to disk regardless of the host
environment; if a CI workflow runs them, that is what the workflow
author intended. There is no environment-variable opt-in or environment-based
gate.

| Command                                  | Behavior                                                                                                                 | Reference                                                                                            |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `overkill baseline update [paths...]`    | **Day-to-day update.** Create missing, overwrite changed; **leave stale alone**. Default safe verb.                      | [Baselines And Snapshots § Update Workflow](../authoring/baselines-and-snapshots.md#update-workflow) |
| `overkill baseline apply [paths...]`     | **Full reconciliation.** Create missing, overwrite changed, **and remove stale orphans**. Explicit verb for the cleanup. | same                                                                                                 |
| `overkill baseline bootstrap [paths...]` | **First-time setup.** Only create missing baselines; do not touch existing files. For brand-new suites.                  | same                                                                                                 |
| `overkill baseline list [paths...]`      | Print all baselines on disk with their resolved identities. Does not run tests; does not write.                          | same                                                                                                 |
| `overkill baseline diff [paths...]`      | Show what `apply` would change. Runs tests but writes nothing.                                                           | same                                                                                                 |

### Benchmark

Benchmarks use a dedicated namespace because their primary artifact is
measurement data plus policy evaluation, not an ordinary test verdict.
`overkill run --profile benchmark` is rejected as an argument error so there is
one first-party benchmark execution path.

| Command                                        | Behavior                                                                      | Reference                                                          |
| ---------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `overkill bench run [paths...]`                | Discover, plan, execute, measure, and evaluate benchmark workloads.           | [Benchmarking](../authoring/benchmarking.md)                       |
| `overkill bench list [paths...]`               | Print the resolved benchmark workload plan without executing measurements.    | [Benchmarking](../authoring/benchmarking.md)                       |
| `overkill bench baseline update [paths...]`    | Update changed or missing performance baselines; leave stale baselines alone. | [Baselines And Snapshots](../authoring/baselines-and-snapshots.md) |
| `overkill bench baseline apply [paths...]`     | Reconcile performance baselines, including stale removals.                    | same                                                               |
| `overkill bench baseline bootstrap [paths...]` | Create missing performance baselines without overwriting existing baselines.  | same                                                               |
| `overkill bench baseline list [paths...]`      | Print performance baselines on disk with their resolved identities.           | same                                                               |
| `overkill bench baseline diff [paths...]`      | Show what benchmark baseline reconciliation would change without writing.     | same                                                               |

## Flags vs Subcommands

A subcommand exists when the _primary artifact_ the user expects from
the invocation is different from the default verdict:

- `run` produces an ordinary test verdict
- `list` produces a printed plan
- `replay` re-produces a past verdict
- `replay-witness` re-produces a single failure
- `baseline <verb>` produces or inspects baseline files (`update`,
  `apply`, and `bootstrap` write; `list` and `diff` do not write
  fresh content but operate inside the baseline namespace because
  the user's primary artifact is still baselines, not a verdict)
- `bench <verb>` produces benchmark plans, measurements, policies, and
  performance baseline artifacts

A flag refines or augments a `run`. It does not change what the user
asks for: they still want a verdict; the flag just shapes how the run
gets there or what extra artifacts are emitted alongside (`--coverage`,
`--debug`, `--watch`, `--filter`).

The destructive variant (`apply`, which removes stale entries) is its
own verb rather than a flag on `update` so that the dangerous behaviour
requires the user to type it deliberately.

Programmatically, the same distinction should exist as separate function
entrypoints rather than as hidden boolean flags.

## Configuration

| Flag              | Behavior                                                                                           | Reference                                         |
| ----------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `--config <path>` | Load project policy from an explicit config file instead of discovering root `overkill.config.ts`. | [Configuration](../architecture/configuration.md) |

`--config` changes where persistent project policy is loaded from. It is not a
general-purpose policy override channel, and Overkill should not add parallel
fixed-path config files for suite families such as unit, integration, or
browser runs. Those differences belong in named runner profiles selected
with `--profile <name>`. Benchmark policy belongs in the `benchmark`
configuration domain and benchmark execution uses `overkill bench`.

## Selection And Iteration

| Flag                | Behavior                                                               | Reference                                                                                                                 |
| ------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `--filter '<expr>'` | Filter tests by metadata expression (tags, kind, runtime, owner, …).   | [Metadata And Selection § Filter Expression Grammar](../architecture/metadata-and-selection.md#filter-expression-grammar) |
| `--name '<text>'`   | Name substring or quoted exact match.                                  | [Metadata And Selection § Local Iteration Workflow](../architecture/metadata-and-selection.md#local-iteration-workflow)   |
| `--file <path>`     | Restrict the run to a single file.                                     | same                                                                                                                      |
| `--id <stable-id>`  | Restrict the run to a single case identity (IDE integration).          | same                                                                                                                      |
| `--last-failed`     | Run only tests that failed in the previous run.                        | same                                                                                                                      |
| `--watch`           | Rerun the selected suite on file change. Uses Node's built-in watcher. | [Runtime Behavior § Watch-Mode Targeting](../architecture/runtime-behavior.md#watch-mode-targeting)                       |
| `--shard <i>/<n>`   | Select shard `i` of `n` from the filtered set.                         | [Runtime Behavior § Sharding](../architecture/runtime-behavior.md#sharding)                                               |

## Capability And Execution

- `--profile <name>` selects an ordinary runner profile, such as `microtest`,
  `integration`, or `browser`. `benchmark` is reserved for `overkill bench`.
  See [Microtests And Capabilities](../authoring/microtests-and-capabilities.md).
- `--mode <strategy>` overrides the resolved execution strategy. See
  [Runtime Behavior § Parallelism Semantics](../architecture/runtime-behavior.md#parallelism-semantics).
- `--workers <n>` overrides default worker count for worker-pool modes.
- `--measure-resource-usage` collects run-level resource usage diagnostics for
  this run. See [Runtime Behavior § Resource Budgets](../architecture/runtime-behavior.md#resource-budgets).
- `--resource-budget <name=value>` overrides one resource budget for this run
  and enables resource usage measurement.

## Output And Capture

| Flag           | Behavior                                                               | Reference                                                                                               |
| -------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `--coverage`   | Collect coverage for microtest profiles only. Forces serial execution. | [Coverage](../architecture/coverage.md)                                                                 |
| `--no-capture` | Pass stdout/stderr through live instead of buffering.                  | [Runtime Behavior § Console Output Capture](../architecture/runtime-behavior.md#console-output-capture) |

## Lifecycle And Edge Cases

| Flag                       | Behavior                                                             | Reference                                               |
| -------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------- |
| `--seed <n>`               | Override the run seed (for reproducible randomization).              | [Reproducibility](../architecture/reproducibility.md)   |
| `--order lexical`          | Disable seeded shuffling and use deterministic collection order.     | [Runtime Behavior](../architecture/runtime-behavior.md) |
| `--debug`                  | Emit a structured debug artifact for every test in the resolved set. | [Test Debug Mode](../authoring/debug-mode.md)           |
| `--debug-scope <selector>` | Emit a debug artifact for tests matching a selector.                 | same                                                    |
| `--verbose`                | Include per-file peak resource usage and other expanded diagnostics. | [Runtime Behavior](../architecture/runtime-behavior.md) |

This list intentionally omits flags that are still under design (e.g.
`--since <ref>`); when those land, this table is the
place they should be registered.

## Terminal Capability Detection

Color, animation, and progress UI obey:

- `NO_COLOR` (any value): disables color
- `FORCE_COLOR`: forces color and chooses depth
- `TERM=dumb`: disables ANSI control sequences
- not-a-TTY (`stdout.isTTY === false`): disables progress UI, defaults
  to a non-animated reporter

Terminal width detection uses `process.stdout.columns`; updates on
`SIGWINCH`. Reporters wrap or truncate diff output accordingly.

An explicitly configured `@overkill-dev/reporter-dot` still streams compact
progress marks in non-interactive output. Non-interactive mode disables
cursor-control reflow only; it does not silence dot progress.
