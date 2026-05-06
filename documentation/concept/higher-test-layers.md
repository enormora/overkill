# Higher Test Layers

## Purpose

This document records what the non-unit layers in the reference projects
actually need, so Overkill can support those workflows deliberately instead
of accidentally inheriting unit-test assumptions.

The four projects are useful because they span different higher-level shapes:

-   `packtory`
    -   local-service integration tests
    -   property tests
    -   workflow and publish benchmarks
-   `misterspex-storefront`
    -   deterministic-server-backed app integration
    -   browser behavior tests
    -   accessibility checks
    -   visual regression
-   `player`
    -   Playwright-driven browser integration
    -   event-collector verification through real browser requests
    -   visual regression
-   `pr-log`
    -   effectively no distinct higher layer, which is useful as a control
        case

## Main Patterns

### Owned Environment Fixtures

The most repeated higher-layer pattern is not another assertion style. It is
an owned runtime or fixture wrapper that controls setup, teardown, and the
API exposed to the test.

Representative examples:

-   `misterspex-storefront`
    -   `withServer(...)` starts a deterministic app server, yields a base
        URL, and always stops it
-   `packtory`
    -   `checkWithRegistry(...)` starts a temporary Verdaccio instance,
        yields auth and URL details, and cleans up storage afterwards
-   `player`
    -   Playwright fixtures create a page-object layer and validate the
        session after the test

What Overkill should support:

-   first-class resource factories with explicit lifecycle scopes
-   typed yielded runtime handles
-   shared-per-worker and per-case lifetimes
-   fixture composition without hook soup

This reinforces `@overkill/resources` as a core higher-layer package.

### Deterministic Local Services

Several higher-layer tests do not stub dependencies. They run against real
local services with deterministic behavior.

Examples:

-   deterministic app server scenarios in `misterspex-storefront`
-   temporary local registry in `packtory`
-   browser test servers in `player`

What matters is not only “server lifecycle”. It is:

-   deterministic startup
-   explicit scenario or mode selection
-   surfaced connection information
-   reliable cleanup

Overkill should therefore treat spawned local services as a normal first-party
resource shape, not as a niche workaround.

### Transport-Aware Transcripts

In higher layers, the interesting output is often not a function call. It is
a transport-level interaction log.

Examples:

-   `player` captures real browser requests and interprets them as event
    collector payload transcripts
-   `misterspex-storefront` browser fixtures attach accessibility-scan JSON
    artifacts
-   integration tests assert status codes, response bodies, and emitted
    payload sequences

This means Overkill should think in terms of **interaction transcripts** more
broadly than unit-test spies:

-   function-call transcripts
-   HTTP request transcripts
-   browser console or request transcripts
-   custom subscription transcripts

The primitive should stay generic, with adapters layered on top.

### Page Objects And Domain Handles

The browser-heavy projects do not expose raw Playwright `page` as the main
test API. They wrap it in higher-level objects:

-   `player` has `playerPage`
-   `misterspex-storefront` has many page objects such as `homepage`,
    `productDetailPage`, `basket`, and `loginPage`

The repeated lesson is:

-   higher-layer tests want domain handles, not only raw browser handles
-   those handles often belong in fixtures/resources rather than in each test
    file

Overkill should support this pattern directly through typed runtime/resource
composition, without prescribing Playwright itself.

### First-Class Attachments

The higher layers frequently need artifacts that are richer than a failure
message:

-   accessibility scan JSON
-   screenshots
-   browser network traces
-   server transcripts
-   benchmark output

Those should not feel bolted on. A test family or resource should be able to
attach structured artifacts explicitly.

Overkill should therefore preserve:

-   per-case attachments
-   fixture/resource-emitted attachments
-   typed artifact metadata for reporters and CI

### Matrices And Runtime Options

Browser and integration layers repeatedly run the same intent against
different runtime dimensions:

-   browser name
-   resolution
-   mobile emulation
-   client bundle type
-   legacy vs modern API mode
-   deterministic scenario

This reinforces the earlier runtime-identity decision:

-   runtime identity should be structured
-   dimensions belong to the runtime identity model
-   fixtures/resources should be able to consume those dimensions directly

### Property Tests As A Distinct Higher Layer

`packtory` uses `fast-check` heavily. Those tests are neither plain
microtests nor integration tests. They are a separate authoring family with
different needs:

-   seed control
-   shrinking
-   reproducibility
-   generated-case naming and reporting
-   useful witnesses for failing generated inputs

Overkill should continue to treat property-based testing as a real package
direction, not merely “fancier unit tests”.

## What Overkill Should Add Or Emphasize

### 1. Resource Factories As The Main Higher-Layer Primitive

Overkill should clearly position first-party higher-layer support around
resource factories and runtime composition, not around hooks.

The key authoring shape is:

-   define a resource/runtime once
-   yield a typed handle
-   let the runner own cleanup

That should cover:

-   local HTTP services
-   registries
-   browser pages and page objects
-   browser contexts
-   accessibility engines
-   external processes
-   PTYs and CLI harnesses

### 2. Scenario Support At The Resource Layer

The deterministic-server pattern is too useful to leave implicit.

Overkill should support named scenarios or runtime presets at the
resource/runtime layer, where they can influence:

-   runtime identity
-   artifact identity
-   replay metadata
-   browser and integration matrices

This should remain explicit and adapter-owned, not guessed by the runner.

### 3. Generic Interaction Transcript Recording

The transcript concept should be broad enough for higher layers.

The first-party abstraction should be able to support:

-   direct call recording
-   callback/subscription recording
-   browser request recording
-   custom protocol event recording

That is more useful than centering the design on one emitter interface.

### 4. Explicit Artifact Attachment

Higher-layer fixtures often discover useful artifacts even when the test body
itself does not explicitly request them.

Examples:

-   an accessibility fixture can attach JSON scan output
-   a browser fixture can attach a screenshot
-   a deterministic server fixture can attach a transcript or scenario
    witness

Overkill should let fixtures and runtimes contribute explicit attachments
without resorting to hidden global interception.

### 5. Browser-Specific Support Should Stay Adapter-Driven

The browser-heavy repos show that page objects, screenshots, and request
transcripts are important, but they do not justify pushing browser semantics
into the engine.

The right split is:

-   engine
    -   generic results, artifacts, runtime identity, execution events
-   resources/runtimes
    -   browser contexts, pages, devices, scenarios
-   browser packages
    -   Playwright/BiDi/CDP/Lighthouse-specific implementations

### 6. Visual Regression Is A Baseline Family, Not A Special Runner

Both `misterspex-storefront` and `player` validate checked-in screenshots
across runtime variants.

This reinforces:

-   visual regression belongs in the baseline model
-   snapshot naming must incorporate runtime dimensions
-   the runner should understand updates, stale artifacts, and attachments
    generically

### 7. Accessibility And Compliance Checks Are Good Plugin Shapes

The `misterspex-storefront` browser-behavior layer and the `player`
Playwright setup both show cross-cutting compliance validation:

-   accessibility analysis
-   post-test session validation
-   browser-page compliance checks

These are strong examples of extension points that should be:

-   explicit
-   resource-driven
-   attach-rich
-   not hard-coded into the engine

## What Overkill Should Not Do

-   Overkill should not introduce another broad assertion DSL just for higher
    layers.
-   Overkill should not hard-code Playwright semantics into the engine.
-   Overkill should not force one browser package, one page-object shape, or
    one server type.
-   Overkill should not rely on hidden hooks as the main integration story.

## Practical Synthesis

The reference projects suggest that Overkill becomes more useful for higher
layers when it provides:

-   typed resource/runtime factories
-   deterministic service scenarios
-   transport-aware interaction transcripts
-   explicit attachments
-   runtime matrices and dimensions
-   baseline-aware browser and visual workflows

That is the real path from microtests to integration, browser, and workflow
tests without changing the whole mental model.
