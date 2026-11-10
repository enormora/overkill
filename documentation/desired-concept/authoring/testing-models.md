# Testing Models

## Purpose

Overkill should define test categories clearly enough that package
boundaries, defaults, and authoring expectations make sense.

This doc is a taxonomy and entry point, not the full specification for each
family. The owning documents named below carry the detailed mechanics.

## Microtests

Microtests are:

- small in scope
- deterministic
- local in dependencies
- side-effect-restricted by default

Typical use:

- pure logic
- parser behavior
- data transformation
- local state transitions

Microtests should not casually depend on:

- filesystem I/O
- network I/O
- subprocesses
- worker orchestration
- mutable global environment

## Integration Tests

Integration tests verify that multiple components cooperate correctly. They may legitimately use:

- filesystem state
- HTTP or IPC
- generated fixtures
- snapshots or baselines
- external services started locally

They need stronger runtime and orchestration support than microtests.

The most repeated integration pattern is an owned fixture or runtime wrapper
such as:

- start a deterministic app server, yield a base URL, then stop it
- start a temporary registry, yield auth details, then clean up storage
- create a page-object runtime and validate it after the test

That means Overkill should treat typed resource and runtime composition as
the main integration primitive rather than trying to stretch microtest
helpers upward.

Integration-style runs may also legitimately use:

- retries
- richer failure artifacts
- stability-marked tests

Those should remain visible runner concepts rather than hidden defaults.

## Browser And Workflow Tests

These tests validate UI, CLI, or multi-step workflows. The primary browser
meaning should be: run tests in real browsers for frontend code. That is
closer to the `karma` / `@web/test-runner` family than to building a full
Playwright replacement.

The central model is runtime-driven execution, often with:

- matrixed runtimes
- screenshots or structural snapshots
- process or browser lifecycle
- richer diagnostics

Concrete browser-layer needs include:

- browser-executed microtests or component-style tests
- page objects as test-facing handles only in richer adapter-driven layers
- transport-level request and event transcripts
- explicit attachments such as accessibility scan JSON
- visual baselines across browser and resolution matrices

These should be modeled above the engine through browser-oriented runtimes,
fixtures, and baseline adapters.

The important boundary is:

- Overkill should have a first-party browser-execution story
- richer end-to-end browser automation should come through integrations or
  adapters, with Playwright the obvious example, rather than through
  Overkill reimplementing that entire stack

## Baseline-Driven Tests

Some tests compare current output against checked-in baseline artifacts.

Subtypes:

- serialized content snapshots
- accessibility or structural snapshots
- terminal rendering baselines
- screenshot baselines

These are usually better suited to integration-oriented packages than to the microtest default.

## Benchmarks

Benchmarks model workflow performance under controlled workloads. Their
output is not just pass/fail correctness but measured behavior relative to
budgets and baselines.

Benchmarks may measure:

- runtime
- throughput
- latency percentiles
- responsiveness
- domain-specific metrics captured during execution

Latency-sensitive checks belong in this family too: benchmarks measure, and
budgets decide whether the measured latency or responsiveness stays within
declared limits.

## Type Tests

Type tests verify type-level behavior rather than runtime behavior.

They are a distinct execution family supplied by `@overkill-dev/type-test`.
TypeScript owns language checking; Overkill owns native assertions, case
ownership, planning, and reporting. Dependencies may supply comparison logic
when their public APIs fit that boundary.

Typical concerns:

- inference behavior
- overload selection
- conditional and mapped type behavior
- public declaration ergonomics

They should be able to participate in run planning, reporting, and selection even if the underlying checking engine is external.

See [Native Type-Test Integration](#native-type-test-integration) for the
authoring, original-source analysis, compiler compatibility, and package contract.

## Property-Based And Model-Based Tests

These are first-class higher-layer families rather than default microtest
behavior. They need different primitives such as generators, integrated
shrinking, edge cases, witnesses, corpora, model state, and targeted
search.

Property-based tests are their own `testFamily`. They are microtest-like in
capability boundaries and supervision needs, but they should not be mixed into
ordinary microtest or integration profiles by default. Generated input volume,
shrinking, witness storage, and timeout policy are different enough that a
dedicated profile is clearer and safer.

Property-based integration tests are possible in principle, but they are not a
first-party default shape. Projects that need that combination should model it
through an explicit higher-layer package or adapter instead of silently mixing
property tests into an integration profile.

The settled package split is:

- `@overkill-dev/property` for generator-driven property testing
- `@overkill-dev/model` for rule-based/state-machine testing above that core

The primary authoring form is `property({ title, generator, test })`, exported
as a test value directly or inside a suite. Standard users import it from
`@overkill-dev/test/property`; the underlying property package owns its
semantics. Nested `scope.forall` remains an advanced composition form.

Related advanced styles such as metamorphic, differential, and
linearizability-oriented testing also belong in that higher-layer family.
Contract-oriented suites belong there too, but primarily through
protocol-specific adapters.

See [Higher Test Layers](./higher-test-layers.md) for the detailed package
and authoring model.

## Why The Separation Matters

Overkill should not pretend that one API shape is the perfect surface for
all of these. The shared core should unify execution and reporting
contracts; higher-level packages should specialize the authoring model and
defaults.

## Native Type-Test Integration

### Direction

Type tests are first-class Overkill tests, authored with the existing engine,
`test`, suite, table, macro, and assertion-reference APIs. TypeScript analyzes
the original project. Overkill resolves assertion operands in that program and
reports static evidence against the selected cases.

```ts
import { test } from '@overkill-dev/test';
import { sameType } from '@overkill-dev/type-test';

function identity<Value>(value: Value): Value {
    return value;
}

export const testNode = test('preserves inference', (scope) => {
    const result = identity('hello' as const);
    scope.assert(sameType<typeof result, 'hello'>());
    return scope.assert.collect();
});
```

One source file and one description define each case. Checking must not create
temporary checker files, in-memory replacement files, derived source projects,
or generated code. Original paths, imports, lexical context, contextual typing,
and nominal declaration identity remain intact. Ordinary compiler ASTs and
caches are analysis data, not replacement source files.

### Public Package API

The root `@overkill-dev/type-test` export supplies `family`, `sameType`,
`assignableTo`, and `assignableFrom`, plus the settings and reference types below.
The initial catalog is deliberately these three relations. Existing ability
bindings, the `_` placeholder, and the separate adapter/profile/check entry
points are not part of this target API. Any migration compatibility exports must
be temporary delegates to the same engine contract, not another checking path.

```ts
type CompilerSelection =
    | { readonly kind: 'local'; }
    | {
        readonly kind: 'package';
        readonly specifier: string;
        readonly version: string;
    };

type CompilerPolicy = CompilerSelection | {
    readonly kind: 'matrix';
    readonly compilers: NonEmptyReadonlyArray<CompilerSelection>;
};

type TypeTestSettings = {
    readonly projectConfigPath: string;
    readonly compiler: CompilerPolicy;
};

type TypeRelationBindings = {
    <Actual, Expected>(): TypeAssertionReference<readonly [], readonly [Actual, Expected]>;
    readonly withActual: <Expected>() => TypeAssertionReference<readonly [actual: unknown], readonly [Expected]>;
    readonly withExpected: <Actual>() => TypeAssertionReference<readonly [expected: unknown], readonly [Actual]>;
    readonly expressions: TypeAssertionReference<readonly [actual: unknown, expected: unknown], readonly []>;
};

type TypeRelation = TypeRelationBindings & { readonly not: TypeRelationBindings; };

declare const family: TestFamily<TypeTestSettings>;
declare const sameType: TypeRelation;
declare const assignableTo: TypeRelation;
declare const assignableFrom: TypeRelation;
```

`TypeAssertionReference<Operands, Types>` is an engine-branded assert-only
composite reference carrying the declared operand tuple and a type-only marker
for the source type arguments. Those types are never recovered from a runtime
object. Negation applies to the complete relation, not to compiler errors or
unsupported evidence.

```ts
scope.assert(assignableTo<'hello', string>());
scope.assert(assignableFrom<string, 'hello'>());
scope.assert(sameType.withActual<string>(), value);
scope.assert(assignableTo.not<number, string>());
```

`withActual<Expected>()` takes its actual operand from the following expression;
`withExpected<Actual>()` takes its expected operand there. `expressions` takes
both expressions, using their compiler types at those exact source locations.
No expression is executed or widened to a declared type solely to make it fit.

The family ID is `@overkill-dev/type-test`. Its execution mode is `analysis`,
its profile option list is empty, and it supports in-process and supervised
process execution. Worker-pool scheduling and hard deadlines on the in-process
path are rejected. Compiler subprocess ownership follows the selected execution
boundary and its deadline.

Resolve `projectConfigPath` against the explicit project root and use that actual
configuration. Missing configuration is an error; there is no inferred-project
fallback. `local` resolves the installed `typescript` package from that root.
`package` resolves an explicitly installed package specifier from the same root
and requires its reported version to match `version` exactly. Package aliases
allow a matrix, such as `typescript6` and `typescript7`. Checking never installs,
downloads, or substitutes compilers. Provisioning is an explicit project setup
step, and a missing or unsupported compiler is a preparation error.

Deduplicate matrix entries only when their resolved compiler identity and
fingerprint agree. Preserve first occurrence order. A version alone does not
prove compiler identity. Exact prerelease packages can be used for compatibility
evaluation only when explicitly supported by the integration; their existence
does not imply production support for unstable APIs.

### Relation Semantics

`assignableTo<Actual, Expected>` asks the selected compiler whether `Actual` is
assignable to `Expected` under the actual project options. `assignableFrom`
reverses that direction. Preserve native `any` and `never` assignability rules;
users can explicitly test them with `sameType`. Error-recovery types and missing
symbols are invalid evidence, not instances of intentionally authored `any`.

`sameType` means structural type equivalence with nominal identities and
inference-relevant modifiers preserved. It is not syntax equality and not a
promise to decide mathematical equivalence of arbitrary conditional types.
The following observable rules define its minimum contract:

| Inputs | Equal? |
| --- | --- |
| `any` and `any`; `never` and `never`; `unknown` and `unknown` | Yes |
| `any` and `unknown`; `never` and another type; literal and its widened primitive | No |
| Identical union constituents in different orders | Yes |
| `{ a: string } & { b: number }` and `{ a: string; b: number }` | Yes |
| Optional property and required property including `undefined` | No |
| Readonly member and mutable member | No |
| Distinct declarations carrying private/protected or unique-symbol identity | No |
| Function signatures differing only in parameter names | Yes |
| Generic signatures differing only in bound parameter names | Yes |
| Different `this`, rest/optional parameters, constraints, defaults, `const`, or `NoInfer` behavior | No |
| Different overload order that changes inference | No |

Compare recursive structures cycle-safely. Uninstantiated generic types retain
constraints and symbolic structure; do not replace them with `any` or assume
that a macro invocation specializes their bodies. When supported public APIs
cannot establish equivalence or inequality, report inconclusive with a reason.
Negating inconclusive evidence remains inconclusive. Implementation must cover
these rules before exposing a passing equality result for the affected form.
Unsupported forms are explicit compatibility limits, never guessed verdicts.

### Result And Diagnostic Contract

Each selected non-skipped case must own at least one native assertion site.
Zero sites produce the existing `no-assertions` test-contract failure. For a case
with evidence, any failed relation makes it fail; otherwise any inconclusive
relation makes it inconclusive; otherwise it passes. Retain diagnostics for all
sites, including inconclusive sites in an already failing case. Each site counts
once per owning case, regardless of shared compiler work.

False relations produce ordinary assertion failures at the authored call site,
with the relation, operand type descriptions, compiler identity, and source
locations. Unsupported syntax or unresolved source ownership makes affected
cases inconclusive. Project configuration, compiler loading, ordinary TypeScript
diagnostics, input drift, and checker failures are infrastructure errors rather
than invented relation failures. Selected unfinished cases are inconclusive and
the run fails. A compiler error invalidating the program must not leave previously
computed evidence reported as trustworthy passing assertions. Buffer assertion
outcomes until post-check input validation succeeds; input drift produces run
errors and inconclusive cases before any passing case-end evidence is delivered.

Authored skipped cases stay skipped without body inspection. An empty selection
passes with zero executed cases and no analysis execution. Unsupported todo or
expected-failure controls are rejected; the package does not introduce its own
versions of those controls. Precise expected-diagnostic assertions are outside
the initial public catalog. Normal `@ts-expect-error` retains TypeScript's coarse
meaning, including unused-directive diagnostics; it is not promoted into a
precise Overkill diagnostic assertion.

### Native Assertion Contract

#### References And Checking

Native type assertions reuse engine-branded composite references through
`scope.assert(reference, ...operands)`. Resolve references by package/export
symbol identity, including import aliases. Read type arguments and expression
types from their original AST nodes; runtime values do not establish type
relationships. The engine does not gain built-in type matcher methods.

Supported references have an explicit, documented static interpretation.
Dynamic reference selection, arbitrary wrappers, unsupported operand forms,
and unresolved symbols produce diagnostics. A composite runtime reference does
not automatically become a statically checkable assertion.

Each reference invocation is one assertion boundary. Nested compiler diagnostics
do not create cases or inflate assertion counts. Annotation messages must be
statically identifiable. `scope.assert.collect()` remains the authored completion
form; checking does not execute it. Static references are assert-only and do not
establish runtime narrowing through `scope.require`.

The initial three-relation catalog is defined above. Further assertions require
sound original-source analysis rather than parity with another framework. Assignability uses the compiler's public
relation API. Equality needs a documented structural comparison contract that
handles `any`, `never`, generics, overloads, readonly and optional members, and
nominal declarations. Mutual assignability, formatted type strings, and compiler
object identity are not substitutes for that contract. Invalid or unresolved
operand types must not turn error-recovery types into successful checks.

For calls, constructors, inference, and generic instantiation, users can author
the actual TypeScript expression and assert its inferred type. Do not simulate
an unauthored call through hand-written overload selection or inference. Add a
specialized ability assertion only when its semantics are supported through
public APIs without generated source.

Expected-diagnostic assertions must identify an authored source boundary and
match the expected diagnostic; an unrelated error must not satisfy them. Define
that boundary and its diagnostic ownership before exposing such an assertion.
Ordinary `@ts-expect-error` only establishes that some error occurred on the next
line and must not be presented as a precise diagnostic assertion.

The initial catalog has no dedicated JSX or decorator applicability assertions.
The user's project may still contain TSX or decorators and is checked according
to its compiler configuration. Stable supported TypeScript features and public
compiler APIs define production support. Do not inspect private compiler fields
or patch the compiler to extend the catalog.

#### Static Bodies And Source Ownership

Case bodies are analyzed without execution. Module initialization and tree
construction still run when users import modules or construct roots. Mixed
runtime assertions and static references in one type-test case are rejected;
ordinary expression evaluation inside the case is compiler input only.
Accidentally invoking a static reference through runtime execution fails clearly.

A generic body is checked under its authored constraints and original lexical
context. Applying a macro with `string` does not specialize its generic callback
into a new compiler input. Tables retain row expansion and names, but their
shared body has its static parameter type, not a different type per runtime row.
Shared assertion sites retain ownership across all selected cases using them.

Source ownership is required for both direct engine roots and runner profiles.
The engine captures source anchors and first-party wrappers forward original
body metadata. Resolve those anchors through compiler symbols. Authoring call
locations, macro application locations, and `Function.toString()` alone do not
establish callback ownership. Unknown, ambiguous, evaluated, or generated
callbacks without an original source body produce diagnostics.

Existing roots do not require prepared imports, require hooks, ESM loaders,
module interception, or source rewriting. Projects that already compile their
tests provide their original sources and ordinary source maps. Overkill does
not generate those files or recover erased types from runtime functions.

Selection bounds assertion evaluation, not the compiler dependency graph. An
unselected or unattached body's static assertions do not produce results, but
normal TypeScript diagnostics elsewhere in the required project can still
prevent checking. Runtime control flow does not decide which static assertions
are checked within a selected body. Unsupported source forms and selected cases
without assertion evidence must not silently pass.

### Package And Family Selection

Keep `@overkill-dev/type-test` as an optional package containing assertion
references, an executable `family` value, typed settings, and compiler integration.
It can be used with the public engine without the high-level DSL or runner.
Compiler and checker dependencies belong here and load only when preparing a
selected type-test run. `@overkill-dev/test` neither bundles nor re-exports it.

```ts
import { defineConfig } from '@overkill-dev/test/config';
import { family as typeTests } from '@overkill-dev/type-test';

export const config = defineConfig({
    profiles: {
        types: {
            testFamily: typeTests,
            files: { include: [ 'source/**/*.types.ts' ] },
            settings: {
                projectConfigPath: './tsconfig.json',
                compiler: { kind: 'local' }
            }
        }
    }
});
```

The imported value supplies the implementation. A bare `'type-test'` identifier
is not an executable family selection. Imports do not mutate a registry,
augment a global type union, or register commands. A missing package fails at
its explicit import rather than being accepted as a dormant engine capability.

The engine owns the public family execution contract. The runner adapts profiles
to that contract and supplies discovery and orchestration. Family preparation
and result delivery must work below the runner layer. Direct callers supply an
engine-created plan, the same family value and settings, and execution options
through the public engine execution API. Checking must not require loading
project runner configuration or a `RunnerResult` wrapper. A package convenience
API may delegate to that same path; it must not implement a second pipeline.

Existing root ownership, selection, and reporting contracts apply to both entry
points. Source availability and compiler selection are explicit inputs.
The concrete calls are `engine.prepareFamily`, `prepared.collect`, and the
`engine.execute(collected, options)` overload defined by the family contract.
Prepared type-test execution must not fall back to invoking static case bodies.

See [Executable Test Families](../architecture/test-families.md)
for the shared contract, built-in aliases, settings, and process boundaries.

### Compiler And Dependency Boundary

TypeScript owns parsing, module resolution, inference, and language diagnostics.
Overkill owns assertion interpretation, source ownership, and case attribution.
Reuse TSTyche or another focused dependency when its supported public API can
operate on the original program or its types. Retaining or removing TSTyche is
not a product goal. Its runner and full matcher catalog do not define Overkill's
public assertion contract.

If no suitable public dependency interface exists, implement the necessary
assertion comparison against public TypeScript APIs. Do not reimplement the
TypeScript checker. Equality requires its own semantic validation and is not
assumed to be a trivial wrapper around assignability.

Design compiler integration against the TypeScript 7.1 API as well as the
supported stable compiler APIs. A pinned 7.1 prerelease can validate the design
before its stable release; that does not imply production support for unstable
compiler APIs. Keep compiler-specific AST, type, and session handling inside the
package. Manage program/session disposal explicitly and do not mix types from
different compiler programs or snapshots.

Checking does not emit JavaScript, declarations, or compiler cache files and
does not build referenced projects automatically. Respect the actual project's
reference semantics; unavailable required build outputs produce a diagnostic.
Existing project build artifacts remain ordinary compiler inputs.

Backend evaluation and the distinction between TypeScript 7 support and a public
reusable comparison API are recorded in
[Type-Test Backend Findings](../research/candidate-libraries.md#type-test-backend-findings).

### Planning And Execution

1. Collect the ordinary Overkill tree and validate it against the selected family.
   Resolve original source bodies and assertion ownership without invoking them.
2. Prepare the actual compiler project for each selected exact compiler version.
   Preserve its compiler options, references, resolution settings, and original
   source files. Compiler variants expand `WorkId.familyVariant`, not logical
   `CaseId`.
3. Freeze project inputs and expanded case identities before filtering, sharding,
   and ordering. Collect evidence ownership for the selected plan. Never discover
   extra cases from compiler traversal during execution.
4. Read operand types and diagnostics from the original program and evaluate only
   selected assertion sites. Reuse shared static evidence within that program
   while retaining each selected case's ownership and selected result order.
5. Return evidence through the engine's common assertion, result, reporter, timing,
   and artifact contracts. The engine validates identities and completeness.
   Compiler setup and unattributed project diagnostics remain run-level failures;
   missing or ambiguous evidence never becomes a successful empty check.
6. Dispose compiler resources on success, failure, and cancellation. Apply deadlines
   to preparation and checking. A hard deadline requires an owned terminable
   execution boundary; an in-process cancellation request cannot preempt arbitrary
   synchronous compiler work.

Coverage, runtime/resource attachment, body retries, and ordinary case execution
controls are unsupported for the type-test family. Reject them before checking.
Compiler runs and runtime test loops remain independent. Watch reruns prepare or
update real compiler projects without creating generated-file feedback loops.

### Frozen Compiler Plans And Reproduction

Compiler selection accepts one selection or an explicit non-empty matrix.
Resolve local selections once, deduplicate matching compiler identities, and expand executable
work before selection. Programs, original configuration, assertion ownership,
and observed compiler inputs belong to the retained family preparation.

Record compiler and family implementation versions, configuration dependencies,
effective options, original roots and references, source and declaration
fingerprints, resolution metadata, and existence probes. Family facts are
lossless JSON and are available before `run-start`. They contain identifiers
and evidence descriptions, not live compiler objects or executable callbacks.

Revalidate observed inputs before checking and after completion. Detected drift
invalidates the invocation and requires fresh collection. This validates observed
inputs; it is not a hermetic snapshot or a guarantee against transient changes.
No generated-input policy or temporary-path provenance is needed.

Direct and runner execution share the same selected plan. Runtime and compiler
expansion precede filtering; sharding precedes ordering. Seeded execution uses a
resolved seed. Empty shards succeed without assertion evaluation. Unsupported
nested assertion selectors are rejected rather than widened to an enclosing case.

Historical results remain readable without executing family code. Reproduction
requires a compatible explicitly resolved family, compiler, and original project
inputs. Unknown or incompatible implementations produce diagnostics rather than
falling back to runtime execution or a different compiler.
