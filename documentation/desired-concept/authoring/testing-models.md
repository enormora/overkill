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

They are a real test family for a TypeScript-first ecosystem, but Overkill should support them through adapter or integration layers rather than implementing its own type-test engine.

Typical concerns:

- inference behavior
- overload selection
- conditional and mapped type behavior
- public declaration ergonomics

They should be able to participate in run planning, reporting, and selection even if the underlying checking engine is external.

See [Type-Test Authoring Feasibility](#type-test-authoring-feasibility) for
the boundary between shared Overkill composition and static type assertions.

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

## Type-Test Authoring Feasibility

### Question And Constraints

Can type tests use the regular Overkill authoring layers, from low-level
engine cases through `test`, suites, tables, and macros, while an external
tool checks the types?

The existing concept requires external checking, a dedicated `type-test`
profile, independent runtime and compiler loops, and participation in
planning, selection, and reporting. The plan freezes before execution.
These constraints remain unchanged.

### Answer

Shared composition is feasible. An adapter can supply a body carrying an
explicit type-check definition to the existing node constructors. Overkill
owns the resulting case identity, tree reachability, annotations, selection,
and reporting lifecycle. The external tool owns assertion semantics and
compiler diagnostics.

The proposed first boundary is a fixture-backed body. Illustrative syntax,
not an existing API or a settled package name:

```ts
test('preserves inference', checkTypes({
    file: new URL('./inference.type-test.ts', import.meta.url)
}))
```

The composition module is imported normally; the referenced fixture is
checked by TSTyche. Each Overkill case owns its declared fixture boundary.
Nested TSTyche tests and assertions are structured diagnostic detail, not
additional Overkill cases discovered during execution. Title selection
selects the Overkill case and checks its whole fixture.

This does not establish that separate fixtures meet the desired authoring
experience. Whether inline assertions are required remains open. The
feasibility answer is settled; the fixture-backed API is a proposal.

### Evidence And Required Integration

The repository already uses TSTyche `7.2.5` through `tstyche.json`,
`just test-types`, and `*.type-test.ts` files. Existing body-family metadata
in `source/engine/test-body.ts` can carry adapter definitions. Node
constructors and table wrappers preserve that metadata. Current execution
still resolves such bodies as ordinary builder bodies unless a supported
family-specific execution mode handles them; metadata alone does not
implement type testing.

TSTyche's pinned public API accepts explicit fixture files and emits
structured collection, assertion, diagnostic, and completion events. It
does not expose a separate collection-only phase. Its
[reporter contract](https://tstyche.org/guides/reporters) supports structured
result delivery without parsing terminal output. Implementation must use
the API of the supported TSTyche version rather than assume current website
examples match the pinned release.

Before plan freeze, the adapter must resolve fixture definitions and
concrete compiler versions. Compiler variants belong in `WorkId`, not
logical `CaseId`. Execution must preserve the selected fixture boundary,
retain diagnostics that cannot be attributed to a nested assertion, and
surface checker setup failures as failures rather than successful empty
results. Compiler services stay outside the ordinary microtest startup path.

Tables can compose checker-backed bodies, but runtime row values do not
specialize a static type-check program. Row-specific fixtures require an
explicit collection-time resolution mechanism; selecting a fixture inside
an ordinary execution callback does not satisfy frozen planning. Reusing
one fixture across rows or macro applications checks the same program.

### Alternatives And Their Limits

- Automatic file-level cases are feasible, but do not establish the desired
  reuse of Overkill's authoring layers. They remain an optional integration
  approach rather than the answer to the shared-authoring question.
- Automatically turning TSTyche's named tests into Overkill cases lacks
  public collection before checking in the pinned API. Collection events
  during execution arrive too late to define the frozen plan.
- Inline TSTyche assertions inside arbitrary Overkill callbacks are found
  statically, but have no Overkill case ownership. A probe checked both an
  exported callback and an unreachable callback, reporting their assertions
  at file level. Overkill selection would therefore not bound checking.
- A different compiler-backed assertion library does not by itself solve
  ownership. Reused callbacks and generic macro bodies have shared source;
  runtime invocations do not cause separate compiler checks with concrete
  row types. Restricted inline authoring needs its own ownership and
  selection contract.

### Assumptions And Invalidation

Fixture-backed composition assumes an acceptable split between Overkill
composition and separately authored static checks. That product preference
is unresolved. Requiring inline assertions would invalidate this proposed
boundary and require another design decision, not a claim that the external
checker already understands Overkill's runtime tree.

Revisit named-test integration if the external tool provides collection
without checking and exact execution of selected collected nodes. Revisit
inline authoring only with an explicit account of shared bodies, generic
macros, tables, unreachable nodes, and diagnostics outside selected bodies.
