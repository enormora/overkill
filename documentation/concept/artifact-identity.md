# Artifact Identity

## Purpose

This document defines how Overkill should think about stable identities for
tests, cases, environments, workloads, and the artifacts associated with
them. Identity is the single most cross-cutting concept in the architecture:
selection, baselines, failure artifacts, reproducibility, benchmark
policies, reporter output, and retries all consume it.

## Position

Stable identity is not a string-formatting concern. It is a typed structured
value derived from declared parts. Reporters, baseline systems, and IDE
integrations consume the structure directly; path representations are
*derived* from the identity, not the other way around.

## Identity Layers

Overkill distinguishes:

-   **test definition identity** — the abstract test (a `TestCase` or
    `Table` in the suite tree)
-   **expanded case identity** — the concrete case after table expansion,
    macro instantiation, and environment-matrix multiplication
-   **environment identity** — the resolved environment (browser variant,
    OS, runtime, configuration profile)
-   **workload identity** — for benchmarks, the resolved workload
    parameters
-   **attempt identity** — for retries (integration profiles only), the
    attempt number
-   **artifact identity** — derived from the above, with a subtype tag
    naming the artifact kind

## Concrete Type Sketch

```ts
type TestId = {
    readonly file: string;            // canonical source file path, repo-relative
    readonly suite?: ReadonlyArray<string>;  // ordered suite names, root → leaf
    readonly name: string;            // test name within its parent
};

type CaseId = TestId & {
    readonly params?: string;         // canonical case key for parameterized tests
};

type EnvId = {
    readonly name: string;            // 'chromium', 'node25', 'ci-linux-x64', etc.
    readonly variant?: string;        // optional sub-variant key
};

type WorkloadId = {
    readonly name: string;            // 'small', 'medium', 'large', 'real-world-1'
    readonly params?: Record<string, string>;
};

type AttemptId = { readonly index: number };  // 0-indexed

type ArtifactSubtype =
    | 'content-snapshot'
    | 'visual-snapshot'
    | 'terminal-snapshot'
    | 'performance-baseline'
    | 'witness'
    | 'log-capture'
    | 'trace';

type ArtifactId = {
    readonly case: CaseId;
    readonly env?: EnvId;
    readonly workload?: WorkloadId;
    readonly attempt?: AttemptId;
    readonly subtype: ArtifactSubtype;
};
```

These are values. They are compared structurally. They are serialised to
disk paths only as a derivation, never the canonical form.

## Path Derivation

The default path derivation rule is deterministic and reversible enough to
support stale-baseline detection:

```
<file-without-extension>__<suite-path>__<name>__<params?>__<env?>__<workload?>__<attempt?>.<subtype>.<ext>
```

with:

-   `__` as the separator (chosen to be unambiguous in filenames)
-   names URL-encoded for filesystem safety
-   missing optional parts collapsed (no trailing `__`)
-   subtype-specific extension (`.snap.json`, `.png`, `.benchmark.json`,
    `.witness.json`, `.log`)

Example:

```
source/users.test__crud__deletes-user__role=admin__node25__attempt=1.witness.json
```

Different baseline subtypes can override the derivation if their tooling
expects a particular layout (Vitest snapshots, Playwright screenshots),
but the canonical identity remains the structured value.

## Canonicalisation Rules

To make identity stable across machines and runs:

-   **file paths** are repo-relative (relative to the workspace root or
    the package root in a monorepo) and use forward slashes regardless of
    OS
-   **suite paths** are ordered arrays; identity is structural, not
    string-joined
-   **names** are taken verbatim from the source (no automatic
    transformation), but disallow control characters
-   **params** are canonicalised by sorting object keys, then JSON-stringifying
    with stable ordering; arrays preserve order
-   **env names** are taken from the environment factory's declared name,
    not derived from process state
-   **workload names** are taken from the workload definition, not from
    fixture state

A change in canonicalisation rules is a baseline-breaking change and
requires a migration; the rules should be considered stable.

## Why This Matters

Without stable identities, Overkill cannot do these cleanly:

-   stale-baseline detection (which baselines no longer correspond to
    collected tests)
-   deterministic randomization replay (per-test seed derivation needs a
    stable key)
-   benchmark budget lookup (a budget belongs to a workload + env, not a
    file path)
-   multi-environment reporting (the same logical test runs in many
    envs)
-   failure artifact naming (witnesses, traces, captures)
-   IDE jump-to-test from a CI log
-   selection by structured filter
-   sharding partitions (sharding hashes the identity)

## Identity Across Renames

When a test is renamed or moved, its identity changes by definition. That
breaks baseline lookups and benchmark budgets. Overkill should support an
explicit rename workflow:

-   `overkill baselines rename --from <old-id> --to <new-id>` updates
    artifact filenames atomically
-   `overkill baselines orphans` lists baselines whose identity no longer
    matches any collected test (stale baselines)
-   the runner can suggest renames based on Levenshtein distance between
    orphans and new identities, but never applies them automatically

This is one of the runner-owned escape hatches that justifies an explicit
update mode (see `baselines-and-snapshots.md`).

## Identity And Retries

Retries (integration profiles only — `failure-artifacts.md` covers the
attribution rules) introduce attempt identity. The first attempt has
`attempt: { index: 0 }`; subsequent attempts increment. Reporters can
choose to display only the final attempt or all of them; the engine
preserves all.

Artifact identity preserves the attempt so that "first failure" and
"final outcome" artifacts can coexist:

-   `__attempt=0.log` — captured output of the first attempt
-   `__attempt=1.log` — captured output of the retry
-   `__final.log` — symlink or pointer to the canonical final attempt

## Identity And Sharding

Sharding partitions the collected case set by hashing `CaseId`. The hash
function is stable and documented (xxh3 of the canonical JSON encoding).
Two shards never share a case; the union covers everything. Reproducibility
across CI machines depends on this stability.

Shard partitioning is *not* part of artifact identity itself — a test has
the same `CaseId` regardless of which shard it ran on.

## Identity And Reproducibility

A run record includes the resolved set of identities. Replaying a run with
`overkill replay <run-id>` restores:

-   the same selection
-   the same seed (per-test seeds are derived from the run seed plus
    `CaseId`)
-   the same baseline lookup decisions
-   the same workload parameters

This is the practical meaning of `reproducibility.md`'s "reproducible run
intent": the inputs to the plan are stable and the plan is replayable.

## Identity And IDE Integration

IDE plugins navigate from "a failure in CI" to "the source location" by
parsing the structured identity, not the rendered failure message. The
identity carries `file` and (via the suite path + name) the source
location lookup; the IDE asks Overkill for the line number via the engine
API rather than re-parsing the file.

## Open Items

-   how strict should canonicalisation be about Unicode normalisation
    (NFC vs NFD) in test names? Recommendation: NFC, document explicitly
-   should suite path be implicit from file structure (folders) or only
    from explicit `suite('name', ...)` calls? Recommendation: only
    explicit (folders contribute to `file`, not `suite`)
-   per-package identity in monorepos — currently `file` is workspace-
    relative. Should the package name be a separate identity field?
    Recommendation: yes, add `package` (optional, present in monorepos)
    and use it ahead of `file` in the path derivation

## Influences

-   xUnit's class+method identity model
-   Playwright's project + test + step identity
-   Bazel's `//pkg:target` addressing
-   QuickCheck/Hedgehog's witness format

## Sources

-   [Playwright — Test reporter API (test ID)](https://playwright.dev/docs/api/class-testcase)
-   [Vitest — `expect.toMatchFileSnapshot` and identity](https://vitest.dev/guide/snapshot.html)
