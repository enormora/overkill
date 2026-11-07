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

See [Native Type-Test Integration](#native-type-test-integration) for the
authoring direction, programmatic API findings, and remaining backend prerequisite.

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

### Question And Direction

Can regular Overkill cases contain native type assertions while TSTyche owns
checking, without separate fixtures or duplicated test descriptions?

That is the required authoring direction. Keep the existing low-level and
high-level composition layers and assertion-reference style. The adapter
owns source translation and result mapping; TSTyche owns type relationships
and diagnostics. A dedicated `type-test` profile, frozen planning, independent
runtime and compiler loops, and no coverage remain constraints.

Native adapter binding:

```ts
import { sameType } from '@overkill-dev/type-test';

test('preserves inference', (scope) => {
    const result = identity('hello' as const);
    scope.assert(sameType<typeof result, 'hello'>());
    return scope.assert.collect();
});
```

The user writes one source file and one description. No TSTyche imports,
external fixture references, or second test tree are required in user code.

### Native Assertion Contract

#### References And Adapter Boundaries

Native type assertions reuse imported, engine-branded composite assertion
references through `scope.assert(reference, ...operands)`. The package exposes
generic reference factories and expression operands where its checker supports
them. Type arguments and expressions are source inputs to
the adapter, not runtime evidence of a type relationship. No separate static
reference category or built-in type matcher methods are added to the engine.

The engine and runner must expose public, backend-independent contracts for
adapter integration. TSTyche and other adapters must not need private core
imports. The engine owns assertion boundaries, identities, and native results;
the runner owns generic validation, collection, planning, and execution lowering.
An adapter owns its supported bindings, source recognition, translation, and
external checker invocation. Registration uses an explicit adapter value with
validation, preparation, collection, lowering, and execution contracts.

`@overkill-dev/type-test` provides bindings for the full supported TSTyche
assertion surface, with checking and diagnostics delegated to TSTyche. Concrete
bindings and operand forms are documented in the optional package. This contract
does not define a smaller Overkill type-assertion catalog or a public registry
for user-defined matcher translations.

Supported references must resolve to adapter-owned package exports, including
aliased imports. Being a composite reference does not by itself make a custom
assertion statically translatable. Dynamic reference selection, arbitrary
wrappers, and other indirection without supported source recognition must be
rejected rather than silently omitted. Runtime custom assertions retain their
existing protocol.

These bindings are assert-only: they do not provide runtime gating or narrowing
through `scope.require`. Each reference invocation remains one assertion boundary;
checker diagnostics nested within it do not create extra cases or boundaries.
Annotations use the existing prefix assertion context. `scope.assert.collect()`
remains the authored completion form; it is not executed to obtain checker
results. Detailed empty, skipped, and expected-failure accounting belongs to the
results and diagnostics milestone.

A checker-backed case must reject runtime assertions mixed with static bindings.
Local expressions remain valid TypeScript inputs, but neither their runtime
values nor side effects are obtained by executing the case body. Runtime
`fromThrowable` and `fromRejectable` bridges cannot check erased type arguments.
If ordinary execution invokes a checker-only binding, it must fail clearly;
it must never record a successful assertion as a fallback.

#### Generic Bodies And Static Composition

The same contract applies to low-level engine cases and high-level `test`,
suite, table, and macro composition. Users author one source file and one
description per case, without external fixtures, direct TSTyche imports, or a
second test tree.

A generic body is checked as authored, under its declared constraints and in its
original lexical context. Preserve contextual typing and expression diagnostics.
For example, a check involving `T` inside a generic macro checks that generic
body; calling the macro with `string` does not replace `T` with `string` in a
new checker program.

Tables retain ordinary row expansion and case naming. Their shared body sees
the statically declared or inferred parameter type, not a separate type for each
runtime row. Multiple rows can therefore own the same static assertion evidence.
Row-specific type specialization requires an explicit static model outside this
contract; it must not be inferred from runtime data.

Macros remain ordinary functions returning test trees. Plain functions,
`defineMacro`, and `defineParameterizedTestBody` follow the same static rule:
reusing a body does not specialize it per application. Distinct authored bodies
retain their own assertion sites, while shared sites retain ownership across all
selected cases that use them. Macro application locations are useful attribution,
but do not establish assertion-body ownership on their own.

The engine captures authoring call locations and first-party wrappers forward
original callback metadata. The adapter resolves those anchors through TypeScript
symbols. Checking existing roots does not require import instrumentation,
require hooks, ESM loaders, or a prepared-import API. `import.meta` belongs to
the module containing it and cannot discover an arbitrary callback's source.
Unknown or ambiguous provenance produces a diagnostic.

Decorator applicability uses a declaration callback whose parameter is applied
as a decorator; each native assertion owns all its decorator sites. JSX checks
retain the original `.tsx` extension and require project JSX compiler options.
Projects precompile syntax unsupported by Node with ordinary source maps and
run with source-map support. The adapter never transforms modules during loading. Generated projects retain
compiler settings and bind the injected `tstyche` import to the adapter's installed
checker through an explicit path mapping, including when dependencies are nested.

Selection bounds assertion evaluation: omit checks owned only by unselected or
unreachable bodies. It does not bound the compiler dependency graph; invalid
TypeScript outside a selected assertion can still prevent checking. Unsupported
source ownership or assertion forms must produce diagnostics, not successful
checks with missing evidence.

### Package Distribution

Ship `@overkill-dev/type-test` as one optional package, installed alongside
`@overkill-dev/test` or used with the lower-level engine and runner APIs.
It owns native type-assertion references, typed profile wiring, programmatic
adapter registration, source translation, generated-input management, and
TSTyche execution. TSTyche and compiler-tooling dependencies belong here.
The package does not require the high-level `@overkill-dev/test` distribution.
Its programmatic checking API accepts engine roots and applies the same source
ownership and planning rules as configured runs. Ordinary engine execution
must not invoke static assertion markers as builder bodies.

`@overkill-dev/test` continues to supply ordinary `test`, suite, table, and
macro authoring plus the `overkill` binary. It neither includes the optional
package nor re-exports it through a standard-distribution subpath. Native
type assertions are imported from `@overkill-dev/type-test`; users keep the
same Overkill composition and assertion style.

`@overkill-dev/run` owns generic profile, planning, selection, and orchestration
contracts; the engine owns nodes, identities, and native results. Neither
depends on the optional package. Projects attach the adapter explicitly
through its typed profile or programmatic registration API. Installing it
does not register commands or widen configuration through module augmentation.
Importing assertions has no registration side effects. The runner needs a
generic adapter contract for validation, collection, execution lowering, and
frozen facts; TSTyche-specific behavior stays in the optional package.
The existing `overkill run --profile <name>` executes the selected type-test
profile; a missing adapter produces an actionable configuration error.

The optional package's authoring and registration imports stay lightweight.
Load checker and compiler modules only when resolving or executing a selected
type-test run. Keep the TSTyche backend in this package; a separate backend
package is unnecessary until another supported backend creates that need.
Recognize assertion references by package and export identity, including import
aliases, independently of which authoring layer constructs the case.

### Public API Findings

TSTyche `7.2.5` exposes [`tstyche/api`](https://tstyche.org/guides/programmatic-usage):
`Config`, `Runner.run(files)`, `FileLocation`, `EventEmitter`, and
`CancellationToken`. Structured events include assertion results, diagnostics,
and completion. `tstyche/tag` invokes the same file-oriented runner; it does
not check an erased generic argument supplied by a runtime caller.

The public exports provide neither a custom assertion backend nor source-text
or compiler-host input to `Runner`. Recognition expects direct imports from
`tstyche`, so native assertion references need static translation. Compiler
and matcher internals remain TSTyche-owned; translation does not require
implementing type equality or assignability.

TSTyche's supported [template mechanism](https://tstyche.org/guides/template-test-files)
accepts generated text under the template's filename. A prototype imported
real Overkill nodes without invoking bodies, translated inline assertions,
and used public runner events to map results back to their source sites.
Selecting the passing case excluded a failing case and an unreachable body;
selecting the failing case produced a checker failure.

### Best-Effort Generated Input

Use the existing public TSTyche API without waiting for upstream changes.
Translate native assertions into adapter-owned, dot-prefixed sibling modules,
preserving the source extension and relative import directory. Users continue
to author ordinary Overkill cases. Never overwrite original source; exclude
generated inputs from Overkill discovery and watch triggers, verify exclusion
from ordinary project discovery, and clean up only artifacts owned by the run.
If a project cannot safely accommodate generated input, report that limitation.

Create an explicit checker configuration for each original project and compiler
version. Preserve effective compiler options, project references, and resolution
settings; rebase path-valued options where required and include generated inputs
explicitly. Verify that TSTyche uses the expected configuration and compiler,
rather than accepting its baseline fallback. An explicit derived configuration
prevented the fallback in a prototype.

Maintain original-to-generated module and source-offset mappings. Rewrite direct
self-imports and imports between translated modules when resolution is
unambiguous. This can repair the direct self-import case without implementing a
checker. Do not attempt a general project mirror or dependency graph merely to
claim transparent equivalence.

Generated input still has a different module identity. Unrewritten self-imports,
transitive references to original nominal declarations, package-specific
resolution, and source-path-sensitive constructs can change the program being
checked. Record generated-input provenance and known limitations in results and
run records. Detected ambiguity makes affected checks inconclusive with source
diagnostics. Configuration or transport failures fail the run. Missing assertion
results never become successful checks.

This is explicitly best-effort checking: undetected identity differences may
produce false passes or false failures. The adapter does not promise equivalence
to checking the original module. Improve supported cases through regression
coverage; a future original-path API is optional and does not gate delivery.

The internal generated-input component owns siblings for one callback lifetime.
It accepts translated text with copied or anchored UTF-16 source ranges and the
selected compiler API. Import ambiguity propagates through supplied translated
modules; independent modules remain checkable. It does not discover a complete
project dependency graph or provide native assertion recognition yet.

Generated names reserve the `.overkill-type-test-` prefix. Overkill discovery
omits these names and rejects them as explicit run inputs. If ordinary project
root discovery includes generated files, preparation fails and removes owned
files. Projects must configure external watchers to ignore the same prefix;
this component does not control external watchers. Cleanup preserves files
whose identity or contents changed and reports the failure.

The internal checked-input operation derives an owned sibling configuration per
explicit project and selected compiler. It retains original roots, adds generated
inputs explicitly, inherits compiler options, and copies project references.
It returns buffered checker events and provenance only after project/compiler
verification and cleanup succeed. Calls through this operation are serialized;
unrelated direct TSTyche runs must not overlap them in the same process.

### Planning And Execution Boundary

1. Collect the ordinary Overkill tree, identify checker-backed cases, and
   associate their bodies with stable source anchors. Preserve original
   contextual typing; ordinary callsite locations, forwarded macro locations,
   and function text alone do
   not establish body ownership.
2. Freeze selected case identities, assertion ownership, source fingerprints,
   project configuration, generated-input policy, and concrete compiler
   versions. Compiler variants belong in `WorkId`, not logical `CaseId`.
3. Translate supported assertion references in their original lexical context.
   Preserve native expression diagnostics and map generated offsets back to
   original locations. Suppress checks owned only by unselected or unreachable
   bodies; reject unsupported assertion forms rather than silently omitting them.
4. Lower frozen type-test cases into external checker work instead of invoking
   their ordinary builder bodies. Current body-family metadata alone does not
   provide this execution path. Map checker evidence to the frozen cases.
   Checker collection events do not create new Overkill cases. Shared source
   evidence must retain its ownership when used by several selected cases.
5. Deliver native results, diagnostics, counts, timings, and run records.
   Setup failures fail the run as infrastructure errors; ordinary module
   diagnostics fail compilation. Neither becomes a successful empty check
   or an invented failure of a selected assertion.
   Serialize or isolate checker runs where TSTyche's global event delivery
   would mix concurrent results. Cancellation and cleanup remain explicit.

Case bodies are not invoked by the type checker. Generic bodies, tables, and
macros follow the [Native Assertion Contract](#native-assertion-contract).

### Rejected Approaches And Remaining Work

- Fixture-backed bodies require a second authoring style and can duplicate
  descriptions. They do not satisfy the native authoring requirement.
- Re-exporting or wrapping TSTyche's runtime functions does not teach its
  source recognizer Overkill syntax or recover erased type arguments.
- Claiming transparent equivalence for sibling input is unsupported. Use the
  documented best-effort contract and repair bounded cases instead.
- Private matcher imports or a replacement checker violate the integration
  boundary. Use the existing public runner and structured events.

The native authoring contract is defined above; syntax translation is
demonstrated, not a complete adapter. Package exports and full supported TSTyche
bindings, public adapter hooks, source-anchor instrumentation across composition
layers, generated-input mapping and configuration, diagnostic preservation,
shared-body accounting, and lifecycle validation remain implementation tasks.
Reconsider the generated-input strategy if supported projects cannot accommodate
it reliably. Reconsider the static model if
per-application generic or row-specific type specialization becomes a requirement.
