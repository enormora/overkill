# Baselines And Snapshots

## Unified Baseline Concept

Overkill should use **baseline** as the umbrella term for any checked-in artifact that is compared during a run and updated intentionally.

This lets the product share workflow concepts across:

- content snapshots
- visual baselines
- terminal baselines
- performance budgets

## Why Unify Them At All

They share important operational behavior:

- checked into version control
- reviewed in code review
- diffable
- comparable during runs
- explicitly updated
- potentially stale when tests are removed or renamed

## Why Not Collapse Their Semantics

The workflow is shared, but the meaning is not.

### Content Snapshots

These capture serialized structure or output. They are usually compared for exact or domain-aware equality.

### Visual Or Terminal Baselines

These compare rendered output or accessibility structure. They need domain-aware comparison and often test-family-specific storage.

### Performance Baselines

These are stricter than ordinary snapshots. They often need:

- thresholds
- tolerances
- normalization
- per-metric policies
- median and percentile semantics

## Stale Baseline Detection

Stale baseline cleanup must be first-class.

The concept should assume the runner can detect:

- baseline entries with no corresponding collected test
- obsolete files for removed or renamed tests
- orphaned performance budgets

Stale baselines fail the run by default; removing them requires an explicit `overkill baseline apply`.

Vitest’s CI behavior around obsolete snapshots is a useful reference point.

Source:

- <https://vitest.dev/guide/snapshot.html>

## Update Policy

Baseline updates should always be explicit.

Ordinary runs:

- compare only
- fail on mismatch, missing artifacts, or stale artifacts

Explicit update runs:

- create new artifacts
- update changed artifacts
- remove stale artifacts where the chosen mode allows it

## Update Workflow

Ordinary baseline operations live under the `baseline` subcommand namespace
(registered in [CLI Reference § Subcommands](../reference/cli.md#subcommands) § Baseline).
Performance baselines for benchmarks live under `overkill bench baseline`
because benchmark execution has a dedicated namespace. The verbs split along
intent:

| Verb        | Creates missing | Overwrites changed | Removes stale | Runs tests |
| ----------- | --------------- | ------------------ | ------------- | ---------- |
| `update`    | yes             | yes                | **no**        | yes        |
| `apply`     | yes             | yes                | **yes**       | yes        |
| `bootstrap` | yes             | no                 | no            | yes        |
| `list`      | —               | —                  | —             | no         |
| `diff`      | no              | no                 | no            | yes        |

The subcommand framing reflects user intent: the primary artifact is
on-disk baselines, not the verdict (see [CLI Reference § Flags vs Subcommands](../reference/cli.md#flags-vs-subcommands)). The ordinary write verbs (`update`, `apply`, `bootstrap`) accept
the same selection, capability, and output flags as `run`, since updating
still requires executing the selected tests. Benchmark baseline verbs accept
the benchmark selection and output flags from `overkill bench run`.

Day-to-day choice:

- `overkill baseline update` is the safe default. It creates new
  baselines for newly added tests and overwrites baselines whose
  content changed. It **does not delete anything**, so an in-progress
  rename or a temporarily-skipped test cannot lose its baseline by
  accident.
- `overkill baseline apply` is the deliberate cleanup verb. It does
  everything `update` does **and** removes stale orphans. Use it
  when committing a rename or a deletion: the diff in
  `test-baselines/` will include the removals, making the cleanup
  reviewable in the same change.
- `overkill baseline bootstrap` is for the very first time you adopt
  Overkill in a project. It only creates baselines that don't exist
  yet; existing baselines are left alone (so a partial bootstrap
  doesn't trample a baseline that was authored by hand). After the
  suite has baselines, you stop using `bootstrap` and switch to
  `update` / `apply`.

Read-only and disk-only verbs:

- `overkill baseline list` prints every baseline currently on disk
  with its resolved identity. No test execution. Useful for
  auditing what the suite has accumulated.
- `overkill baseline diff` shows what `apply` would change. It runs
  tests but writes nothing — a dry-run for review pipelines.

When `overkill run` is invoked instead, no baseline writes happen —
comparison-only is the default mode. The runner does not gate baseline
writes by environment; if a CI workflow runs a write verb, that is
what the workflow author intended. The author of the workflow is
responsible for not putting `baseline apply` in a check-only pipeline.
This is a settled policy choice, not something configurable via
`process.env.CI` or a configuration-level opt-in flag.

### Review-Then-Commit Flow

The intended developer loop:

1. Run normally with `overkill run`; baselines compare. Mismatches
   fail the run with a diff appropriate to the baseline subtype:
   structured for content snapshots (text, JSON, objects), size and
   hash for opaque binary artifacts, and adapter-specific
   representations for visual or performance baselines (see
   [Assertions And Results § Diff And Diagnostic Shape](./assertions-and-results.md#diff-and-diagnostic-shape)).
2. Inspect the diff in the reporter or in the JSON event stream.
   Decide whether the change is intended.
3. For day-to-day intentional changes: run `overkill baseline update`
   to create new baselines and overwrite changed ones. Stale orphans
   stay on disk for now.
4. When committing a rename or deletion that should also clean up
   stale baselines: run `overkill baseline apply` instead. The diff
   in `test-baselines/` will include both the updates and the
   removals.
5. `git diff test-baselines/` shows everything that changed. Review
   and commit those files together with the production change that
   caused the update.

The baselines live under version control precisely so step 5 makes
the update reviewable. A baseline change that doesn't fit on a code-
review screen indicates either a too-broad baseline or a too-broad
production change.

### Stale Artifact Handling

Stale baselines (no corresponding collected test) are detected after
the run by comparing the on-disk baseline files against the resolved
case identities. Default policy:

- ordinary `overkill run`: stale baselines **fail the run**. The
  suite is honest about its on-disk state. (Configurable to a
  warning in `overkill.config.ts` if a project needs a softer
  policy during a transition.)
- `overkill baseline update`: stale orphans are reported but **left
  on disk** — `update` is non-destructive
- `overkill baseline apply`: stale orphans are removed after the run
  completes; this is the verb's reason for existing

Renames are detected as a stale orphan plus a missing new baseline
(see [Non-Goals § No automatic rename inference for renamed tests](../decisions/non-goals.md#no-automatic-rename-inference-for-renamed-tests)); the developer
accepts both deliberately by running `apply`.

### What The Runner Will Not Do

- silently write to baseline files. Every baseline change requires
  the user to type a write verb explicitly (`update`, `apply`,
  or `bootstrap`); `overkill run` never modifies
  baselines, regardless of the host environment or who triggered
  the run.
- delete baselines that belong to tests the current run did not
  execute. Stale detection only compares on-disk baselines against the
  case identities actually executed in that run. Comprehensive cleanup
  therefore requires an unfiltered `overkill baseline apply`; a filtered
  run only cleans within its selection.

## Package Position

Generic snapshots should live above the core, primarily in integration-oriented packages or shared baseline utilities. If research later proves that baseline identity or lifecycle must be in the core, that should be documented as a deliberate exception.
