# Package Architecture

## Architectural Rule

Fine-grained packages are the source of truth. `@overkill-dev/test` is the
standard user-facing distribution, but it composes those packages rather than
replacing the ownership model.

This is intentionally closer to the real modularity of Buster and the framework-builder ambition of Folio than to a single monolithic runner with private internals.

## Core

`@overkill-dev/engine` should define the stable contracts for:

- test definitions
- executable test plans
- execution requirements and scheduling constraints
- run sessions
- structured events
- structured results
- reporter adapters
- programmatic integrations

It should not assume one assertion library, one snapshot format, or one benchmark model.

For tiny projects, this layer should already be usable directly. A consumer
can import `createSuite`, `createTestCase`, `createTestPlan`, and `execute`
from `@overkill-dev/engine`, build a suite, freeze it into a `TestPlan`, and
call `execute(testPlan)` to receive a `RunResult` without pulling in the
higher-level DSL. They can also call `runIfMain(import.meta, testNode, options?)`
for a direct Node entrypoint when they do not need discovery or runner
configuration.

Those primitives should also be the only way to create valid engine
`TestNode`s. Shape-compatible plain objects are not enough: engine-branded
node values are required so identity-sensitive features such as orphan
detection and run counts remain exact across first-party and third-party
adapters alike.

The layer split should stay explicit:

- `@overkill-dev/engine` owns execution of an already-resolved plan
- `@overkill-dev/run` owns turning human or programmatic run intent into that
  plan
- `@overkill-dev/test` owns the standard user-facing distribution and ships
  the thin `overkill` binary wrapper

The CLI must not become a privileged control surface. Any meaningful
run-intent flag should also exist as a typed programmatic field on the
semantic owner package. In practice that means:

- CLI flags that shape planning or orchestration map to `@overkill-dev/run`
  request fields
- the public `overkill` binary is packaged by `@overkill-dev/test`, but its
  command semantics are implemented by `@overkill-dev/run`
- engine consumers can still bypass CLI, configuration loading, discovery,
  and `@overkill-dev/run` entirely by constructing a `TestPlan` and calling
  `execute(testPlan)` directly

Recommended public split:

```ts
import { execute, runIfMain } from '@overkill-dev/engine';
import { defineConfig } from '@overkill-dev/test/config';
import { suite, test, testDouble } from '@overkill-dev/test';
import {
    list,
    loadRunConfig,
    mergeResults,
    replay,
    replayWitness,
    resolveRun,
    run,
    watch
} from '@overkill-dev/run';
```

Conceptually:

- `defineConfig(config)` preserves typed project policy without requiring a
  file. Standard users import it from `@overkill-dev/test/config`; custom
  orchestrators may import the same underlying capability from
  `@overkill-dev/run`
- `loadRunConfig(request)` loads project policy from a file when a caller asks
  for that explicitly
- `resolveRun(command)` returns a frozen `ResolvedRun`
- `run(command)` is shorthand for planning plus execution
- `RunCommand` carries explicit run inputs plus configuration and the engine
  selection used to validate imported test nodes
- `execute(testPlan)` is the lower-level engine entrypoint once planning is
  already done, and it returns a `RunResult`
- `runIfMain(import.meta, testNode, options?)` is the lower-level self-running
  entrypoint for one already-authored `TestNode`; it wraps the node in an
  execution root for direct Node runs

## Default Test Authoring

`@overkill-dev/test` should be the single preferred first-party high-level
authoring layer and the standard package most users install. It should favor:

- exported suite values
- direct-file execution through `overkill run path/to/file.test.ts`
  without requiring a mandatory self-run helper in the common case
- flat tests
- explicit grouping only where needed
- test macros as the primary reuse model
- typed test scope
- `scope` as the preferred documentation name for the injected test scope
- async support
- no hook-centric lifecycle model
- a small advanced ergonomics layer for harnesses, interaction recording,
  reusable multi-case macros, and async queue helpers
- explicit facade creation for suite families that need an extended
  helper surface

The root import is the ordinary test-file hot path:

```ts
import { suite, test, testDouble } from '@overkill-dev/test';
```

It should expose authoring helpers plus lightweight doubles:

- `test`
- `suite`
- `table`
- `defineMacro`
- `createTestFacade`
- `runIfMain`
- lightweight doubles APIs and doubles assertion references

It should not expose configuration loading, reporters, resources, benchmark
APIs, baseline APIs, custom assertion builder APIs, or command implementation
APIs. Those belong behind explicit subpaths or leaf packages so ordinary
microtest imports stay small.

Tables or parameterized-case helpers may still exist, but they should be
framed as specialized helpers built on the macro/value model rather than as
a second competing first-party reuse philosophy.

The preferred DX should be:

- a test file exports a conventional value such as `testNode`
- the canonical direct-file command is `overkill run path/to/file.test.ts`
- `runIfMain(import.meta, testNode, options?)` is a fully supported companion path for
  users who want bare `node path/to/file.test.ts`
- bare `node` execution should not be promised to auto-discover a
  conventional exported suite value without that explicit helper unless
  Overkill deliberately adopts a loader or import-hook mechanism, which
  the current concept rejects

When projects need different authoring surfaces for different suite
families, the preferred pattern is a Playwright-style **test facade**:

- `createTestFacade(...)` in project code composes one typed authoring
  surface
- custom assertion vocabulary is normally imported as assertion reference
  values, not registered into that facade
- the project re-exports that facade through a stable alias such as
  `#tests/micro` or `#tests/integration`
- test files import from that stable alias rather than from varying
  relative paths

This keeps types exact without global augmentation, configuration-time typing
magic, or noisy per-assertion local opt-in.

The facade surface itself should stay narrow and settled:

- `createTestFacade(...)` configures authoring ergonomics only; it should
  not own assertion vocabulary registration
- the returned facade re-exports the core authoring helpers:
  `test`, `suite`, `table`, `defineMacro`, and `runIfMain`
- higher-layer helpers such as `property`, `browserBenchmark`, or
  `eslintRuleSuite` should be imported and re-exported alongside the
  facade from the project's stable alias, not injected into
  `createTestFacade(...)`

This keeps facade creation focused on the typed test surface rather than
turning it into a second plugin runtime.

## Assertions

The first-party assertion layer should live in `@overkill-dev/engine`, not in
`@overkill-dev/test`. The concept still needs a clear home for:

- `plan()`-style guarantees
- assertion count tracking
- richer mismatch reporting
- serializer hooks for baseline systems
- built-in assertion vocabulary
- imported assertion references for domain-specific assertion vocabularies
  such as `Result` / `Maybe`

Overkill should not expose a broad “mount any third-party matcher library
into `scope.assert`” surface. The extension boundary should stay narrower:

- `@overkill-dev/engine` owns the assertion model, built-ins, counting rules,
  public low-level `AssertionNode` protocol, injected `scope.assert` /
  `scope.require`, and assertion reference execution
- `@overkill-dev/assert` owns reusable helpers for defining assertion
  extensions, such as composite-assertion builders and foreign-assertion
  bridges
- `@overkill-dev/test` may provide a higher-level authoring facade, but it does
  not own assertion semantics or custom assertion availability
- adapter packages may wrap foreign throwable-style assertion libraries
  through the normalized bridge described in
  [Assertions And Results](../authoring/assertions-and-results.md)

This is the right place for focused adapter packages such as:

- `@overkill-dev/aws-cdk`

That package should bridge `@aws-cdk/assertions` into facade-ready Overkill
assertions without making generic third-party assertion interop part of the
core model.

## Doubles

`@overkill-dev/doubles` should be a separate first-party package rather than an assertion side feature.

It should favor:

- one primary concept such as `testDouble()`
- explicit dependency injection rather than patching object methods or modules
- TypeScript-first function signatures
- call history and result inspection with strong direct instance introspection
- simple behavior configuration for common cases
- rule-based or answer-based behavior for advanced cases
- configuration-object-driven advanced behavior rather than a second fluent API

It should avoid:

- object or module replacement as the design center
- mandatory sandboxes or restore registries
- Sinon-style category sprawl where users must choose between multiple overlapping concepts

The conceptual split is:

- `@overkill-dev/doubles` owns programmable function doubles
- `@overkill-dev/engine` owns built-in assertions and the injected assertion
  context
- `@overkill-dev/assert` owns reusable assertion-extension helpers
- `@overkill-dev/doubles` owns doubles-specific assertion references under
  `doubleUsage`
- `@overkill-dev/test` owns default authoring/facade composition only
- doubles-specific assertions may be contributed by `@overkill-dev/doubles`
  when an engine-backed assertion context explicitly opts into them

This keeps the creation of doubles separate from how tests assert on them.

Related first-party ergonomics above the doubles layer may include:

- generic interaction transcript recording
- harness helpers for dependency-heavy units

## Runtimes

`@overkill-dev/resources` should own:

- typed context composition
- typed resource composition
- runtime matrices
- explicit setup and teardown patterns
- execution-affecting requirements such as isolation, sharing, and lifecycle scope
- reusable runtime factories
- explicit artifact attachment from resources or runtimes
- deterministic service and browser runtime composition

`@overkill-dev/resources` should be generic enough to serve multiple higher-level families:

- `@overkill-dev/test` for ordinary test scope
- `@overkill-dev/bench` for temp dirs, registries, calibration resources, PTYs, and external processes
- browser packages for browser servers, contexts, pages, and device matrices

This package family is the main place for supporting:

- deterministic local service fixtures
- temporary registries and external-process harnesses
- browser-executed test runtimes
- page-object-oriented browser fixtures where an adapter layer chooses that
  shape
- accessibility or compliance helpers that attach artifacts
- runtime scenarios and dimensions

This should not be read as a commitment to build a first-party replacement
for Playwright. The broader browser-automation shapes belong behind browser
adapter/integration packages; the shared resource/runtime layer only needs to
be strong enough to host them cleanly.

Capability-handle or “world” style architecture remains compatible with this
package family, but Overkill should not ship a first-class production-facing
`@overkill-dev/world` package in the current concept because consumer production
code should not need Overkill dependencies.

## Orchestration

`@overkill-dev/run` should own:

- typed command intent and dispatch implementation for the `overkill` binary
- file discovery
- filtering
- seed handling
- runner profiles
- baseline write verbs (`update`, `apply`, `bootstrap`, `diff`)
- process-level orchestration
- worker-pool management
- remote work-unit planning and coordinator-side execution placement
- resolution of execution strategy from package-provided constraints
- supervision policies for isolated workers or subprocesses
- selection and metadata-aware run planning
- watch-mode orchestration where explicit runner behavior is needed beyond raw Node `--watch`

It should also expose the canonical programmatic mirror of CLI run intent.
The `@overkill-dev/test` binary parser maps argv to this API; it is not a
second capability layer.
`@overkill-dev/run` should not declare `bin: overkill`; the binary is shipped
by `@overkill-dev/test` and delegates to `@overkill-dev/run`.

Recommended shape:

```ts
await run({
    config,
    request: {
        baselineUpdateMode: 'none',
        capture: 'buffered',
        coverage: true,
        debug: { mode: 'selected', selectors: [ 'users > round-trip' ] },
        execution: { mode: 'concurrent-in-process' },
        measureResourceUsage: null,
        order: 'seeded',
        paths: [ 'source/**/*.test.ts' ],
        profile: 'microtest',
        resourceBudgetOverrides: null,
        resourceUsageSamplingIntervalMilliseconds: null,
        seed: { value: 42n },
        selection: { kind: 'filter', expression: 'tag=fast' },
        shard: { index: 1, total: 4 },
        verbose: false
    },
    testPlan
});
```

Equivalent programmatic entrypoints should exist for the other major CLI
verbs too:

- `list(request)` - mirror of `overkill list`
- `watch(request)` - mirror of `overkill run --watch`
- `replay(runId, options?)` - mirror of `overkill replay`
- `replayWitness(path, options?)` - mirror of `overkill replay-witness`
- `mergeResults(inputs, options?)` - mirror of the richer merged-results
  workflow
- `baseline.update(request)`, `baseline.apply(request)`,
  `baseline.bootstrap(request)`, `baseline.diff(request)`,
  `baseline.list(request)` - mirrors of the baseline subcommands
- `bench.run(request)`, `bench.list(request)`,
  `bench.baseline.update(request)`, `bench.baseline.apply(request)`,
  `bench.baseline.bootstrap(request)`, `bench.baseline.diff(request)`,
  and `bench.baseline.list(request)` - mirrors of benchmark-specific
  commands

This is also the logical layer for choosing ordinary runner profiles.
Benchmark execution is intentionally not a `run --profile benchmark` alias:
benchmarks use the `overkill bench` namespace because their primary output is
measurement data and policy evaluation, not an ordinary test verdict.

It is also the semantic home for first-party configuration-file loading and
`defineConfig(...)` support. Standard users import the helper through
`@overkill-dev/test/config`.

It should also understand first-class runtime and resource factories as run
inputs, not just file discovery. Higher layers often construct their real
environment through these factories before the case body runs.

Execution strategy should be modeled as resolved planning, not a fixed trait of one package. Different packages may influence:

- maximum concurrency
- preferred worker count
- process vs in-process execution
- file-level or case-level isolation
- runtime sharing boundaries
- serialization requirements for measurement reliability

In all of these modes, discovery stays centralized. The orchestrator
collects tests once, freezes `RunFacts`, and then assigns already-known
plan items to local workers, subprocesses, or remote executors.
Execution boundaries may change; discovery authority does not.

Supervision and termination policy should also be execution-strategy-dependent:

- in-process runs may support leak diagnostics and cooperative timeouts
- supervised disposable microtest runs may support crash-only recovery
- isolated worker or subprocess runs may support hard termination by a supervisor

The engine should not pretend that all timeout behavior is equally enforceable in every execution mode.

## Reporters

Reporter support should be modeled as a package family rather than one catch-all package.

Examples:

- `@overkill-dev/reporter-dot`
- `@overkill-dev/reporter-brief`
- `@overkill-dev/reporter-line`
- `@overkill-dev/reporter-tap`
- `@overkill-dev/reporter-json`
- `@overkill-dev/reporter-html`
- `@overkill-dev/reporter-benchmark-html`
- `@overkill-dev/output-renderer-github-actions`

Multiple reporters should be attachable to one run.

The core should expose the reporter contract; individual reporters should live in separate packages so projects can depend only on what they use.

The current first-party reporter set should be treated as settled:

- `dot` for minimal real-time progress output
- `brief` for sparse managed stdout output suitable for AI-agent and CI logs
- `line` as the default human terminal reporter
- `tap` for TAP-oriented integrations
- `json` as the canonical machine-readable result dump
- `html` as the generic artifact/failure report
- `benchmark-html` as the benchmark-specific final report with
  metric-oriented presentation

The benchmark-specific HTML reporter is justified because benchmark suites
need presentation that generic test reporters do not: workload comparisons,
percentiles, baseline deltas, machine metadata, and plotting-oriented output.
That reporter should therefore remain a separate reporter package rather than
being hidden inside `@overkill-dev/bench`.

Output intent and output renderer types belong in `@overkill-dev/engine`
because reporters return those values through the reporter contract. The
plain renderer ships from `@overkill-dev/engine` and is the `@overkill-dev/run`
default. Platform-specific renderers live in narrow packages when they carry
platform syntax or release cadence. `@overkill-dev/output-renderer-github-actions`
is the first such package; it converts located diagnostics into GitHub
workflow commands without using the Checks API.

There should not be a broad `@overkill-dev/report` or
`@overkill-dev/reporters` package as a semantic owner. Reporter factories can
still be re-exported from the standard distribution for user convenience, but
the leaf packages remain the ownership boundary.

Reporter loading should stay explicit and JS/TS-native:

- configuration imports reporter factories/instances directly
- `@overkill-dev/test/reporters` may re-export built-in reporter factories
  for the standard distribution
- there is no implicit package-name discovery or naming-convention scan for
  third-party reporters
- reporter selection is configuration-only, not a duplicate CLI surface

Reporter compatibility should also be explicit. A reporter may declare that
it only supports certain run families or result capabilities, and
orchestration should reject incompatible configurations before execution
rather than producing a meaningless report.

Lifecycle, sink, delivery, and backpressure semantics live in
[Reporters](./reporters.md). This doc only owns the package-family stance.

## Baselines

`@overkill-dev/baselines` should define the common concepts for:

- locating baseline artifacts
- collecting current output
- comparing against stored expectations
- explicit update workflows
- stale artifact detection

It should support subtype-specific adapters rather than forcing all baselines into plain string equality.

## Metadata, Identity, And Extensions

Cross-cutting concepts such as metadata, stable identity, and extension contracts should be shared across the package family rather than reinvented independently in each layer.

This is especially important for:

- selection and filtering
- artifact naming
- stale-baseline detection
- reproducibility
- configuration-driven attachments such as reporters or baseline adapters

### Extension Surfaces

The most important extension types Overkill should support are:

- reporters
- baseline adapters
- serializer adapters
- custom assertions
- resource and runtime factories
- benchmark metric collectors
- benchmark policy adapters
- orchestration helpers
- browser and workflow integrations

Extensions should compose through stable contracts, not through private
runner patch points. That means:

- reporters consume structured events or finished results
- resource packages contribute explicit runtime or execution constraints
- baselines contribute identity, collection, comparison, and update
  semantics
- benchmark packages contribute workloads, measurements, and policies

Overkill does not need a giant global plugin container to be extensible.
Installing a package does not mutate the `overkill` CLI, widen global
configuration types, or register commands by naming convention. Stable
package-level APIs, stable contracts in `@overkill-dev/engine`, and
orchestration-level composition in `@overkill-dev/run` are enough for many
integration stories without inventing a heavy plugin runtime. See
[Configuration § Configuration Versus Plugins](./configuration.md#configuration-versus-plugins)
for how configuration-driven attachment composes with direct programmatic
registration.

### Third-Party Ecosystem

The same openness should make it straightforward for third parties to
build:

- IDE integrations
- MCP servers
- remote execution coordinators
- type-test adapters
- ESLint rule-test adapters
- mutation-testing adapters
- browser-runtime adapters
- accessibility or compliance fixtures
- interaction-transcript collectors for transports such as HTTP or
  browser requests

## Configuration

Configuration belongs above the engine.

The conceptual split is:

- `@overkill-dev/engine`
  - programmatic options only
- `@overkill-dev/run`
  - optional configuration files, discovery, orchestration defaults
- high-level packages
  - package-specific programmatic registration surfaces

Config should stay low-surface and orchestration-focused. It should be
able to wire in:

- reporters
- baseline adapters
- mutation integrations
- type-test adapters
- browser or benchmark backends

## Integrations

Some integrations are part of the product shape even though they are not
engine features.

The clearest current example is:

- type-test adapters or integrations rather than a built-in type-test engine
- a first-party Stryker integration
- a first-party ESLint rule-testing adapter package rather than baking
  `RuleTester` compatibility into the core authoring layer
- a separate `@overkill-dev/eslint-plugin` for static enforcement of
  Overkill-specific authoring conventions
- an easy-to-enable coverage story based on explicit tooling rather than built-in default behavior
- watch-mode support that reuses Node's built-in behavior where possible
- easy third-party IDE or MCP integration through stable machine-readable APIs
- remote execution as an architectural consideration for browser and
  integration-heavy workloads

What this means conceptually:

- the engine should preserve stable identities, structured results, and machine-readable execution events
- orchestration should make focused test selection and reruns possible
- orchestration should make coverage enablement explicit rather than silently always-on
- the architecture should allow external type-checking engines to participate in selection and reporting
- adapter packages should be able to compile external test-case DSLs into
  ordinary Overkill suites and cases rather than forcing those DSLs into
  the engine or default authoring surface
- static tooling packages should be able to trace Overkill bindings across
  facades, re-exports, and package families rather than only matching one
  hard-coded import form
- Node's built-in watch behavior should be reused instead of reinvented by default
- machine-consumable APIs should be stable enough for editors, MCP servers, and remote workers
- remote workers should consume frozen work units rather than recollecting
  tests independently
- the integration should live above the engine rather than turning mutation testing into a core runner concern

## Benchmarking

`@overkill-dev/bench` should be a distinct package family. It needs its own
subpackages for:

- workload definitions
- measurement engines
- policies and budgets
- calibration
- process and PTY execution
- benchmark reporters

## Builder Layer

Overkill should preserve an explicit builder-oriented layer for higher-level packages. This is where the Folio influence matters most: first-party and third-party packages should be able to assemble specialized test APIs from lower-level execution, runtime, and reporting contracts rather than forking the whole runner.

Conceptually this layer sits above `@overkill-dev/engine` and below finished
user-facing distribution or DSL packages.

The important constraint is that Overkill should not ship multiple
first-party DSLs at the same level. The builder layer exists so third
parties can do that if they want to.

## Package Boundaries Matrix

This is a single-page lookup of which package owns each concept.
Each concept has one canonical package; satellite packages may consume
or extend the contract but do not redefine it.

| Concept                                                           | Canonical package                                                      | Notes                                                                                                                                                          |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Test definitions, suites, cases                                   | `@overkill-dev/engine`                                                 | The `TestNode`/`TestCase`/`Suite` shapes; see [Tests As Values](../authoring/tests-as-values.md).                                                              |
| Standard user-facing distribution                                 | `@overkill-dev/test`                                                   | Normal install package; composes the standard stack without taking over semantic ownership.                                                                    |
| Public `overkill` binary packaging                                | `@overkill-dev/test`                                                   | Thin wrapper that delegates command behavior to `@overkill-dev/run`.                                                                                           |
| `TestOutcome` ADT (engine result protocol)                        | `@overkill-dev/engine`                                                 | `Pass`/`Fail`/`Skip`/`Inconclusive`; see [Assertions And Results § Protocol Layer](../authoring/assertions-and-results.md#protocol-layer-structured-outcomes). |
| Test verdict derivation (crashed, presentation mapping, …)        | `@overkill-dev/run`                                                    | Verdicts derived from `(outcome, metadata, runner-error?)`.                                                                                                    |
| `RunRequest`, `RunFacts`, `ResolvedRun`, and `RunRecord`          | `@overkill-dev/run`                                                    | `RunFacts` shape sketched in [Reproducibility](./reproducibility.md).                                                                                          |
| `TestPlan`                                                        | `@overkill-dev/engine`                                                 | Executable in-process case plan consumed by `execute(testPlan)`.                                                                                               |
| `AssertionNode`, `TestFailure`, `FailedCheck`, `Diff`             | `@overkill-dev/engine`                                                 | Engine owns assertion-node evaluation, failure schema, and the first-party assertion behavior on top.                                                          |
| Injected `assert` / `require` builder API                         | `@overkill-dev/engine`                                                 | The engine owns the injected assertion surface directly.                                                                                                       |
| Assertion reference helpers (`defineCompositeAssertion`, bridges) | `@overkill-dev/assert`                                                 | Reusable helpers create imported assertion reference values consumed by engine-owned facades.                                                                  |
| Test doubles (`testDouble`, `when`, helpers)                      | `@overkill-dev/doubles`                                                | See [Doubles](../authoring/doubles.md).                                                                                                                        |
| Typed runtime / resource composition                              | `@overkill-dev/resources`                                              | Lifecycle scopes, execution requirements.                                                                                                                      |
| Discovery, filtering, runner profiles                             | `@overkill-dev/run`                                                    | Reads configuration, freezes `RunFacts`, and produces `ResolvedRun`.                                                                                           |
| Selection filter grammar                                          | `@overkill-dev/run`                                                    | Specification in [Metadata And Selection](./metadata-and-selection.md).                                                                                        |
| Sharding                                                          | `@overkill-dev/run`                                                    | Stable identity-hash partitioning.                                                                                                                             |
| Reporter event stream contract                                    | `@overkill-dev/engine`                                                 | The `ReporterEvent` ADT.                                                                                                                                       |
| Reporter rendering                                                | `@overkill-dev/reporter-*`                                             | Each presentation choice is its own package.                                                                                                                   |
| Sink declarations and conflict resolution                         | `@overkill-dev/run`                                                    | Computed before workers start.                                                                                                                                 |
| Capability profile model                                          | `@overkill-dev/run`                                                    | Profile names; permission boundary applied at worker spawn.                                                                                                    |
| Capability handle pattern (`AppRuntime`, …)                       | user code / adapter package                                            | No first-party `@overkill-dev/world`; see [Capability Handles](../authoring/capability-handles.md).                                                            |
| Baseline subtypes (snapshot, visual, perf)                        | `@overkill-dev/baselines`                                              | Shared identity and stale detection.                                                                                                                           |
| Baseline verbs (`update`/`apply`/…)                               | `@overkill-dev/run`                                                    | Verbs sit at the runner layer; semantics from `@overkill-dev/baselines`.                                                                                       |
| Benchmark workloads, measurements, policies                       | `@overkill-dev/bench`                                                  | Above the engine; contributes execution requirements.                                                                                                          |
| Coverage instrumentation                                          | `@overkill-dev/run`                                                    | V8 native; microtest-only; opt-in.                                                                                                                             |
| Witness file format                                               | `@overkill-dev/engine`                                                 | Schema in engine; producers/consumers across families.                                                                                                         |
| Failure artifacts (storage + schema)                              | `@overkill-dev/engine` (schema) + `@overkill-dev/run` (storage policy) | Storage layout owned by orchestration.                                                                                                                         |
| Metadata propagation rules                                        | `@overkill-dev/engine`                                                 | Set merge, array replace-flag, capabilities intersect.                                                                                                         |
| Configuration loading                                             | `@overkill-dev/run`                                                    | Reads root `overkill.config.ts`; engine has no configuration.                                                                                                  |
| Standard configuration helper re-export                           | `@overkill-dev/test/config`                                            | User-facing import path for `defineConfig(...)`; custom orchestrators may import from `@overkill-dev/run`.                                                     |
| Test facade creation                                              | project code + `@overkill-dev/test`                                    | `@overkill-dev/test` owns facade creation for authoring ergonomics only.                                                                                       |
| Root test authoring import                                        | `@overkill-dev/test`                                                   | `test`, `suite`, `table`, `defineMacro`, `createTestFacade`, `runIfMain`, and lightweight doubles only.                                                        |
| Assertion reference execution                                     | `@overkill-dev/engine`                                                 | Engine owns callable assertion references, counting, `require` behavior, and result normalization.                                                             |
| CLI command semantics, terminal capability detection              | `@overkill-dev/run`                                                    | Parses and dispatches command intent behind the `@overkill-dev/test` binary wrapper.                                                                           |
| Test debug mode artifact                                          | `@overkill-dev/run`                                                    | Activation, storage, retention; see [Test Debug Mode](../authoring/debug-mode.md).                                                                             |
| Reporter packages (`@overkill-dev/reporter-line`, …)              | `@overkill-dev/reporter-*`                                             | Stable contract from `@overkill-dev/engine`; presentation owned per-package.                                                                                   |

## Standard Distribution

Most users should install one package:

```text
npm install -D @overkill-dev/test
```

That package is the standard distribution. It should depend directly on the
standard stack so users do not need to align package versions by hand:

- `@overkill-dev/engine`
- `@overkill-dev/run`
- `@overkill-dev/assert`
- `@overkill-dev/doubles`
- `@overkill-dev/resources`
- `@overkill-dev/baselines`
- `@overkill-dev/bench`
- standard first-party reporters
- explicit microtest coverage support

The standard distribution should not hide real package boundaries. Leaf
packages remain documented for advanced direct use, custom orchestrators, and
third-party integration authors.

### Public Entry Points

The root import is for ordinary test files:

```ts
import { suite, test, testDouble } from '@overkill-dev/test';
```

Everything outside the authoring hot path uses an explicit subpath:

```ts
import { defineConfig } from '@overkill-dev/test/config';
import { lineReporter } from '@overkill-dev/test/reporters';
import { benchmark, workload } from '@overkill-dev/test/bench';
import { defineCompositeAssertion } from '@overkill-dev/test/assert';
```

Subpaths may re-export standard-stack packages for user ergonomics. They do
not transfer semantic ownership away from those packages.

### Load Boundaries

Installed package set is not the loaded module graph.

The protected hot paths are:

- root import from `@overkill-dev/test`
- single-process microtest execution

The root import may load only the default authoring APIs, minimal engine
construction code, and lightweight doubles. It must not load
`@overkill-dev/run`, argv parsing, configuration loading, reporters,
resources, baselines, benchmark measurement code, coverage tooling, browser
support, or optional adapters.

The `overkill` binary should use command-selected modules: a tiny fixed argv
parser resolves the command name and `--config`, then delegates to the matching
method on the fixed `commandLineRunner` namespace exposed by
`@overkill-dev/run/command-line`. Config loading and ordinary run orchestration
are common command-line infrastructure; benchmark, baseline, coverage, and
reporter-heavy modules stay behind selected command or reporter boundaries.
There is no package scanning, generated command registry, or dynamic command
extension in the current concept.

### Optional Packages

Optional packages stay separate installs when they are domain-specific,
heavyweight, or aimed at a narrower audience. Examples:

- browser and browser-benchmark packages
- property, model, differential, and linearizability packages
- type-test adapters
- mutation integrations
- ESLint, AWS CDK, contract, accessibility, and similar domain adapters

Optional packages integrate through explicit imports: typed profiles,
runtime/resource factories, reporters, baseline adapters, and authoring
helpers. They do not mutate the CLI by being installed, and they do not widen
top-level configuration through module augmentation in the current concept.
