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

## Why This Over Hooks

Hooks tend to hide:

-   ordering assumptions
-   local mutable state
-   fixture lifetime
-   cleanup responsibility

Runtime composition is clearer when setup is attached to an explicit runtime factory or wrapper rather than ambient lifecycle callbacks.

This matters even more if the same runtime system must support benchmarks, browser tests, and integration workflows.

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

## Execution Requirements

Runtimes should be able to contribute execution requirements without owning the final scheduling decision.

Examples:

-   a runtime may require exclusive access to a shared resource
-   a benchmark runtime may request single-worker execution
-   a browser runtime may request process or worker isolation
-   a local integration runtime may allow shared setup across many cases

Those requirements should flow into orchestration, where they are resolved together with the needs of the test family and runner profile.
