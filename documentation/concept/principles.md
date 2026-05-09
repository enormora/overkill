# Principles

## API-First

The stable center of Overkill is the programmatic API, not the CLI. A user should be able to build custom runners, IDE integrations, mutation tools, browser adapters, or benchmark harnesses without scraping terminal output or relying on private internals.

## TypeScript-First

Overkill is optimized for TypeScript rather than trying to be equally ideal for every JS runtime and authoring style. Types are part of the product experience, especially for runtimes, reporters, and extension APIs.

## No Magic

“No magic” means:

-   no hidden module interception as the default design center
-   no silent global API injection as the preferred usage
-   no fixture discovery by name lookup
-   no opaque process model choices
-   no automatic snapshot or baseline rewrites during ordinary runs

It does not mean “no convenience.” It means convenience must be explainable from the public API.

## Explicit Over Implicit

If a test depends on a runtime, a capability, or a baseline artifact, that dependency should be visible in the code or runner configuration. Overkill prefers one more explicit line over a surprising hidden behavior.

## Data Over Side Effects

Overkill prefers values to side effects in its primary contracts. Tests are returned data, not invoked via global registration. Outcomes are structured results, not thrown exceptions. Metadata is explicit on the test value, not stashed in ambient state.

That posture leads to:

-   tests that can be inspected, filtered, and composed before execution
-   reporters that consume events instead of parsing prose
-   identity and discovery that work without running anything
-   tooling (IDEs, MCP servers, mutation testers) that can introspect the suite without owning execution

The principle does not forbid side effects — the runner has to actually run things. It says the _contracts_ between layers are values, and side-effecting glue lives at the edges where it is needed.

## One First-Party Path Per Layer

Overkill should not offer multiple first-party ways to solve the same
problem at the same architectural layer.

This does **not** mean every layer has only one API surface. It means:

-   the engine may expose low-level building blocks
-   a higher layer may expose one opinionated first-party authoring model on
    top
-   a third layer may expose orchestration or CLI conveniences

But at any one layer, Overkill should choose one first-party answer instead
of shipping several overlapping styles and making users arbitrate between
them.

Examples:

-   one primary first-party high-level test DSL
-   one primary first-party reuse model
-   one primary first-party doubles model

If an alternative is worth supporting, it should usually either:

-   live at a lower layer as a primitive
-   be treated as explicit sugar over the same model
-   or be left open for third parties

The same principle applies to user inputs. Each setting has one canonical
place to live:

-   persistent project policy lives in the config file
-   per-run intent lives on the CLI (for example `--coverage`,
    `--watch`, `--filter`)
-   no setting is reachable from both surfaces

This avoids precedence bugs, duplicated documentation, and the ambient
"did I set this here or there?" confusion.

## Low API Surface

Overkill should keep the visible first-party API surface small.

This is not the same as keeping the implementation simple. The internal
architecture can stay layered and powerful while the user-facing surface
stays narrow.

That means:

-   common paths should use a small number of obvious entrypoints
-   advanced mechanics should stay opt-in and documented as advanced
-   first-party packages should resist adding a second noun when one
    concept can cover the job
-   helper APIs should earn their place by removing repeated choreography
    across real tests, not by making every local pattern framework-shaped

The documentation strategy should reinforce this principle: show the common
path first, keep advanced topics discoverable, and avoid presenting the full
surface as mandatory knowledge for new users.

## Opinionated First Party, Open Ecosystem

Overkill should be opinionated in its own first-party packages while still
staying open for third parties to build different approaches on the same
core contracts.

That means:

-   first-party packages pick one preferred model
-   the engine and integration contracts stay open enough for others to build
    different DSLs, reporters, assertion styles, or authoring systems
-   Overkill should not block experimentation just because it declines to
    bless multiple first-party solutions itself

## Keep Production Code Clean

Consumer production code should not need to import Overkill packages.

At least for now, Overkill should stay on the testing side of the boundary:

-   test authoring
-   orchestration
-   assertions
-   doubles
-   reporters
-   integrations

Overkill may encourage certain production-code patterns, but it should not
become a required runtime dependency of consumer application code just to make
that code testable.

## Do Not Normalize Bad Patterns

Overkill should avoid encouraging:

-   module mocking as a primary testing technique
-   shared mutable setup hidden in hooks
-   order-dependent tests
-   accidental I/O in microtests
-   benchmark numbers without policy semantics
-   giant unreviewed snapshot blobs

## The Suite Is A Contract

A test suite earns its value by standing as a verdict on safety. The
moment red tests are tolerated, retried, parked, or excused, the suite
stops being a contract and becomes noise.

Overkill therefore rejects mechanisms that signal "red tests are
acceptable":

-   no quarantine workflow that lets a known-flaky test fail without
    gating
-   no flaky-test retry as a microtest mode — a flaky microtest is a
    design failure, not an expected state
-   no `allowEmpty` escape hatch — a test that asserts nothing is
    broken, and an opt-out hides defects

The shape is the same in each case: there is no "exit ramp" from the
contract. A test that cannot give a single honest verdict is fixed or
deleted, not parked.

## Small Core, Strong Edges

The core should own only the abstractions that truly need to be shared:

-   test definitions
-   execution plans
-   run events
-   results
-   reporter and integration contracts

Assertions, runtimes, snapshots, benchmarks, and bundles can be first-party without being core primitives unless research shows they cannot be built cleanly on top.

## Platform First

Overkill should prefer platform capabilities before third-party dependencies whenever the platform is good enough.

That means looking first at:

-   Node.js built-ins
-   Web Platform APIs
-   modern ECMAScript features

Third-party libraries should only win when they provide a real capability gap, a significantly better abstraction, or materially better portability.

This is not only a dependency rule. It is also an architectural rule.

Where it makes sense, platform primitives should shape Overkill’s own public abstractions:

-   cancellation should lean on `AbortController` and `AbortSignal`
-   request-like or response-like flows should lean on Fetch primitives
-   resource lifetime should lean on `Symbol.dispose`, `Symbol.asyncDispose`, and `using`
-   timing and measurement should lean on `perf_hooks` and Web Performance concepts
-   async execution context should consider `AsyncLocalStorage`

This is partly a maintenance choice and partly a design choice: reusing platform primitives keeps APIs more understandable, more portable, and less framework-specific.

## Cold Start Is The Budget

The optimization target for the default run mode is cold start, not warm steady-state. A user typing `node ./foo.test.ts` (or `overkill`) should see results in sub-second time without a daemon, a long-lived worker pool, or a bundler step.

Concrete consequences:

-   Node built-ins are preferred over loader hooks or custom transforms
-   the runner core targets V8 startup-snapshot reuse
-   plugin imports stay lazy; common paths avoid module-graph scans
-   warm-only optimizations (bytecode cache, strip cache) are accepted only when they do not penalize the cold path

Warm-mode optimizations may exist but never _replace_ a fast cold start as the primary target.

## Capability-Oriented Microtests

Microtests are defined not only by size but by capability boundaries. In the first-party concept, a microtest should run with restricted permissions by default. That keeps the category meaningful.

## Different Test Kinds Need Different Models

Overkill should not flatten microtests, browser tests, snapshots, and benchmarks into one undifferentiated API. Reuse shared contracts where possible, but let higher layers specialize where necessary.

## Reviewable Artifacts

Any generated artifact that affects correctness or policy should be reviewable:

-   snapshots
-   visual baselines
-   performance budgets
-   machine-readable reports

If it changes behavior, it should be diffable.
