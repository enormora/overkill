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
