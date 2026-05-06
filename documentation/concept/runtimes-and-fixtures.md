# Runtimes And Fixtures

## Goal

Overkill needs a fixture and runtime model powerful enough for integration work but explicit enough to avoid pytest-style magic.

It also needs to be generic enough to work across multiple product families rather than being tied to one DSL or one runner mode.

## Desired Shape

The main first-party direction is a typed context object that is built compositionally.

Properties:

-   explicit in the test signature
-   type-safe
-   reusable across test families
-   able to represent matrices of runtimes
-   not dependent on hidden global lookup by name

`@overkill/resources` should be understood as a resource and context composition layer, not merely a fixture helper for `@overkill/test`.

That means it should be able to model:

-   ordinary test context
-   shared or isolated resources
-   per-run, per-file, per-suite, or per-case lifecycle scopes
-   runtime matrices
-   execution requirements that affect scheduling or isolation

The concrete shapes this must cover include:

-   deterministic local services that yield a base URL and scenario metadata
-   temporary registries or other external-process fixtures
-   browser pages plus page-object wrappers
-   browser-side compliance or accessibility helpers
-   fixture-owned validation or cleanup after the test body returns

## Why This Over Hooks

Hooks tend to hide:

-   ordering assumptions
-   local mutable state
-   fixture lifetime
-   cleanup responsibility

Runtime composition is clearer when setup is attached to an explicit runtime factory or wrapper rather than ambient lifecycle callbacks.

This matters even more if the same runtime system must support benchmarks, browser tests, and integration workflows.

The important pattern is not “before/after hooks”. It is:

-   create a runtime
-   yield a typed handle
-   let the runtime own teardown and optional post-test validation

## Influence

Playwright proves that lazy, composable fixtures scale. Overkill should borrow the composability, but prefer a clearer dependency surface than special injected parameter names.

Source:

-   <https://playwright.dev/docs/test-fixtures>

## Runtime Matrices

The concept should support running one test suite against multiple runtimes:

-   browser variants
-   OS or runtime variants
-   local vs remote service targets
-   configuration profiles

This belongs in first-party runtime packages, not in the core execution contract.

Typical dimensions include:

-   browser name
-   resolution
-   mobile emulation
-   deterministic scenario
-   client bundle type
-   legacy vs modern mode

## Execution Requirements

Runtimes should be able to contribute execution requirements without owning the final scheduling decision.

Examples:

-   a runtime may require exclusive access to a shared resource
-   a benchmark runtime may request single-worker execution
-   a browser runtime may request process or worker isolation
-   a local integration runtime may allow shared setup across many cases

Those requirements should flow into orchestration, where they are resolved together with the needs of the test family and runner profile.

## Higher-Layer Takeaway

The higher test layers reinforce a simple design rule:

-   microtests want cheap, local case context
-   integration and browser tests want typed runtime factories with owned
    lifecycle

Overkill should therefore scale upward by composing richer runtimes, not by
adding more hooks or magical globals.
