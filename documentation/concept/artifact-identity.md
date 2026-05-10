# Artifact Identity

## Purpose

This document defines how Overkill should think about stable identities for
tests, cases, runtimes, workloads, and the artifacts associated with
them. Identity is the single most cross-cutting concept in the architecture:
selection, baselines, failure artifacts, reproducibility, benchmark
policies, reporter output, and retries all consume it.

## Position

Stable identity is not a string-formatting concern. It is a typed structured
value derived from declared parts. Reporters, baseline systems, and IDE
integrations consume the structure directly; path representations are
_derived_ from the identity, not the other way around.

## Identity Layers

Overkill distinguishes:

-   **engine identity** — the minimal stable identity known to
    `@overkill/engine`, independent of files or any specific authoring DSL
-   **authoring identity** — the richer identity derived by a DSL or package
    such as `@overkill/test`
-   **expanded case identity** — the concrete case after parameterization,
    macro instantiation, and runtime-matrix multiplication
-   **runtime identity** — the resolved runtime target (browser variant,
    OS, Node version, configuration profile)
-   **workload identity** — for benchmarks, the resolved workload
    parameters
-   **attempt identity** — for retries (integration profiles only), the
    attempt number
-   **artifact identity** — derived from the above, with a subtype tag
    naming the artifact kind

## Engine Versus DSL Identity

`@overkill/engine` is API-only. It should not assume test files, modules,
suite trees, or any one registration style.

That means engine identity must stay generic. A higher-level package such as
`@overkill/test` may then derive richer identities from:

-   file/module origin
-   explicit suite names
-   test names
-   parameterization keys
-   runtime metadata
-   workload metadata

So the rest of this document should be read primarily as the **default
identity derivation for `@overkill/test` and related first-party tooling**,
not as a hard requirement baked into `@overkill/engine`.

## Concrete Type Sketch

```ts
type TestId = {
    readonly file: string; // canonical source file path, repo-relative
    readonly suite?: ReadonlyArray<string>; // ordered suite names, root → leaf
    readonly name: string; // test name within its parent
};

type CaseId = TestId & {
    readonly params?: string; // canonical case key for parameterized tests
};

type RuntimeId = {
    readonly name: string; // 'chromium', 'node', 'deterministic-api', etc.
    readonly dimensions?: Record<string, string>; // os=linux, node=26, scenario=payments-500, ...
};

type WorkloadId = {
    readonly name: string; // 'small', 'medium', 'large', 'real-world-1'
    readonly params?: Record<string, string>;
};

type AttemptId = { readonly index: number }; // 0-indexed

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
    readonly runtime?: RuntimeId;
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
<file-without-extension>__<suite-path>__<name>__<params?>__<runtime?>__<workload?>__<attempt?>.<subtype>.<ext>
```

with:

-   `__` as the separator (chosen to be unambiguous in filenames)
-   names URL-encoded for filesystem safety
-   missing optional parts collapsed (no trailing `__`)
-   subtype-specific extension (`.snap.json`, `.png`, `.benchmark.json`,
    `.witness.json`, `.log`)

Example:

```
source/users.test__crud__deletes-user__role=admin__node__os=linux__node=26__attempt=1.witness.json
```

Different baseline subtypes can override the derivation if their tooling
expects a particular layout (Vitest snapshots, Playwright screenshots),
but the canonical identity remains the structured value.

## Canonicalisation Rules

To make identity stable across machines and runs:

-   **file paths** are repo-relative (relative to the resolved project
    root for the run; see Resolved Identity Rules) and use forward
    slashes regardless of OS
-   **suite paths** are ordered arrays; identity is structural, not
    string-joined
-   **names** are taken verbatim from the source (no automatic
    transformation), but disallow control characters
-   **params** are canonicalised by sorting object keys, then JSON-stringifying
    with stable ordering; arrays preserve order
-   **runtime names** are taken from the runtime factory's declared name,
    not derived from process state
-   **runtime dimensions** are sorted by key before path derivation and
    serialization
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
-   benchmark budget lookup (a budget belongs to a workload + runtime, not a
    file path)
-   multi-runtime reporting (the same logical test runs in many
    runtimes)
-   failure artifact naming (witnesses, traces, captures)
-   IDE jump-to-test from a CI log
-   selection by structured filter
-   sharding partitions (sharding hashes the identity)

## Identity Across Renames

Renames and moves are common: file renames, folder renames, suite-title
renames, test-case renames, parameter-key changes.

Recommended behavior:

-   old artifacts become stale rather than being silently reused

The important point is that the system should make stale state visible rather
than trying to be clever about rename inference.

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

Shard partitioning is _not_ part of artifact identity itself — a test has
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
parsing structured identity plus origin metadata, not the rendered failure
message. In the default `@overkill/test` mapping, identity carries `file`
and (via the suite path + name) enough structure for source-location lookup;
the IDE asks Overkill for the line number via the engine API rather than
re-parsing the file.

## Resolved Identity Rules

-   Unicode normalisation uses **NFC** before identity hashing and path
    derivation.
-   Suite path is **explicit only**. Folders contribute to `file`, not to
    `suite`.
-   In monorepos, `file` remains **repo-relative** to the resolved project
    root chosen for the run. There is no dedicated package/workspace field.
-   If the runner cannot determine the project root unambiguously, it should
    fail rather than invent unstable identities.
-   The engine does **not** define a tiny generic `origin` shape right now.
    Keep engine identity generic and let authoring packages attach origin
    metadata explicitly.

## Influences

-   xUnit's class+method identity model
-   Playwright's project + test + step identity
-   Bazel's `//pkg:target` addressing
-   QuickCheck/Hedgehog's witness format

## Sources

-   [Playwright — Test reporter API (test ID)](https://playwright.dev/docs/api/class-testcase)
-   [Vitest — `expect.toMatchFileSnapshot` and identity](https://vitest.dev/guide/snapshot.html)
