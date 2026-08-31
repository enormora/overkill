# Metadata And Selection

## Purpose

This document defines how Overkill should describe tests beyond their
executable body and how users should select subsets of a run without
falling back to inline `.only` culture.

## Position

Overkill treats test metadata as explicit structured data rather than
ad-hoc naming conventions, the metadata-layer expression of
[Principles § Data Over Side Effects](../decisions/principles.md#data-over-side-effects).

Likely metadata categories:

- **tags** - free-form labels (`'fast'`, `'flaky'`, `'auth'`)
- **kind** - closed enumeration (see [Glossary § Test Family](../reference/glossary.md#test-family))
- **runtimes** - declared runtime matrix entries
- **capabilities** - required capability profile
- **baselines** - baseline subtypes the test consumes
- **ownership** - domain or team labels (`'@auth-team'`)
- **stability** - `'stable' | 'flaky' | 'experimental'`
- **priority** - `'critical' | 'standard' | 'optional'`
- **debug** - pin [Test Debug Mode](../authoring/debug-mode.md) on for this test or subtree
- **capture** - per-test capture preference for future capture behavior
- **timeoutMilliseconds** - current per-test soft timeout override

## Concrete Type Sketch

```ts
type Metadata = {
    readonly tags?: readonly string[];
    readonly kind?: TestFamily;
    readonly runtimes?: readonly string[] | {
        readonly mode: 'append' | 'replace';
        readonly values: readonly string[];
    };
    readonly capabilities?: ReadonlyArray<Capability>;
    readonly baselines?: ReadonlyArray<BaselineSubtype>;
    readonly ownership?: ReadonlyArray<string>;
    readonly stability?: 'stable' | 'flaky' | 'experimental';
    readonly priority?: 'critical' | 'standard' | 'optional';
    readonly debug?: boolean;
    readonly capture?: 'buffered' | 'live';
    readonly timeoutMilliseconds?: number;
    readonly extra?: Readonly<Record<string, unknown>>;
};

type ResolvedMetadata = {
    readonly tags: readonly string[];
    readonly kind: TestFamily | null;
    readonly runtimes: readonly string[];
    readonly capabilities: readonly Capability[];
    readonly baselines: readonly BaselineSubtype[];
    readonly ownership: readonly string[];
    readonly stability: 'stable' | 'flaky' | 'experimental';
    readonly priority: 'critical' | 'standard' | 'optional';
    readonly debug: boolean;
    readonly capture: 'buffered' | 'live' | null;
    readonly timeoutMilliseconds: number | null;
    readonly extra: Readonly<Record<string, unknown>>;
};
```

`extra` is a typed escape hatch for third-party extensions. The first-party
fields are stable; `extra` may diverge per package.

Metadata and option objects are closed at their declared boundary. Unknown
first-party keys are collection errors, including in JavaScript projects
where TypeScript cannot catch a typo. Extension data belongs under `extra`
or under a package-owned typed extension field, not beside first-party keys.

This rule applies to test, suite, table, runtime, and skip options. A typo
such as `{ skp: true }` must fail loudly instead of silently running the test
with the default behavior.

## Metadata Propagation

Metadata cascades from root to test, with override semantics:

1. root metadata applies to the whole plan
2. file-frame metadata applies to all tests in that file
3. a parent `Suite`'s or `Table`'s metadata applies to all children
4. a child's metadata overrides the parent on a per-key basis
5. set-valued fields (`tags`, `ownership`, `baselines`) merge by union with the parent
6. `runtimes` merges by default and replaces when the child uses
   `{ mode: 'replace', values }`
7. enum, boolean, capture, and timeout fields replace

Example:

```ts
export const testNode = suite('users', { tags: [ 'auth' ], ownership: [ '@auth' ] }, [
    test('login', { tags: [ 'critical' ] }, body), // tags = {auth, critical}
    test('logout', body), // tags = {auth}
    suite('admin', { tags: [ 'admin' ] }, [
        // tags = {auth, admin}
        test('promote', body) // tags = {auth, admin}
    ])
]);
```

The file frame is metadata-only. It participates in propagation but does
not add a suite segment, does not affect `CaseId`, and does not change
reporter nesting. The current programmatic engine API exposes it as
`TestPlanFile.metadata`; public module-level authoring for file metadata
is deferred to the root authoring and module export design.

Propagation is a tree fold computed at collection time. The resolved
metadata is part of the test's identity for selection but not for artifact
identity (which uses only file/suite/name structure; see
[Artifact Identity](./artifact-identity.md)).

## Selection Model

Selection belongs to orchestration, not to hidden inline controls inside
the test file. Filters apply during run planning, before execution starts.
The full ordering of collection, expansion, filtering, sharding, and plan
freeze lives in [Composition Order](./composition-order.md).

Filterable dimensions:

- test id through the programmatic API (file, suite path, name, params)
- file path (glob)
- tag set (`--tag fast`, `--tag '!flaky'`)
- metadata fields (`--owner '@auth-team'`)
- runtime (`--runtime 'browser-*'`)
- workload (`--workload large`)
- stability (`--stability stable`)

This is the conceptual replacement for relying on `.only`.
Test family `kind` is not a selection dimension for one run. The selected
runner profile already binds the run to one test family, so matching it again
inside a filter adds no useful narrowing.

### Selection In Multi-Process Runs

Multi-process execution does not change selection semantics. Selection is a
plan-time operation, not a worker-time side effect: workers receive cases
from the frozen plan rather than discovering new tests that could alter
filtering or sharding.

## Filter Expression Grammar

CLI filters use a small expression language. The programmatic filter tree is
canonical; the CLI grammar is syntax sugar that lowers to the same tree.

```text
expr     := term ( ' ' term )*           # space-separated AND
term     := dimension '=' value          # equality
         |  dimension '~' text           # case-insensitive contains
         |  dimension ':' glob           # glob match
         |  '!' term                     # negation
         |  '(' expr ')'
         |  expr '|' expr                # OR (lower precedence than space-AND)
value    := identifier | quoted-string
dimension := 'tag' | 'runtime' | 'owner' | 'stability'
          |  'file' | 'name' | 'suite' | 'params'
```

Examples:

```text
--filter 'tag=fast !tag=flaky'                        # fast AND not flaky
--filter 'file:source/auth/* tag=critical'            # auth files, critical only
--filter 'name~"should "'                             # name contains text
```

Rules:

- space is AND (highest precedence after parens)
- `|` is OR
- `!` negates a single term
- parentheses group
- glob (`:`) supports `*`, `**`, and `?`
- contains (`~`) is case-insensitive
- quoted values may use single or double quotes after shell parsing
- `kind`, `workload`, and exact case id matching are not CLI filter dimensions

A programmatic API mirrors the grammar:

```ts
await orchestrator.run({
    config,
    cwd,
    engine: { kind: 'default' },
    request: {
        ...request,
        selection: { filter: all([ tag('fast'), not(tag('flaky')) ]), kind: 'filter' }
    }
});
```

Both forms produce the same internal predicate tree.

## Local Iteration Workflow

The replacement for `.only`:

- `--name 'login'` runs tests whose name contains the text
- `--file source/auth/login.test.ts` runs only that file
- `--last-failed` runs tests that failed in the previous run
- `--watch` reruns the selected suite on file change (uses Node's
  built-in watcher; see [Runtime Behavior § Watch-Mode Targeting](./runtime-behavior.md#watch-mode-targeting))

These are CLI conveniences over the same selection grammar. None modify
the test source.
Exact `CaseId` selection stays API-only because `CaseId` is structured
runner data, not a user-facing CLI string.

`--last-failed` is resolved from a previously persisted `RunRecord`
(see [Reproducibility](./reproducibility.md)); it does not require a separate
tracking file or extra per-test disk writes. If several tests failed in the
previous persisted run, all of their `CaseId`s are selected. If no previous
run record exists, the flag is a usage error rather than a silent no-op.

## Recommended Shape

The metadata is:

- explicit
- serializable
- visible to reporters
- visible to run planning
- visible to artifact identity _for selection only_
- stable enough to participate in identity hashing

`debug`, `capture`, `priority`, and `baselines` are modeled metadata before
their runtime consumers exist. They are visible to plans, run facts, and
reporters, but they do not change execution behavior yet.

## Stability Markers

Overkill distinguishes between:

- `stable` (default) - failures gate
- `flaky` - the test is suspected to be unstable; this is metadata, not
  absolution
- `experimental` - alpha tests still under development

Microtests should not normalize retries or flaky markers. If a microtest is
flaky, that is a design failure, not an expected state. For integration-style
tests, a flaky marker may still be useful as reporting metadata, but the
current concept does not endorse a full quarantine workflow.

## Capability Propagation

Capability declarations cascade like metadata but with stricter
intersection-only rules. The canonical specification lives in
[`microtests-and-capabilities.md`](../authoring/microtests-and-capabilities.md);
the short form here is that children narrow parents but never widen
them, and tests with incompatible capabilities cannot share a worker.

## Composition With Sharding

Sharding partitions the filtered test set. Filters apply first; sharding
operates on the result. See [Composition Order](./composition-order.md) and
[Runtime Behavior § Sharding](./runtime-behavior.md#sharding).

## Programmatic Selection API

Embedders (IDEs, MCP servers, CI tools) construct filters programmatically:

```ts
import { all, any, file, name, not, tag } from '@overkill-dev/run/filters';

const filter = all([
    tag('fast'),
    not(tag('flaky')),
    any([ file('source/auth/**'), name('login') ])
]);

await orchestrator.run({
    config,
    cwd,
    engine: { kind: 'default' },
    request: {
        ...request,
        selection: { filter, kind: 'filter' }
    }
});
```

The CLI grammar is sugar over this API; both produce identical predicates.

## Sources

- [Pytest - markers](https://docs.pytest.org/en/stable/how-to/mark.html)
- [JUnit5 - Tags and Filtering](https://junit.org/junit5/docs/current/user-guide/#writing-tests-tagging-and-filtering)
- [Bazel - `tags` attribute](https://bazel.build/reference/be/common-definitions#common-attributes-tests)
- [Playwright - projects and grep](https://playwright.dev/docs/test-projects)
