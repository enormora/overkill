# Environments And Fixtures

## Goal

Overkill needs a fixture and environment model powerful enough for integration work but explicit enough to avoid pytest-style magic.

It also needs to be generic enough to work across multiple product families rather than being tied to one DSL or one runner mode.

## Desired Shape

The main first-party direction is a typed context object that is built compositionally.

Properties:

-   explicit in the test signature
-   type-safe
-   reusable across test families
-   able to represent matrices of environments
-   not dependent on hidden global lookup by name

`@overkill/resources` should be understood as a resource and context composition layer, not merely a fixture helper for `@overkill/test`.

That means it should be able to model:

-   ordinary test context
-   shared or isolated resources
-   per-run, per-file, per-suite, or per-case lifecycle scopes
-   environment matrices
-   execution requirements that affect scheduling or isolation

## Why This Over Hooks

Hooks tend to hide:

-   ordering assumptions
-   local mutable state
-   fixture lifetime
-   cleanup responsibility

Environment composition is clearer when setup is attached to an explicit environment factory or wrapper rather than ambient lifecycle callbacks.

This matters even more if the same environment system must support benchmarks, browser tests, and integration workflows.

## Influence

Playwright proves that lazy, composable fixtures scale. Overkill should borrow the composability, but prefer a clearer dependency surface than special injected parameter names.

Source:

-   <https://playwright.dev/docs/test-fixtures>

## Environment Matrices

The concept should support running one test suite against multiple environments:

-   browser variants
-   OS or runtime variants
-   local vs remote service targets
-   configuration profiles

This belongs in first-party environment packages, not in the core execution contract.

## Execution Requirements

Environments should be able to contribute execution requirements without owning the final scheduling decision.

Examples:

-   an environment may require exclusive access to a shared resource
-   a benchmark environment may request single-worker execution
-   a browser environment may request process or worker isolation
-   a local integration environment may allow shared setup across many cases

Those requirements should flow into orchestration, where they are resolved together with the needs of the test family and runner profile.
