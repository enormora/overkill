# Higher Test Layers

## Purpose

This document defines what higher test layers need, so Overkill can support
those workflows deliberately instead of accidentally inheriting microtest
assumptions.

The relevant families are:

-   integration tests against local services
-   browser behavior tests
-   accessibility and compliance checks
-   visual regression
-   workflow and publish benchmarks
-   property-based tests
-   rule-centric adapter suites such as ESLint rule tests

## Main Patterns

### Owned Environment Fixtures

The most repeated higher-layer pattern is not another assertion style. It is
an owned runtime or fixture wrapper that controls setup, teardown, and the
API exposed to the test.

Typical examples:

-   start a deterministic app server, yield a base URL, and always stop it
-   start a temporary registry, yield auth and URL details, and clean up
    storage afterwards
-   create a browser page-object layer and validate the session after the
    test

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

-   deterministic app server scenarios
-   temporary local registries
-   browser test servers

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

-   browser requests interpreted as domain-event transcripts
-   accessibility-scan JSON attached by a browser fixture
-   integration tests asserting status codes, response bodies, and emitted
    payload sequences

This means Overkill should think in terms of **interaction transcripts** more
broadly than unit-test spies:

-   function-call transcripts
-   HTTP request transcripts
-   browser console or request transcripts
-   custom subscription transcripts

The primitive should stay generic, with adapters layered on top.

### Page Objects And Domain Handles

Browser-heavy tests often do not expose a raw page handle as the main test
API. They wrap it in higher-level objects such as page objects or domain
handles.

The repeated lesson is:

-   higher-layer tests want domain handles, not only raw browser handles
-   those handles often belong in fixtures/resources rather than in each test
    file

Overkill should support this pattern directly through typed runtime/resource
composition, without prescribing Playwright itself.

That still needs a scope boundary:

-   the first-party browser story should start with running tests in real
    browsers
-   page-object-heavy and end-to-end-style flows are important, but they
    should be framed as richer adapter-driven layers rather than as the
    default meaning of "browser testing"

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

Property-based tests are neither plain microtests nor integration tests.
They are a separate authoring family with different needs:

-   seed control
-   shrinking
-   edge-case injection
-   finite-domain exhaustive generation when a domain is small enough to stop
    pretending randomness is useful
-   reproducibility
-   persistent regression corpus replay before novel generation
-   explicit size/growth control for recursive data
-   generator sampling/preview for authoring and debugging
-   generated-case naming and reporting
-   useful witnesses for failing generated inputs
-   targeted search for hard-to-reach counterexamples
-   rule-based/state-machine layers above ordinary generated examples

Overkill should continue to treat property-based testing as a real package
direction, not merely “fancier unit tests”.

The settled package split is:

-   `@overkill/property` for generator-driven property testing, shrinking,
    edge cases, witness/corpus workflows, and generated-case reporting
-   `@overkill/model` for rule-based/state-machine testing above that
    property core

Property-adjacent testing styles should be layered on top of that family
rather than treated as unrelated concepts:

-   metamorphic testing belongs in the property family as relation-style
    checks over transformed inputs and outputs
-   differential testing belongs above the property family, likely in a
    small package such as `@overkill/differential`
-   linearizability or consistency checking belongs above the model family,
    likely in a package such as `@overkill/linearizability` or
    `@overkill/history`

These styles should reuse the same shrinking, witness, corpus, and
reporting infrastructure rather than inventing parallel systems.

### Contract-Oriented Suites

Contract testing is part of Overkill's product shape, but not as one
universal first-party framework. The settled direction is:

-   Overkill supports contract-oriented suites through protocol-specific
    adapters
-   those adapters build on already-settled primitives such as baselines,
    structured diffs, machine-readable results, and higher-layer runtimes
-   Pact-style HTTP/service contract adapters are an obvious first example,
    but the concept does not commit to one vendor or one protocol family

This keeps contract testing real without forcing every contract workflow
through one mandatory `@overkill/contracts` abstraction.

### Mutation Integrations

Mutation testing belongs in Overkill through integration, not through a
custom mutation engine.

The settled direction is:

-   a first-party Stryker plugin is part of the product shape
-   initial scope targets microtests only
-   Overkill contributes stable identities, selection, and
    machine-readable run results; Stryker remains the mutation engine

### Rule-Centric Adapter Suites

Some ecosystems already have their own case-description DSLs and helper
tools. ESLint rule testing is the clearest example: projects often already
have `valid` / `invalid` case tables and want to preserve that structure.

Overkill should support this, but not by making raw ESLint `RuleTester` a
core primitive. The better direction is a focused adapter package, with a
narrow name such as:

-   `@overkill/eslint-rule-test`

That keeps room for a separate future package such as
`@overkill/eslint-plugin`.

The package should export ready-made macros or suite builders that turn
RuleTester-style case objects into ordinary Overkill tests.

Example direction:

```ts
import { eslintRuleSuite } from '@overkill/eslint-rule-test';
import rule from '../src/rules/no-foo.ts';

export const spec = eslintRuleSuite({
    name: 'no-foo',
    rule,
    languageOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
    },
    valid: [
        'bar()',
    ],
    invalid: [
        {
            code: 'foo()',
            errors: [{ messageId: 'unexpectedFoo' }],
        },
    ],
});
```

Why this belongs in an adapter package:

-   it preserves the familiar case-table shape for rule authors
-   it compiles into ordinary Overkill suites/cases rather than introducing
    another core test DSL
-   it can enforce stricter, more explicit rule-test case semantics at
    collection time
-   it avoids forcing framework-global `RuleTester` assumptions into
    `@overkill/test`

Default capability stance:

-   string-only rule tests should be microtest-friendly where possible
-   parser-heavy, type-aware, fixture-heavy, or processor-heavy rule tests
    may need a richer facade/profile

So the package should be allowed to expose more than one facade or helper
preset, but the default authoring story should still be the macro-style
suite builder above.

### Static Authoring Rules

The ESLint rule-test adapter should be complemented by a separate
`@overkill/eslint-plugin` package.

Its purpose is different:

-   `@overkill/eslint-rule-test` adapts an external test-case DSL into
    ordinary Overkill suites
-   `@overkill/eslint-plugin` statically enforces Overkill-specific
    authoring constraints

The plugin should stay small and semantic, focusing on rules that the API
shape and runtime cannot fully guarantee on their own.

Recommended first rules:

-   `no-constant-actual-assert`
    -   catches likely reversed `actual` / `expected` in equality-style
        assertions
-   `require-exported-spec`
    -   enforces the tests-as-values exported-root convention
-   `no-orphan-test-nodes`
    -   catches high-confidence cases where `test(...)`, `suite(...)`, or
        `table(...)` results are constructed but obviously discarded
-   `no-duplicate-sibling-titles`
    -   catches statically obvious duplicate sibling test titles before
        runtime planning fails
-   `require-test-facade-import`
    -   enforces project use of stable facade aliases such as `#tests/micro`
        / `#tests/integration` where the project has adopted that pattern
-   `consistent-run-if-main`
    -   enforces `always` / `never` policy for explicit `runIfMain(...)`
        fallback usage

The plugin should rely on TypeScript types where possible rather than
duplicating them in lint rules. For example, explicit matcher requirements
for `throws` / `rejects` should come from the assertion signatures rather
than from a dedicated lint rule.

To make these rules work across `@overkill/test`, facades, `@overkill/bench`,
engine-level usage, and re-exports, the plugin should use a real
binding-tracing utility rather than matching one import string literally.

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

`@overkill/resources` should therefore be understood as a resource and
context composition layer, not merely a fixture helper for
`@overkill/test`. It should be able to model:

-   ordinary test context
-   shared or isolated resources
-   per-run, per-file, per-suite, or per-case lifecycle scopes
-   runtime matrices
-   execution requirements that affect scheduling or isolation

Why this over hooks. Hooks tend to hide ordering assumptions, local
mutable state, fixture lifetime, and cleanup responsibility. Runtime
composition is clearer when setup is attached to an explicit runtime
factory or wrapper rather than ambient lifecycle callbacks. The
important pattern is not "before/after hooks". It is: create a runtime,
yield a typed handle, let the runtime own teardown and optional
post-test validation.

Execution requirements. Runtimes should be able to contribute execution
requirements without owning the final scheduling decision. Examples:

-   a runtime may require exclusive access to a shared resource
-   a benchmark runtime may request single-worker execution
-   a browser runtime may request process or worker isolation
-   a local integration runtime may allow shared setup across many cases

Those requirements flow into orchestration, where they are resolved
together with the needs of the test family and runner profile.

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

Browser-heavy workflows show that page objects, screenshots, and request
transcripts are important, but they do not justify pushing browser semantics
into the engine.

The right split is:

-   engine
    -   generic results, artifacts, runtime identity, execution events
-   resources/runtimes
    -   browser contexts, pages, devices, scenarios
-   browser packages
    -   Playwright/BiDi/CDP/Lighthouse-specific implementations

The intended product direction is therefore:

-   first-party support for browser-executed tests
-   adapter/integration support for richer browser-automation stacks
-   no first-party attempt to replace Playwright wholesale

### 6. Visual Regression Is A Baseline Family, Not A Special Runner

Visual-regression suites often validate checked-in screenshots across runtime
variants.

This reinforces:

-   visual regression belongs in the baseline model
-   snapshot naming must incorporate runtime dimensions
-   the runner should understand updates, stale artifacts, and attachments
    generically

### 7. Accessibility And Compliance Checks Are Good Plugin Shapes

Browser behavior suites often need cross-cutting compliance validation:

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

Overkill becomes more useful for higher layers when it provides:

-   typed resource/runtime factories
-   deterministic service scenarios
-   transport-aware interaction transcripts
-   explicit attachments
-   runtime matrices and dimensions
-   baseline-aware browser and visual workflows

That is the real path from microtests to integration, browser, and workflow
tests without changing the whole mental model.
