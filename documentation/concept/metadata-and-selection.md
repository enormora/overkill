# Metadata And Selection

## Purpose

This document defines how Overkill should describe tests beyond their
executable body and how users should select subsets of a run without
falling back to inline `.only` culture.

## Position

Overkill treats test metadata as explicit structured data rather than ad-hoc
naming conventions.

Likely metadata categories:

-   **tags** — free-form labels (`'fast'`, `'flaky'`, `'auth'`)
-   **kind** — closed enumeration (see `glossary.md` § Test Kind)
-   **environments** — declared environment matrix entries
-   **capabilities** — required capability profile
-   **baselines** — baseline subtypes the test consumes
-   **ownership** — domain or team labels (`'@auth-team'`)
-   **stability** — `'stable' | 'flaky' | 'experimental'`
-   **priority** — `'critical' | 'standard' | 'optional'`

## Concrete Type Sketch

```ts
type Metadata = {
    readonly tags?: ReadonlySet<string>;
    readonly kind?: TestKind;
    readonly environments?: ReadonlyArray<string>;
    readonly capabilities?: ReadonlyArray<Capability>;
    readonly baselines?: ReadonlyArray<BaselineSubtype>;
    readonly ownership?: ReadonlyArray<string>;
    readonly stability?: 'stable' | 'flaky' | 'experimental';
    readonly priority?: 'critical' | 'standard' | 'optional';
    readonly extra?: ReadonlyMap<string, unknown>; // open-ended
};
```

`extra` is a typed escape hatch for third-party extensions. The first-party
fields are stable; `extra` may diverge per package.

## Metadata Propagation

Metadata cascades from suite to test, with override semantics:

1.  the file's default-export metadata applies to all tests in the file
2.  a parent `Suite`'s metadata applies to all children
3.  a child's metadata overrides the parent on a per-key basis
4.  set-valued fields (`tags`) merge by union with the parent
5.  array-valued fields (`environments`) merge unless the child sets
    `replace: true` (rare)
6.  enum fields (`kind`, `stability`, `priority`) replace

Example:

```ts
export default suite('users', { tags: ['auth'], ownership: ['@auth'] }, [
    test('login', { tags: ['critical'] }, body), // tags = {auth, critical}
    test('logout', body), // tags = {auth}
    suite('admin', { tags: ['admin'] }, [
        // tags = {auth, admin}
        test('promote', body), // tags = {auth, admin}
    ]),
]);
```

Propagation is a tree fold computed at collection time. The resolved
metadata is part of the test's identity for selection but not for artifact
identity (which uses only file/suite/name structure — see
`artifact-identity.md`).

## Selection Model

Selection belongs to orchestration, not to hidden inline controls inside
the test file. Filters apply at run planning, before sharding, before worker
assignment, and before expansion of tables and runtime matrices.

Filterable dimensions:

-   test id (file, suite path, name, params)
-   file path (glob)
-   tag set (`--tag fast`, `--tag '!flaky'`)
-   metadata fields (`--kind microtest`, `--owner '@auth-team'`)
-   environment (`--env 'browser-*'`)
-   workload (`--workload large`)
-   stability (`--stability stable`)

This is the conceptual replacement for relying on `.only`.

## Filter Expression Grammar

CLI filters use a small expression language:

```
expr     := term ( ' ' term )*           # space-separated → AND
term     := dimension '=' value          # equality
         |  dimension '~' regex          # regex match
         |  dimension ':' glob           # glob match
         |  '!' term                     # negation
         |  '(' expr ')'
         |  expr '|' expr                # OR (lower precedence than space-AND)
value    := identifier | quoted-string
dimension := 'tag' | 'kind' | 'env' | 'owner' | 'stability'
          |  'file' | 'name' | 'suite' | 'params'
```

Examples:

```
--filter 'tag=fast !tag=flaky'                        # fast AND not flaky
--filter 'kind=microtest | kind=property'             # microtests OR property tests
--filter 'file:source/auth/* tag=critical'            # auth files, critical only
--filter 'name~"^should "'                            # name matches regex
```

Rules:

-   space is AND (highest precedence after parens)
-   `|` is OR
-   `!` negates a single term
-   parentheses group
-   glob (`:`) supports `*`, `**`, and `?`
-   regex (`~`) is anchored at both ends only when the pattern starts
    with `^` and ends with `$`

A programmatic API mirrors the grammar:

```ts
runner.run({ filter: { all: [tag('fast'), not(tag('flaky'))] } });
```

Both forms produce the same internal predicate tree.

## Local Iteration Workflow

The replacement for `.only`:

-   `--name 'login'` runs tests whose name matches (substring or quoted
    exact)
-   `--file source/auth/login.test.ts` runs only that file
-   `--id <stable-id>` runs the exact case (IDE integration emits this)
-   `--last-failed` runs tests that failed in the previous run
-   `--changed` runs tests in files changed since `main` (path-level only;
    Overkill does not track a dependency graph)
-   `--watch` reruns on file change (closure-aware by default)

These are CLI conveniences over the same selection grammar. None modify
the test source.

## Recommended Shape

The metadata is:

-   explicit
-   serializable
-   visible to reporters
-   visible to run planning
-   visible to artifact identity _for selection only_
-   stable enough to participate in identity hashing

## Stability Markers

Overkill distinguishes between:

-   `stable` (default) — failures gate
-   `flaky` — the test is suspected to be unstable; this is metadata, not
    absolution
-   `experimental` — alpha tests still under development

Microtests should not normalize retries or flaky markers. If a microtest is
flaky, that is a design failure, not an expected state. For integration-style
tests, a flaky marker may still be useful as reporting metadata, but the
current concept does not endorse a full quarantine workflow.

## Capability Propagation

Capability declarations cascade like metadata, but with stricter rules:

-   parent capabilities are intersected with child capabilities (children
    can only declare a _subset_ of the parent's permitted capabilities,
    not extend)
-   the runner enforces the intersection when starting a worker; tests in
    the same worker share the worker's capability set
-   tests with incompatible capabilities cannot share a worker; they are
    routed to separate workers or processes

Per-test capabilities are a _runner-level_ concern: Node permissions are
process-wide. To run two tests with different capabilities, they must be
in different processes. The runner schedules accordingly.

## Composition With Sharding

Sharding partitions the _filtered_ test set. Filters apply first; sharding
operates on the result. This means:

-   `--filter '...' --shard 1/4` shards the filtered subset
-   reproducibility: the same filter + same shard count + same shard
    index produces the same case set across runs

## Programmatic Selection API

Embedders (IDEs, MCP servers, CI tools) construct filters programmatically:

```ts
import { tag, not, kind, file, all, any } from '@overkill/run/filters';

const filter = all([tag('fast'), not(tag('flaky')), any([file('source/auth/**'), file('source/users/**')])]);

await runner.run({ filter });
```

The CLI grammar is sugar over this API; both produce identical predicates.

## Sources

-   [Pytest — markers](https://docs.pytest.org/en/stable/how-to/mark.html)
-   [JUnit5 — Tags and Filtering](https://junit.org/junit5/docs/current/user-guide/#writing-tests-tagging-and-filtering)
-   [Bazel — `tags` attribute](https://bazel.build/reference/be/common-definitions#common-attributes-tests)
-   [Playwright — projects and grep](https://playwright.dev/docs/test-projects)
