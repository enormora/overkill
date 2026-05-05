# Principles

## API-First

The stable center of Overkill is the programmatic API, not the CLI. A user should be able to build custom runners, IDE integrations, mutation tools, browser adapters, or benchmark harnesses without scraping terminal output or relying on private internals.

## TypeScript-First

Overkill is optimized for TypeScript rather than trying to be equally ideal for every JS runtime and authoring style. Types are part of the product experience, especially for environments, reporters, and extension APIs.

## No Magic

“No magic” means:

-   no hidden module interception as the default design center
-   no silent global API injection as the preferred usage
-   no fixture discovery by name lookup
-   no opaque process model choices
-   no automatic snapshot or baseline rewrites during ordinary runs

It does not mean “no convenience.” It means convenience must be explainable from the public API.

## Explicit Over Implicit

If a test depends on an environment, a capability, or a baseline artifact, that dependency should be visible in the code or runner configuration. Overkill prefers one more explicit line over a surprising hidden behavior.

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

Assertions, environments, snapshots, benchmarks, and bundles can be first-party without being core primitives unless research shows they cannot be built cleanly on top.

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
