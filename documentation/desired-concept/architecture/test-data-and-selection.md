# Test Data And Selection

## Purpose

This document defines the data Overkill attaches to tests beyond their
executable body, and how users select subsets of a run without inline
`.only`.

## Position

Overkill uses separate data channels instead of a single broad metadata bag:

- **Annotations**: user-authored labels for selection and reporting.
- **Controls**: user-authored execution knobs.
- **Facts**: runner-collected or engine-assigned information about a run.
- **Observed results**: data produced by execution.
- **Requirements**: future declarations for required environment or
  capabilities.

Annotations and controls are authored on roots, suites, tables, and tests.
Facts are not authored. Observed results are not inputs. Requirements are not
part of the current public API.

## Annotations

Annotations are descriptive authoring data. They do not directly change
execution behavior.

```ts
type TestAnnotationsInput = {
    readonly ownership?: readonly string[];
    readonly tags?: readonly string[];
};

type TestAnnotations = {
    readonly ownership: readonly string[];
    readonly tags: readonly string[];
};
```

Annotations cascade from root to suite, table, and case. Set-valued fields
merge by union while preserving parent-first order.

## Controls

Controls are authored execution knobs.

```ts
type TestControlsInput = {
    readonly capture?: 'buffered' | 'live';
    readonly timeoutMilliseconds?: number;
};

type TestControls = {
    readonly capture: 'buffered' | 'live' | null;
    readonly timeoutMilliseconds: number | null;
};
```

Controls cascade from root to suite, table, and case. A child value replaces
the inherited value.

`capture` is only valid for capture-capable test families. Microtest profiles
reject authored capture controls and live run capture. When exactly one
capture-capable case is active in a supervised run, the case control may switch
that case from buffered run capture to live capture.

`timeoutMilliseconds` may only shorten the selected profile's soft timeout.
It must be a positive safe integer no greater than the profile soft timeout.

## Test Family

Test family is not an annotation or a control. A run profile binds one family
for the whole run. Mixed-family runs are invalid.

High-level facades stamp authored nodes with an internal family marker:

```ts
createTestFacade({ testFamily: 'integration' });
```

The marker is engine-owned. It is used during planning to reject a case whose
family does not match the selected profile. It is not serialized as authored
test data. The serialized run fact remains:

```ts
facts.execution.testFamily;
```

Low-level engine nodes are family-neutral unless a facade or integration layer
stamps them.

## Removed Fields

These fields are intentionally not part of current authored test data:

- `kind`: replaced by the internal family marker and run execution facts.
- `extra`: removed because it made first-party data boundaries vague.
- `priority`: removed because no scheduling or reporting meaning was defined.
- `debug`: future run/debug mechanism, not current authored test data.
- `stability`: future derived fact from persisted run history.
- `baselines`, `capabilities`, `runtimes`: deferred to requirements or
  observed results when their consumers exist.

Breaking changes are acceptable at this stage, so the old metadata names are
not retained as aliases.

## Observed Results

Observed results are execution outputs. `RunResult` is the current observation
surface.

Artifacts are durable or attached observed results:

- captured output
- failure artifacts
- snapshots or baseline evidence
- future debugger traces

Artifacts remain a named concept because reporters and CI need durable,
addressable outputs. They are part of observed results, not authored test data.

## Selection

Selection belongs to orchestration. Filters apply during run planning, before
execution starts.

Filterable dimensions:

- case id through the programmatic API
- file path
- title
- suite path
- params
- tag
- owner

Test family is not a filter dimension because the selected profile already
binds one family. Runtime and stability are not current filter dimensions.

## Filter Expression Grammar

The programmatic filter tree is canonical. The CLI grammar lowers to the same
tree.

```text
expr      := term ( ' ' term )*
term      := dimension '=' value
          |  dimension '~' text
          |  dimension ':' glob
          |  '!' term
          |  '(' expr ')'
          |  expr '|' expr
value     := identifier | quoted-string
dimension := 'tag' | 'owner' | 'file' | 'title' | 'suite' | 'params'
```

Examples:

```text
--filter 'tag=fast !tag=flaky'
--filter 'file:source/auth/* tag=critical'
--filter 'title~"should "'
```

Rules:

- space is AND
- `|` is OR
- `!` negates one term
- parentheses group
- glob (`:`) supports `*`, `**`, and `?`
- contains (`~`) is case-insensitive
- quoted values may use single or double quotes after shell parsing

Exact `CaseId` selection is API-only because `CaseId` is structured runner
data, not a user-facing CLI string.

## Local Iteration Workflow

The replacement for `.only`:

- `--title 'login'` runs tests whose title contains the text
- `--file source/auth/login.test.ts` runs only that file
- `--filter 'tag=fast'` runs matching annotations
- `--last-failed` selects cases from the previous persisted run record
- `--watch` reruns the selected suite on file change

None of these modify test source.

## Future Work

`skippedTest(reason, ...)` should become an all-family helper for environment
or capability conditions that are known during authoring or collection. It is
different from `.skip`: it records a planned, reasoned skipped case instead of
silently removing executable work from the plan.

Historical flakiness should be derived from persisted run records. Baseline
usage should come from runtime observations or baseline APIs. Capability and
runtime needs should move into requirements once that concept is implemented.

## Sources

- [Pytest - markers](https://docs.pytest.org/en/stable/how-to/mark.html)
- [JUnit5 - Tags and Filtering](https://junit.org/junit5/docs/current/user-guide/#writing-tests-tagging-and-filtering)
- [Bazel - `tags` attribute](https://bazel.build/reference/be/common-definitions#common-attributes-tests)
- [Playwright - projects and grep](https://playwright.dev/docs/test-projects)
