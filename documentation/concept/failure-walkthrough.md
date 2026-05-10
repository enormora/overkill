# Failure Walkthrough

## Purpose

Most concept docs describe one segment of the failure path: how
assertions are recorded, how outcomes are typed, how artifacts are
named, how reporters render. This doc threads them.

A single failing test is followed end to end — from the line of
source that produces a `FailedCheck` to the artifact a developer
opens hours later in another machine. Every domain doc is the
canonical authority for its segment; this walkthrough only shows
how the segments fit.

## The Test

A property test exported as a `Suite` value (see `tests-as-values.md`
§ What It Looks Like); the runner imports the module and walks the
value rather than relying on registration side effects:

```ts
// source/users.test.ts
import { assertion } from '@overkill/assert';
import { gen } from '@overkill/property'; // proposed package, see types-index
import { suite, test } from '@overkill/test';
import { parse, serialize } from './users.ts';

export const spec = suite('users', [
    test('round-trip preserves values', (case) => {
        return case.forall(gen.user(), (user) =>
            assertion.equal(parse(serialize(user)), user),
        );
    }),
]);
```

The test passes for thousands of generated inputs, then fails on a
shrunk minimal counterexample: a `User` whose `name` contains a
combining accent. `parse(serialize(...))` roundtrips Unicode in NFD
form when the input was NFC. The structures compare unequal.

The important part for this walkthrough is not the property helper
itself; it is the authoring shape around it: the file exports a suite
value, the case body returns a `case.forall(...)` invocation built
from pure assertion-node constructors, and the failure still enters
the pipeline as a recorded `FailedCheck`.

## Stage 1 — `case.forall` Shrinks And Records

`case.forall(generator, body)` evaluates the body for each generated
input, getting back an `AssertionNode` value (`assertion.equal` is
pure — it produces a node, it does not mutate any log). Once
`case.forall` sees a failing node, it shrinks the input to a minimal
counterexample and records a single `FailedCheck` for that
counterexample into the case's assertion log (see
`assertions-and-results.md` § Diff And Diagnostic Shape, and
§ Property Tests And The Assertion Boundary for the boundary rule):

```ts
// recorded into the case's assertion log
const recorded: FailedCheck = {
    id: '0001',
    summary: 'expected deep equality',
    expected: { id: '42', name: 'Adäle' }, // NFC
    actual: { id: '42', name: 'Adäle' }, // NFD
    path: ['name'],
    location: { file: 'source/users.test.ts', line: 10 },
    diff: {
        kind: 'object',
        ops: [{ operation: 'replace', path: ['name'], from: '"Adäle"', to: '"Adäle"' }],
    },
};
```

The diff is structured. Reporters do not parse strings; they consume
this shape. Truncation, colorisation, and ANSI escapes happen later.

Canonical: `assertions-and-results.md`.

## Stage 2 — Test Body Returns; Outcome Constructed

`case.forall` returns the test body's terminal value (the
property-test analogue of `case.assert.done()`). The engine reads
the case's recorded log and constructs the `TestOutcome` (see
`results-not-exceptions.md` § The Protocol Shape, also
`types-index.md`):

```ts
const outcome: TestOutcome = {
    kind: 'fail',
    checks: [recorded],
};
```

`case.forall` is the **assertion-recording boundary** for property
tests: regardless of how many generated inputs the body runs against,
the call records one assertion's worth of activity in the case's log
on success, or one `FailedCheck` for the shrunk counterexample on
failure. The walkthrough does not write `case.plan(1)` because the
boundary rule already satisfies zero-assertion detection; the
canonical statement of the rule lives in
`assertions-and-results.md` § Property Tests And The Assertion
Boundary. `plan(n)` remains available — it counts boundary
assertions, so `case.plan(1)` would still pass — but it is not
load-bearing for property tests.

The engine is at this point done with the test. Whatever happens
next — verdict derivation, identity attachment, artifact paths,
reporter dispatch — is orchestration.

Canonical: `results-not-exceptions.md`, `assertions-and-results.md`.

## Stage 3 — Verdict Derivation

The orchestration layer combines the engine outcome with metadata
and runner-error state to derive a reporter-facing **verdict** (see
`glossary.md` § Test Verdict).

For this test:

-   outcome `kind === 'fail'`
-   no `xfail` metadata on the test
-   no runner error during the body

→ verdict `fail`. Exit code 1 will follow at run completion (see
`runtime-behavior.md` § Exit Codes And `process.exit`).

If the test had been marked `{ stability: 'experimental' }` with
xfail expectation, the same outcome would have derived
`expected-fail` instead. Same engine result, different verdict — the
layering isolates the engine from reporter policy.

Canonical: `glossary.md` § Test Outcome / Test Verdict.

## Stage 4 — Identity And Artifact Path

The test's stable identity is computed once at collection (see
`artifact-identity.md`):

```ts
const caseId: CaseId = {
    file: 'source/users.test.ts',
    suite: ['users'],
    name: 'round-trip preserves values',
    // no params, no runtime, no workload
};
```

Property tests produce a witness — a replayable artifact recording
seed and shrunk counterexample — alongside the failure. Its
`ArtifactId` (see `artifact-identity.md` § Concrete Type Sketch):

```ts
const witnessId: ArtifactId = {
    case: caseId,
    subtype: 'witness',
};
```

Path derivation (canonical rule in `artifact-identity.md` § Path
Derivation):

```
.overkill/witnesses/source/users.test__users__round-trip-preserves-values.witness.json
```

Canonical: `artifact-identity.md`.

## Stage 5 — Witness File Written

Per `failure-artifacts.md` § Witnesses And Replay Artifacts, the
property runner writes a `WitnessFile` to the path above:

```json
{
    "version": 1,
    "producedBy": { "library": "@overkill/property", "libraryVersion": "0.4.2" },
    "case": {
        "file": "source/users.test.ts",
        "suite": ["users"],
        "name": "round-trip preserves values"
    },
    "kind": "property",
    "seed": "0xdeadbeef",
    "shrinkPath": [
        /* … shrink steps */
    ],
    "counterexample": { "id": "42", "name": "Adäle" }
}
```

This is the artifact that survives the run.

Canonical: `failure-artifacts.md`.

## Stage 6 — Run Record

Run completion writes a `RunRecord` (see `reproducibility.md` § Run
Record Shape, also `types-index.md`) to
`.overkill/runs/<run-id>.json`. The relevant per-test entry:

```ts
{
    id: caseId,
    outcome: { kind: 'fail', checks: [recorded] },
    verdict: 'fail',
}
```

The witness path appears in the run's `artifacts` array under the
same `ArtifactId`. Replay (`overkill replay <run-id>`) reads the
record; replay-witness (`overkill replay-witness <path>`) reads the
witness directly.

If the user had explicitly enabled debug for this case — typically via
`--debug-test <id>` or a narrowly filtered `--debug` run — a
`TestDebugArtifact` (see `runtime-behavior.md` § Test Debug Mode)
would also exist at
`.overkill/runs/<run-id>/debug/<case-id>.debug.json`, with the
timeline showing `forall` iteration counts up to the failure. The
`RunPlan.debugMode` field records that debug data was collected.

Canonical: `reproducibility.md`, `failure-artifacts.md`,
`runtime-behavior.md`.

## Stage 7 — Reporter Renders

The default reporter receives the run events as they happen and
prints the failure inline:

```
✗ users › round-trip preserves values  source/users.test.ts:10

  expected deep equality at .name
    expected: "Adäle"
    actual:   "Adäle"

  Replay this exact failure:
    overkill replay-witness .overkill/witnesses/source/users.test__users__round-trip-preserves-values.witness.json
```

The diff shape from stage 1 is what the reporter renders; the
witness path from stage 5 becomes the replay command. Different
reporters (JSON, HTML, TAP) format the same data differently. The
JSON reporter writes the full diff and witness path as a structured
event consumable by IDEs and MCP servers.

Canonical: `package-architecture.md` § Reporters,
`failure-artifacts.md`.

## Stage 8 — Replay The Witness

The next morning, on a different machine, the developer runs:

```
overkill replay-witness .overkill/witnesses/source/users.test__users__round-trip-preserves-values.witness.json
```

The replay-witness command reads the file (stage 5), restores the
seed, replays the test against the recorded counterexample (no
re-shrinking), and reproduces the failure bit-for-bit. Stages 1–7
repeat with `verdict === 'fail'` and the same failed check.

Canonical: `failure-artifacts.md` § Witnesses And Replay Artifacts,
`reproducibility.md` § Replay Witnesses For Properties And
Simulations.

## What This Walkthrough Surfaces

Reading the stages in sequence, the boundary contracts that have to
hold for the path to work:

-   `FailedCheck` shape is the same in `assertions-and-results.md`,
    `results-not-exceptions.md`, and `types-index.md`
-   `TestOutcome` is the engine ADT (4 cases); the verdict is the
    derivation
-   `CaseId` is the only key threading test → outcome → artifact →
    witness → run record → reporter
-   `WitnessFile` schema is the source of truth for replay; the
    glossary, novel-techniques, and reproducibility cross-link
-   `--debug` adds a parallel artifact stream without altering any
    of the contracts above

If a future change breaks one of those contracts (renaming
`FailedCheck`, splitting `TestOutcome`, dropping a required
`WitnessFile` field), this walkthrough is where the break becomes
visible first.

## Cross-References

This document is a reading aid; the canonical specs live in:

-   `assertions-and-results.md` — assertion API, `FailedCheck`,
    diff shape, plan
-   `results-not-exceptions.md` — `TestOutcome` ADT
-   `glossary.md` — outcome / verdict layering
-   `artifact-identity.md` — identity types, path derivation
-   `failure-artifacts.md` — witnesses, run-record artifact list
-   `reproducibility.md` — `RunRecord`, replay
-   `runtime-behavior.md` — exit codes, debug mode
-   `types-index.md` — every TS type used above
