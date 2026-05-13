# Package Architecture

## Architectural Rule

Fine-grained packages are the source of truth. Bundles may exist, but they should compose packages rather than replace the model.

This is intentionally closer to the real modularity of Buster and the framework-builder ambition of Folio than to a single monolithic runner with private internals.

## Core

`@overkill/engine` should define the stable contracts for:

-   test definitions
-   execution plans
-   execution requirements and scheduling constraints
-   run sessions
-   structured events
-   structured results
-   reporter adapters
-   programmatic integrations

It should not assume one assertion library, one snapshot format, or one benchmark model.

For tiny projects, this layer should already be usable directly. A single
file should be able to build tests with engine-level primitives such as
`createSuite(...)`, `createTestCase(...)`, and a direct `run(...)` call
without pulling in the higher-level DSL.

## Default Test Authoring

`@overkill/test` should be the single preferred first-party high-level
authoring layer. It should favor:

-   exported suite values
-   direct-file execution through `overkill run path/to/file.test.ts`
    without requiring a mandatory self-run helper in the common case
-   flat tests
-   explicit grouping only where needed
-   test macros as the primary reuse model
-   typed context
-   `case` as the preferred documentation name for the injected test context
-   async support
-   no hook-centric lifecycle model
-   a small advanced ergonomics layer for harnesses, interaction recording,
    reusable multi-case macros, and async queue helpers

Tables or parameterized-case helpers may still exist, but they should be
framed as specialized helpers built on the macro/value model rather than as
a second competing first-party reuse philosophy.

The preferred DX should be:

-   a test file exports a conventional value such as `spec`
-   the canonical direct-file command is `overkill run path/to/file.test.ts`
-   an explicit helper such as `runIfMain(import.meta, spec)` may still exist
    for users who specifically want bare `node path/to/file.test.ts`
-   bare `node` execution should not be promised as the default first-party
    path unless Overkill deliberately adopts a loader or import-hook
    mechanism, which the current concept rejects

## Assertions

The first-party assertion layer should live in `@overkill/test`, with the
low-level normalization protocol treated as internal rather than as a
separate user-facing package. The concept still needs a clear home for:

-   `plan()`-style guarantees
-   assertion count tracking
-   richer mismatch reporting
-   serializer hooks for baseline systems
-   custom assertion registration for domain-specific assertion vocabularies
    such as `Result` / `Maybe`

## Doubles

`@overkill/doubles` should be a separate first-party package rather than an assertion side feature.

It should favor:

-   one primary concept such as `testDouble()`
-   explicit dependency injection rather than patching object methods or modules
-   TypeScript-first function signatures
-   call history and result inspection with strong direct instance introspection
-   simple behavior configuration for common cases
-   rule-based or answer-based behavior for advanced cases
-   config-object-driven advanced behavior rather than a second fluent API

It should avoid:

-   object or module replacement as the design center
-   mandatory sandboxes or restore registries
-   Sinon-style category sprawl where users must choose between multiple overlapping concepts

The conceptual split is:

-   `@overkill/doubles` owns programmable function doubles
-   `@overkill/test` owns assertions over recorded calls, results, and expectations

This keeps the creation of doubles separate from how tests assert on them.

Related first-party ergonomics above the doubles layer may include:

-   generic interaction transcript recording
-   harness helpers for dependency-heavy units

## Runtimes

`@overkill/resources` should own:

-   typed context composition
-   typed resource composition
-   runtime matrices
-   explicit setup and teardown patterns
-   execution-affecting requirements such as isolation, sharing, and lifecycle scope
-   reusable runtime factories
-   explicit artifact attachment from resources or runtimes
-   deterministic service and browser runtime composition

`@overkill/resources` should be generic enough to serve multiple higher-level families:

-   `@overkill/test` for ordinary test context
-   `@overkill/bench` for temp dirs, registries, calibration resources, PTYs, and external processes
-   future browser packages for browser servers, contexts, pages, and device matrices

This package family is the main place for supporting:

-   deterministic local service fixtures
-   temporary registries and external-process harnesses
-   browser-executed test runtimes
-   page-object-oriented browser fixtures where an adapter layer chooses that
    shape
-   accessibility or compliance helpers that attach artifacts
-   runtime scenarios and dimensions

This should not be read as a commitment to build a first-party replacement
for Playwright. The broader browser-automation shapes belong behind browser
adapter/integration packages; the shared resource/runtime layer only needs to
be strong enough to host them cleanly.

Capability-handle or “world” style architecture remains compatible with this
package family, but Overkill should not ship a first-class production-facing
`@overkill/world` package in the current concept because consumer production
code should not need Overkill dependencies.

## Orchestration

`@overkill/run` should own:

-   file discovery
-   filtering
-   seed handling
-   runner profiles
-   baseline write verbs (`update`, `apply`, `bootstrap`, `diff`)
-   process-level orchestration
-   worker-pool management
-   remote work-unit planning and coordinator-side execution placement
-   resolution of execution strategy from package-provided constraints
-   supervision policies for isolated workers or subprocesses
-   selection and metadata-aware run planning
-   watch-mode orchestration where explicit runner behavior is needed beyond raw Node `--watch`

This is also the logical layer for choosing microtest vs integration vs benchmark profiles.

It is also the home for first-party configuration-file loading and
`defineConfig(...)` support.

It should also understand first-class runtime and resource factories as run
inputs, not just file discovery. Higher layers often construct their real
environment through these factories before the case body runs.

Execution strategy should be modeled as resolved planning, not a fixed trait of one package. Different packages may influence:

-   maximum concurrency
-   preferred worker count
-   process vs in-process execution
-   file-level or case-level isolation
-   runtime sharing boundaries
-   serialization requirements for measurement reliability

In all of these modes, discovery stays centralized. The orchestrator
collects tests once, freezes a `RunPlan`, and then assigns already-known
plan items to local workers, subprocesses, or future remote executors.
Execution boundaries may change; discovery authority does not.

Supervision and termination policy should also be execution-strategy-dependent:

-   in-process runs may support leak diagnostics and cooperative timeouts
-   supervised disposable microtest runs may support crash-only recovery
-   isolated worker or subprocess runs may support hard termination by a supervisor

The engine should not pretend that all timeout behavior is equally enforceable in every execution mode.

## Reporters

Reporter support should be modeled as a package family rather than one catch-all package.

Examples:

-   `@overkill/reporter-dot`
-   `@overkill/reporter-line`
-   `@overkill/reporter-tap`
-   `@overkill/reporter-json`
-   `@overkill/reporter-html`
-   `@overkill/reporter-benchmark-html`

Multiple reporters should be attachable to one run.

The core should expose the reporter contract; individual reporters should live in separate packages so projects can depend only on what they use.

The reporter contract should preserve enough structured detail that different reporters can make different presentation choices for the same failure or error.

The current first-party reporter set should be treated as settled:

-   `dot` for minimal real-time progress output
-   `line` as the default human terminal reporter
-   `tap` for TAP-oriented integrations
-   `json` as the canonical machine-readable result dump
-   `html` as the generic artifact/failure report
-   `benchmark-html` as the benchmark-specific final report with
    metric-oriented presentation

The benchmark-specific HTML reporter is justified because benchmark suites
need presentation that generic test reporters do not: workload comparisons,
percentiles, baseline deltas, machine metadata, and plotting-oriented output.
That reporter should therefore remain a separate reporter package rather than
being hidden inside `@overkill/bench`.

Reporter loading should stay explicit and JS/TS-native:

-   config imports reporter factories/instances directly
-   first-party bundle packages may re-export built-in reporter factories
-   there is no implicit package-name discovery or naming-convention scan for
    third-party reporters
-   reporter selection is config-only, not a duplicate CLI surface

Reporter compatibility should also be explicit. A reporter may declare that
it only supports certain run families or result capabilities, and
orchestration should reject incompatible configurations before execution
rather than producing a meaningless report.

The reporter contract should preserve two reporter lifecycles:

-   real-time reporters that receive start, progress, and done events
-   final-result reporters that only receive the finished result

This split already exists in the current source tree and should remain part of the concept because it maps cleanly to terminal reporters versus artifact-producing reporters such as HTML reports.

The orchestration layer should also understand reporter sinks. At the concept level it should be able to detect or mediate obvious conflicts such as multiple reporters trying to write competing human-facing output to stdout.

## Baselines

`@overkill/baselines` should define the common concepts for:

-   locating baseline artifacts
-   collecting current output
-   comparing against stored expectations
-   explicit update workflows
-   stale artifact detection

It should support subtype-specific adapters rather than forcing all baselines into plain string equality.

## Metadata, Identity, And Extensions

Cross-cutting concepts such as metadata, stable identity, and extension contracts should be shared across the package family rather than reinvented independently in each layer.

This is especially important for:

-   selection and filtering
-   artifact naming
-   stale-baseline detection
-   reproducibility
-   config-driven extensions such as reporters or baseline adapters

### Extension Surfaces

The most important extension types Overkill should support are:

-   reporters
-   baseline adapters
-   serializer adapters
-   custom assertions
-   resource and runtime factories
-   benchmark metric collectors
-   benchmark policy adapters
-   orchestration helpers
-   future browser and workflow integrations

Extensions should compose through stable contracts, not through private
runner patch points. That means:

-   reporters consume structured events or finished results
-   resource packages contribute explicit runtime or execution constraints
-   baselines contribute identity, collection, comparison, and update
    semantics
-   benchmark packages contribute workloads, measurements, and policies

Overkill does not need a giant global plugin container to be extensible.
Stable package-level APIs, stable contracts in `@overkill/engine`, and
orchestration-level composition in `@overkill/run` are enough for many
extension stories without inventing a heavy plugin runtime. See
[Configuration § Configuration Versus Plugins](./configuration.md#configuration-versus-plugins)
for how config-driven attachment composes with direct programmatic
registration.

### Third-Party Ecosystem

The same openness should make it straightforward for third parties to
build:

-   IDE integrations
-   MCP servers
-   remote execution coordinators
-   type-test adapters
-   mutation-testing adapters
-   browser-runtime adapters
-   accessibility or compliance fixtures
-   interaction-transcript collectors for transports such as HTTP or
    browser requests

## Configuration

Configuration belongs above the engine.

The conceptual split is:

-   `@overkill/engine`
    -   programmatic options only
-   `@overkill/run`
    -   optional config files, discovery, orchestration defaults
-   high-level packages
    -   package-specific programmatic registration surfaces

Config should stay low-surface and orchestration-focused. It should be
able to wire in:

-   reporters
-   baseline adapters
-   custom assertions
-   mutation integrations
-   type-test adapters
-   browser or benchmark backends

## Planned Integrations

Some integrations are not optional future ideas. They should shape the architecture from the start even if they are not engine features.

The clearest current example is:

-   type-test adapters or integrations rather than a built-in type-test engine
-   a first-party Stryker integration
-   an easy-to-enable coverage story based on explicit tooling rather than built-in default behavior
-   watch-mode support that reuses Node's built-in behavior where possible
-   easy third-party IDE or MCP integration through stable machine-readable APIs
-   remote execution as an architectural consideration for future browser and integration-heavy workloads

What this means conceptually:

-   the engine should preserve stable identities, structured results, and machine-readable execution events
-   orchestration should make focused test selection and reruns possible
-   orchestration should make coverage enablement explicit rather than silently always-on
-   the architecture should allow external type-checking engines to participate in selection and reporting
-   Node's built-in watch behavior should be reused instead of reinvented by default
-   machine-consumable APIs should be stable enough for editors, MCP servers, and remote workers
-   remote workers should consume frozen work units rather than recollecting
    tests independently
-   the integration should live above the engine rather than turning mutation testing into a core runner concern

## Benchmarking

`@overkill/bench` should be a distinct package family. It likely needs its own subpackages for:

-   workload definitions
-   measurement engines
-   policies and budgets
-   calibration
-   process and PTY execution
-   benchmark reporters

## Builder Layer

Overkill should preserve an explicit builder-oriented layer for higher-level packages. This is where the Folio influence matters most: first-party and third-party packages should be able to assemble specialized test APIs from lower-level execution, runtime, and reporting contracts rather than forking the whole runner.

Conceptually this layer sits above `@overkill/engine` and below finished
user-facing bundles or DSL packages.

The important constraint is that Overkill should not ship multiple
first-party DSLs at the same level. The builder layer exists so third
parties can do that if they want to.

## Package Boundaries Matrix

This is a single-page lookup of which package owns each concept.
Each concept has one canonical package; satellite packages may consume
or extend the contract but do not redefine it.

| Concept                                          | Canonical package                                              | Notes                                                                                                                                                                                                         |
| ------------------------------------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Test definitions, suites, cases                  | `@overkill/engine`                                             | The `TestNode`/`TestCase`/`Suite` shapes; see [Tests As Values](../authoring/tests-as-values.md).                                                                                                             |
| `TestOutcome` ADT (engine result protocol)       | `@overkill/engine`                                             | `Pass`/`Fail`/`Skip`/`Inconclusive`; see [Assertions And Results § Protocol Layer](../authoring/assertions-and-results.md#protocol-layer-structured-outcomes).                                                |
| Test verdict derivation (xfail, crashed, …)      | `@overkill/run`                                                | Verdicts derived from `(outcome, metadata, runner-error?)`.                                                                                                                                                   |
| `RunPlan` and `RunRecord`                        | `@overkill/run`                                                | `RunPlan` shape sketched in [Reproducibility](./reproducibility.md).                                                                                                                                          |
| `FailedCheck`, `Diff`, internal assertion protocol | `@overkill/engine` (schema) + `@overkill/test` (authoring)   | Internal normalization protocol plus public injected assertion surface.                                                                                                                                       |
| Injected `assert` / `require` builder API        | `@overkill/test`                                               | Public first-party assertion surface.                                                                                                                                                                         |
| Test doubles (`testDouble`, `when`, helpers)     | `@overkill/doubles`                                            | See [Doubles](../authoring/doubles.md).                                                                                                                                                                       |
| Typed runtime / resource composition             | `@overkill/resources`                                          | Lifecycle scopes, execution requirements.                                                                                                                                                                     |
| Discovery, filtering, runner profiles            | `@overkill/run`                                                | Reads config, freezes `RunPlan`.                                                                                                                                                                              |
| Selection filter grammar                         | `@overkill/run`                                                | Spec in [Metadata And Selection](./metadata-and-selection.md).                                                                                                                                                |
| Sharding                                         | `@overkill/run`                                                | Stable identity-hash partitioning.                                                                                                                                                                            |
| Reporter event stream contract                   | `@overkill/engine`                                             | The `ReporterEvent` ADT.                                                                                                                                                                                      |
| Reporter rendering                               | `@overkill/reporter-*`                                         | Each presentation choice is its own package.                                                                                                                                                                  |
| Sink declarations and conflict resolution        | `@overkill/run`                                                | Computed before workers start.                                                                                                                                                                                |
| Capability profile model                         | `@overkill/run`                                                | Profile names; permission boundary applied at worker spawn.                                                                                                                                                   |
| Capability handle pattern (`AppRuntime`, …)      | user code / adapter package                                    | No first-party `@overkill/world`; see [Capability Handles](../authoring/capability-handles.md).                                                                                                               |
| Baseline subtypes (snapshot, visual, perf)       | `@overkill/baselines`                                          | Shared identity and stale detection.                                                                                                                                                                          |
| Baseline verbs (`update`/`apply`/…)              | `@overkill/run`                                                | Verbs sit at the runner layer; semantics from `@overkill/baselines`.                                                                                                                                          |
| Benchmark workloads, measurements, policies      | `@overkill/bench`                                              | Above the engine; contributes execution requirements.                                                                                                                                                         |
| Coverage instrumentation                         | `@overkill/run`                                                | V8 native; microtest-only; opt-in.                                                                                                                                                                            |
| Witness file format                              | `@overkill/engine`                                             | Schema in engine; producers/consumers across families.                                                                                                                                                        |
| Failure artifacts (storage + schema)             | `@overkill/engine` (schema) + `@overkill/run` (storage policy) | Storage layout owned by orchestration.                                                                                                                                                                        |
| Metadata propagation rules                       | `@overkill/engine`                                             | Set merge, array replace-flag, capabilities intersect.                                                                                                                                                        |
| Configuration loading                            | `@overkill/run`                                                | Reads root `overkill.config.ts`; engine has no config.                                                                                                                                                        |
| Custom assertion registration                    | `@overkill/run` (config) + `@overkill/test` (impl)            | One canonical config-use case for the assertion layer; registration rejects name collisions with built-ins or other custom assertions.                                                                        |
| CLI entry, terminal capability detection         | `@overkill/run` (today)                                        | Possible future extraction to `@overkill/cli`; see [CLI Reference](../reference/cli.md) and [Ideas And Future Directions § CLI Package](../decisions/ideas-and-future-directions.md#cli-package-overkillcli). |
| Test debug mode artifact                         | `@overkill/run`                                                | Activation, storage, retention; see [Test Debug Mode](../authoring/debug-mode.md).                                                                                                                            |
| Reporter packages (`@overkill/reporter-line`, …) | `@overkill/reporter-*`                                         | Stable contract from `@overkill/engine`; presentation owned per-package.                                                                                                                                      |

## Bundles

Some projects will want several Overkill features together and should not
have to manually assemble every package before getting productive. Bundles
are the answer to that convenience need.

### Rule

Bundles are a distribution convenience. Fine-grained packages remain the
architectural truth. That means:

-   docs describe packages first
-   bundles are documented as curated entrypoints
-   a user can always drop down to explicit composition

### Candidate Bundle Shapes

Bundle examples that conceptually make sense:

-   `@overkill/micro`: engine + test + assert + selected reporters +
    microtest profile helpers. For projects that mainly want pure,
    capability-restricted microtests.
-   `@overkill/default`: engine + test + assert + resources + selected
    reporters + run + baselines. For teams that want one standard Overkill
    setup.
-   `@overkill/integration`: default bundle plus integration-oriented
    baseline and process features. For broader system and workflow
    testing.
-   `@overkill/all`: convenience meta-package for adoption or evaluation.

### Risks

Bundles must not:

-   hide the real package boundaries
-   force every user into an all-in-one framework mentality
-   become the only documented experience
-   make versioning strategy impossible to reason about

### Concept Direction

The docs should preserve both:

-   expert-friendly explicit composition
-   team-friendly curated bundles

Bundles should never be the only documented entrypoint.
