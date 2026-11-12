# Higher Test Layers

## Purpose

This document defines what higher test layers need, so Overkill can support
those workflows deliberately instead of accidentally inheriting microtest
assumptions.

The relevant families are:

- integration tests against local services
- browser behavior tests
- accessibility and compliance checks
- visual regression
- workflow and publish benchmarks
- property-based tests
- rule-centric adapter suites such as ESLint rule tests

## Main Patterns

### Owned Environment Fixtures

The most repeated higher-layer pattern is not another assertion style. It is
an owned runtime or fixture wrapper that controls setup, teardown, and the
API exposed to the test.

Typical examples:

- start a deterministic app server, yield a base URL, and always stop it
- start a temporary registry, yield auth and URL details, and clean up
  storage afterwards
- create a browser page-object layer and validate the session after the
  test

What Overkill should support:

- first-class resource factories with explicit lifecycle scopes
- typed yielded runtime handles
- per-run, per-file, per-suite, per-case, and shared-per-worker lifetimes
- fixture composition without hook soup

This reinforces `@overkill-dev/resources` as a core higher-layer package.

Longer-lived resources still expose ordinary typed handles to test bodies.
When the resource owner may live outside the consumer execution context,
the descriptor projects that owner handle through explicit
`serializeHandle(...)` and `deserializeHandle(...)` hooks. This keeps
cross-worker and cross-process boundaries visible in the resource definition
instead of hiding them in the runner.

### Deterministic Local Services

Several higher-layer tests do not stub dependencies. They run against real
local services with deterministic behavior.

Examples:

- deterministic app server scenarios
- temporary local registries
- browser test servers

What matters is not only “server lifecycle”. It is:

- deterministic startup
- explicit scenario or mode selection
- surfaced connection information
- reliable cleanup

Overkill should therefore treat spawned local services as a normal first-party
resource shape, not as a niche workaround.

The shared resource layer owns the generic substrate: explicit local address
requests, separate startup and readiness phases, object connection handles, and
owner-only cleanup state. HTTP and process-backed service factories belong in
`@overkill-dev/resources`; concrete browser adapters, registry presets, richer
scenario catalogs, logs, transcripts, and artifacts are built on that substrate
by their owning packages or later runner features.

### Transport-Aware Transcripts

In higher layers, the interesting output is often not a function call. It is
a transport-level interaction log.

Examples:

- browser requests interpreted as domain-event transcripts
- accessibility-scan JSON attached by a browser fixture
- integration tests asserting status codes, response bodies, and emitted
  payload sequences

This means Overkill should think in terms of **interaction transcripts** more
broadly than unit-test spies:

- function-call transcripts
- HTTP request transcripts
- browser console or request transcripts
- custom subscription transcripts

The primitive should stay generic, with adapters layered on top.

### Page Objects And Domain Handles

Browser-heavy tests often do not expose a raw page handle as the main test
API. They wrap it in higher-level objects such as page objects or domain
handles.

The repeated lesson is:

- higher-layer tests want domain handles, not only raw browser handles
- those handles often belong in fixtures/resources rather than in each test
  file

Overkill should support this pattern directly through typed runtime/resource
composition, without prescribing Playwright itself.

Both Browser-executed and Host-driven browser automation are supported
integration shapes. Consumer domain handles may wrap provider-native objects;
Overkill does not prescribe a page-object architecture or replace the
controller's locator/action API.

### First-Class Attachments

The higher layers frequently need artifacts that are richer than a failure
message:

- accessibility scan JSON
- screenshots
- browser network traces
- server transcripts
- benchmark output

Those should not feel bolted on. A test family or resource should be able to
attach structured artifacts explicitly.

Overkill should therefore preserve:

- per-case attachments
- fixture/resource-emitted attachments
- typed artifact metadata for reporters and CI

### Matrices And Runtime Options

Browser and integration layers repeatedly run the same intent against
different runtime dimensions:

- browser name
- resolution
- mobile emulation
- client bundle type
- legacy vs modern API mode
- deterministic scenario

This reinforces the earlier runtime-identity decision:

- runtime identity should be structured
- dimensions belong to the runtime identity model
- fixtures/resources should be able to consume those dimensions directly

### Property Tests As A Distinct Higher Layer

Property-based tests are neither plain microtests nor integration tests.
They are a separate authoring family with different needs:

- seed control
- shrinking
- edge-case injection
- finite-domain exhaustive generation when a domain is small enough to stop
  pretending randomness is useful
- reproducibility
- persistent regression corpus replay before novel generation
- explicit size/growth control for recursive data
- generator sampling/preview for authoring and debugging
- generated-case naming and reporting
- useful witnesses for failing generated inputs
- targeted search for hard-to-reach counterexamples
- rule-based/state-machine layers above ordinary generated examples

Overkill should continue to treat property-based testing as a real package
direction, not merely “fancier unit tests”.

The settled package split is:

- `@overkill-dev/property` for generator-driven property testing, shrinking,
  edge cases, witness/corpus workflows, and generated-case reporting
- `@overkill-dev/model` for rule-based/state-machine testing above that
  property core

Property-adjacent testing styles should be layered on top of that family
rather than treated as unrelated concepts:

- metamorphic testing belongs in the property family as relation-style
  checks over transformed inputs and outputs, exposed through a helper
  such as `relation(...)`
- differential testing belongs above the property family in
  `@overkill-dev/differential`, exposed through a helper such as
  `differential(...)`
- linearizability or consistency checking belongs above the model family
  in `@overkill-dev/linearizability`, exposed through a helper such as
  `linearizability(...)`

These styles should reuse the same shrinking, witness, corpus, and
reporting infrastructure rather than inventing parallel systems.

Generator composition must preserve constraints during shrinking. See
[Property-Based Testing Resolution](#property-based-testing-resolution)
for the resolution and its implementation acceptance criteria.

The canonical helper names for these layers should be treated as settled:

- `relation(...)` in `@overkill-dev/property`
- `differential(...)` in `@overkill-dev/differential`
- `linearizability(...)` in `@overkill-dev/linearizability`

### Contract-Oriented Suites

Contract testing is part of Overkill's product shape, but not as one
universal first-party framework. The settled direction is:

- Overkill supports contract-oriented suites through protocol-specific
  adapters
- those adapters build on already-settled primitives such as baselines,
  structured diffs, machine-readable results, and higher-layer runtimes
- Pact-style HTTP/service contract adapters are an obvious first example,
  but the concept does not commit to one vendor or one protocol family

This keeps contract testing real without forcing every contract workflow
through one mandatory `@overkill-dev/contracts` abstraction.

### Mutation Integrations

Mutation testing belongs in Overkill through integration, not through a
custom mutation engine.

The settled direction is:

- a first-party Stryker plugin is part of the product shape
- scope targets microtests only
- Overkill contributes stable identities, selection, and
  machine-readable run results; Stryker remains the mutation engine

The [Mutation Runner Contract](#mutation-runner-contract) records the
integration boundary and execution requirements.

### Rule-Centric Adapter Suites

Some ecosystems already have their own case-description DSLs and helper
tools. ESLint rule testing is the clearest example: projects often already
have `valid` / `invalid` case tables and want to preserve that structure.

Overkill should support this, but not by making raw ESLint `RuleTester` a
core primitive. The better direction is a focused adapter package, with a
narrow name such as:

- `@overkill-dev/eslint-rule-test`

This is distinct from:

- `@overkill-dev/eslint-plugin` for Overkill-specific static authoring rules

The package should export ready-made macros or suite builders that turn
RuleTester-style case objects into ordinary Overkill tests.

Example direction:

```ts
import { eslintRuleSuite } from '@overkill-dev/eslint-rule-test';
import rule from '../src/rules/no-foo.ts';

export const testNode = eslintRuleSuite({
    name: 'no-foo',
    rule,
    languageOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module'
    },
    valid: [ 'bar()' ],
    invalid: [
        {
            code: 'foo()',
            errors: [ { messageId: 'unexpectedFoo' } ]
        }
    ]
});
```

This same adapter pattern should also cover domain-specific assertion
ecosystems where the foreign library already carries valuable semantics.
A concrete example is:

- `@overkill-dev/aws-cdk` wrapping `@aws-cdk/assertions` through Overkill's
  foreign-assertion bridge rather than trying to make third-party matcher
  interop a generic core feature

Why this belongs in an adapter package:

- it preserves the familiar case-table shape for rule authors
- it compiles into ordinary Overkill suites/cases rather than introducing
  another core test DSL
- it can enforce stricter, more explicit rule-test case semantics at
  collection time
- it avoids forcing framework-global `RuleTester` assumptions into
  `@overkill-dev/test`

Default capability stance:

- string-only rule tests should be microtest-friendly where possible
- parser-heavy, type-aware, fixture-heavy, or processor-heavy rule tests
  may need a richer profile or helper preset

So the package should be allowed to expose more than one helper preset, but
the default authoring story should still be the macro-style suite builder
above.

`@overkill-dev/eslint-rule-test` may use `createTestFacade(...)` when it
needs a named domain preset rather than only a builder function. Useful cases
include compatibility with familiar `RuleTester`-style imports, a typed
`ruleTest` surface that always attaches parser-service resources, or a preset
that records ESLint diagnostics as domain-specific assertion output. The
facade remains adapter-owned and lowers to ordinary Overkill nodes.

### Static Authoring Rules

The ESLint rule-test adapter should be complemented by a separate
`@overkill-dev/eslint-plugin` package.

Its purpose is different:

- `@overkill-dev/eslint-rule-test` adapts an external test-case DSL into
  ordinary Overkill suites
- `@overkill-dev/eslint-plugin` statically enforces Overkill-specific
  authoring constraints

The plugin should stay small and semantic, focusing on rules that the API
shape and runtime cannot fully guarantee on their own.

Recommended first rules:

- `no-constant-actual-assert`
  - catches likely reversed `actual` / `expected` in equality-style
    assertions
- `require-exported-test-node`
  - enforces the tests-as-values exported-root convention
- `no-orphan-test-nodes`
  - catches high-confidence cases where `test(...)`, `suite(...)`, or
    `table(...)` results are constructed but obviously discarded
- `no-duplicate-sibling-titles`
  - catches statically obvious duplicate sibling test titles before
    runtime planning fails
- `consistent-run-if-main`
  - enforces `always` / `never` policy for explicit `runIfMain(...)`
    fallback usage

The plugin should rely on TypeScript types where possible rather than
duplicating them in lint rules. For example, explicit matcher requirements
for `throws` / `rejects` should come from the assertion signatures rather
than from a dedicated lint rule.

To make these rules work across `@overkill-dev/test`, helper presets,
`@overkill-dev/bench`, engine-level usage, and re-exports, the plugin should
use a real binding-tracing utility rather than matching one import string
literally.

## What Overkill Should Add Or Emphasize

### 1. Resource Factories As The Main Higher-Layer Primitive

Overkill should clearly position first-party higher-layer support around
resource factories and runtime composition, not around hooks.

Resources are for higher test families, not microtests. Microtests keep
their strict capability model and do not attach resource descriptors or
resource-bearing runtime descriptors. Integration, browser-oriented,
benchmark, property, and other higher families may use resources and runtimes
when their family model allows them.

The key authoring shape is:

- define a resource/runtime once
- attach the descriptor to tests with `withRuntime(...)` or `withResource(...)`
- let the runner acquire typed handles at the right lifecycle boundary
- inject handles into the test scope
- let the runner own cleanup

That should cover:

- local HTTP services
- registries
- browser pages and page objects
- browser contexts
- accessibility engines
- external processes
- PTYs and CLI harnesses

`@overkill-dev/resources` should therefore be understood as a resource and
context composition layer, not merely a fixture helper for
`@overkill-dev/test`. It should be able to model:

- ordinary test scope
- shared or isolated resources
- per-run, per-file, per-suite, or per-case lifecycle scopes
- runtime matrices
- execution requirements that affect scheduling or isolation

A runtime is a named execution context descriptor. It is commonly a typed
resource bundle, but it can be resource-free when the runner only needs
identity, matrix, or placement data. Real examples:

- a Node runtime dimension such as `{ node: '26', module: 'esm' }`
- a browser-engine dimension such as `{ engine: 'chromium' }`
- a contract target such as `{ provider: 'payments', version: 'v2' }`
- a benchmark workload that requires `single-worker` execution without a
  test-visible handle

Those runtimes do not acquire handles by themselves. Side effects come from
resources and resource acquisition.

Why this over hooks. Hooks tend to hide ordering assumptions, local
mutable state, fixture lifetime, and cleanup responsibility. Runtime
composition is clearer when setup is attached to an explicit runtime
factory or wrapper rather than ambient lifecycle callbacks. The
important pattern is not "before/after hooks". It is: create a runtime,
attach its descriptor to the test, let the runner plan around its
requirements, then inject a typed handle at execution time. The runtime owns
teardown and optional post-test validation.

Canonical authoring should use the ordinary root test import. The selected
runner profile owns the family and runtime policy:

```ts
import { test } from '@overkill-dev/test';
import { withRuntime } from '@overkill-dev/test/resources';
import { apiRuntime } from '#tests/api-runtime';

export const testNode = test(
    'loads user',
    withRuntime(apiRuntime, (scope) => {
        scope.assert.equal(scope.runtimes.api.database.loadUser('42').id, '42');
        return scope.assert.collect();
    })
);
```

For direct resources, `withResource(resource, body)` keeps the common
single-resource case small, while `withResources(resources, body)` gives
multiple resources explicit public keys:

```ts
import { test } from '@overkill-dev/test';
import { withResource, withResources } from '@overkill-dev/test/resources';
import { scratch } from '#tests/resources/scratch';

export const testNode = test(
    'writes output',
    withResource(scratch, (scope) => {
        scope.assert.match(scope.resources.scratch.path, /overkill/);
        return scope.assert.collect();
    })
);

export const secondTestNode = test(
    'writes report',
    withResources({ dir: scratch }, (scope) => {
        scope.assert.match(scope.resources.dir.path, /overkill/);
        return scope.assert.collect();
    })
);
```

Both wrappers attach descriptors, not already acquired handles. Collection
must happen before scheduling. The runner lowers resource scopes and
requirements into placement constraints, starts resources inside the selected
worker or process, injects handles into `scope.runtimes` or `scope.resources`
when handles exist, and disposes them according to their declared scope.
Nested first-party wrappers normalize before planning, so direct resource
keys and runtime names are validated as one public scope. Duplicate direct
resource keys or runtime names fail; equal resource keys under different
runtime names remain distinct.

Runtime matrices and composition are runtime-layer concerns, not test-family
concepts. A browser matrix can run the same authored case once per variant:

```ts
const browserRuntime = defineRuntimeMatrix({
    name: 'browser',
    shared: { ignoreSSLErrors: true },
    variants: {
        chromium: chromiumRuntime,
        firefox: firefoxRuntime
    }
});

const appBrowserRuntime = composeRuntimes(appRuntime, browserRuntime);

export const testNode = test(
    'renders the settings page',
    withRuntime(appBrowserRuntime, (scope) => {
        scope.assert.equal(scope.runtimes.app.frontendServer.status(), 'ready');
        scope.assert.equal(scope.runtimes.browser.page.title(), 'Settings');
        return scope.assert.collect();
    })
);
```

The composed runtime has no own scope name. Child runtime and matrix names are
lifted into `scope.runtimes`. Duplicate names fail, and multiple matrices
expand as a Cartesian product during planning.

Execution requirements. Runtimes should be able to contribute execution
requirements without owning the final scheduling decision. Examples:

- a runtime may require exclusive access to a shared resource
- a benchmark runtime may request single-worker execution
- a browser runtime may request process or worker isolation
- a local integration runtime may allow shared setup across many cases

Those requirements flow into orchestration, where they are resolved
together with the needs of the test family and runner profile.

### 2. Scenario Support At The Resource Layer

The deterministic-server pattern is too useful to leave implicit.

Overkill should support named scenarios at the resource/runtime layer, where
they can influence:

- runtime identity
- artifact identity
- replay metadata
- browser and integration matrices
- resource acquisition cache keys when a scenario changes acquisition

This should remain explicit and adapter-owned, not guessed by the runner.
Scenario names are finite typed catalogs on scenario-aware resources or
simulations. The runner only needs to know scenarios that affect planning,
cache identity, global binding, filtering, or reporting. A resource handle may
still expose body-time scenario methods through normal TypeScript return types.

### 3. Generic Interaction Transcript Recording

The transcript concept should be broad enough for higher layers.

The first-party abstraction should be able to support:

- direct transcript recording
- test-double sink recording
- callback/subscription recording
- browser request recording
- custom protocol event recording

That is more useful than centering the design on one emitter interface.

### 4. Explicit Artifact Attachment

Higher-layer fixtures often discover useful artifacts even when the test body
itself does not explicitly request them.

Examples:

- an accessibility fixture can attach JSON scan output
- a browser fixture can attach a screenshot
- a deterministic server fixture can attach a transcript or scenario
  witness

Overkill should let fixtures and runtimes contribute explicit attachments
without resorting to hidden global interception.

### 5. Browser-Specific Support Should Stay Adapter-Driven

Browser-heavy workflows show that page objects, screenshots, and request
transcripts are important, but they do not justify pushing browser semantics
into the engine.

The right split is:

- engine
  - generic results, artifacts, runtime identity, execution events
- resources/runtimes
  - browser contexts, pages, devices, scenarios
- browser packages
  - Playwright/BiDi/CDP/Lighthouse-specific implementations

The intended product direction is therefore:

- first-party Browser-executed and Host-driven browser automation workflows
- shared browser resources and explicit provider-native controller adapters
- no first-party attempt to replace Playwright wholesale

### 6. Visual Regression Is A Baseline Family, Not A Special Runner

Visual-regression suites often validate checked-in screenshots across runtime
variants.

This reinforces:

- visual regression belongs in the baseline model
- snapshot naming must incorporate runtime dimensions
- the runner should understand updates, stale artifacts, and attachments
  generically

### 7. Accessibility And Compliance Checks Are Good Plugin Shapes

Browser behavior suites often need cross-cutting compliance validation:

- accessibility analysis
- post-test session validation
- browser-page compliance checks

These are strong examples of extension points that should be:

- explicit
- resource-driven
- attach-rich
- not hard-coded into the engine

## What Overkill Should Not Do

- Overkill should not introduce another broad assertion DSL just for higher
  layers.
- Overkill should not hard-code Playwright semantics into the engine.
- Overkill should not force one browser package, one page-object shape, or
  one server type.
- Overkill should not rely on hidden hooks as the main integration story.

## Practical Synthesis

Overkill becomes more useful for higher layers when it provides:

- typed resource/runtime factories
- deterministic service scenarios
- transport-aware interaction transcripts
- explicit attachments
- runtime matrices and dimensions
- baseline-aware browser and visual workflows

That is the real path from microtests to integration, browser, and workflow
tests without changing the whole mental model.

## Browser Testing Product Boundary

### Question And Answer

Which browser testing modes should Overkill offer directly?

The two modes are **Browser-executed** and **Host-driven browser automation**.
The former runs the authored body inside a browser document; the latter runs
it on an execution host using provider-native controllers such as Playwright.
Both may use host-owned instrumentation and the same browser provisioning.
Browser correctness tests belong to integration, never microtest/property.
Browser performance belongs to the [benchmark family](./benchmarking.md#browser-and-frontend-performance-benchmarks).

Body placement, measured target, collector capabilities, and execution strategy
are separate requirements. Compatible placements may share a suite or file
within one family; incompatible import graphs require explicit module boundaries.
See [Browser Execution And Placement](../architecture/runtime-behavior.md#browser-execution-and-placement).

Browser integration guidance targets complete journeys through the fully
rendered application. Overkill recommends unit testing component logic without
a real DOM, then using browser integration tests to check how the application
works together. It does not provide framework-specific mounting APIs or a
component-testing DSL. Users who choose isolated component rendering can supply
that setup within ordinary browser tests, including JSX/TSX modules supported
by their build integration.

### Browser Test Harness

Browser-executed tests/benchmarks require no application or prebuilt app.
Overkill owns the harness server, bootstrap, module delivery, source maps,
and browser communication/result channel through replaceable integrations
with existing tooling. Tests import the browser-compatible code they need,
including application modules. App builds/servers, when needed, are additional
consumer-configured resources rather than prerequisites of browser execution.

Harness startup/readiness, module-version identity, shutdown, and failures use
the ordinary resource/run lifecycle for direct callers and the runner alike.
Harness/control traffic retains a separate declared role from application
traffic. The body realm owns authored assertions; cross-realm evidence retains
explicit session/target/attempt identity.

Browser-executed bodies are bound to their execution document. Replacing it
before completion fails the attempt; there are no resumable phases. Use
host-driven tests for navigation/reload journeys. Host-owned cleanup still runs,
but cleanup inside the destroyed document cannot be promised.

Optional first-party provider-specific assistance supplies supported native
keyboard/pointer input through a bounded channel with explicit target/document/
attempt identity, capabilities, readiness, timeout, and cancellation. It neither
transfers host controller handles nor introduces a universal locator/action API.
Bare execution hosts need not support it; requested unavailable assistance
fails compatibility.

### App Guard Decisions

First-party app/browser-session resources enable standard app guards by default,
including when used by benchmarks. Bare browser execution remains lightweight
and does not require advanced guards or DevTools capabilities. Guarded resources
can be composed into either browser-executed tests or host-driven automation.
Allow all loopback destinations on any port by default;
external destinations require explicit configuration. Ordinary log/info output
remains allowed, while unexpected app warnings/errors and unhandled app errors
fail resource checks.

Intentional warnings/errors can use bounded expectations registered before an
action, with explicit matchers, occurrence counts, and lifetime. Missing or
excess events fail. Matching diagnostics outside the window remain guarded.
Expectations neither grant network permissions nor erase recorded failures.

An explicit network deny inherited from a runtime/profile takes precedence
over a test-local allow. Extending the standard loopback default with an
external grant is separate from overriding an explicit restriction.

Prevent disallowed requests before transmission and fail owning tests unless
an exact, predeclared bounded denial expectation consumes the intentional
denial. Such an expectation may pass while the request stays blocked; missing
or excess occurrences fail. It never widens permissions, retroactively erases
failures, or treats a fulfilled request as proof of denial. If the
requested protection cannot be provided, reject the configuration before app
startup. Stop affected sessions while unrelated tests continue. App-guard
failures are not eligible for automatic integration retries; explicit diagnostic
reruns retain the original failed outcome.

Forbidden application request attempts also fail when HTTP cache or a service
worker supplies the response without outbound traffic. Require reliable attempt
observation alongside transmission prevention. An egress proxy alone does not
provide that coverage; reject configurations that cannot supply it.

Fine-grained URL-path/method prevention is a capability of the selected backend.
Destination-only backends can enforce destination policies but must reject finer
policies before startup. TLS inspection requires explicit configuration and
trusted test certificates; never silently change certificate validation or
substitute observation for requested prevention.

The standard network guard covers HTTP(S) requests and WebSocket connections.
Other transports, including WebRTC and WebTransport, require explicit validated
capabilities. Unsupported requested transport configurations fail compatibility
before startup; the standard guard does not promise machine-wide egress control.

Protected service-worker journeys are in scope. Preserve service-worker behavior
and require compatible enforcement rather than silently disabling it. This is
a compatibility requirement, not a claim that every controller configuration
already supplies the required prevention.

Protected warm-cache benchmarks are also in scope. Preserve declared HTTP cache
behavior and require compatible request prevention. Reject incompatible
configurations rather than silently disabling caching or weakening protection.
Cache-disabled measurements remain distinct workloads.

Integration-test attempts receive a fresh browser context/session by default.
The browser process may be reused. Backend state is isolated through its own
resources/scenarios; benchmark sample reset remains an explicit separate policy.

Tests and benchmarks may create browser workers and manage their communication
and lifetime in the authored workload. No dedicated browser-worker execution
placement is required. Measure startup/message latency and worker-local
computation as distinct intervals.

First-party automation targets compatible desktop/mobile browsers. Native
mobile/desktop application automation can be composed through consumer
resources but has no first-party native UI contract. Embedded WebViews require
an explicit compatibility assessment.

Browser extensions are in first-party scope through provisioning and lifecycle
resources, using ordinary tests and benchmarks. Support is explicit per browser
and profile configuration, including extension pages/background workers and
isolation requirements; general browser support does not imply extension support.
Use a fresh profile/process where context isolation is unavailable. Extension
background startup must be covered before activity or the configuration is
incompatible; post-launch listeners alone do not establish startup protection.

Standalone runnable browser-test exports are outside scope, explicitly rejected
rather than deferred. Browser execution stays connected to an Overkill run.
Offline result/report viewing is separate and remains supported.

### Accessibility And Page Audits

Provide focused first-party adapters and reusable assertions/macros for the
following checks. Reuse established scanners, validators, parsers, and reader
automation rather than implementing competing engines. These are ordinary
integration assertions with resources where needed, not new test families.

| Check group | Supported authoring and evidence |
| --- | --- |
| Automated accessibility | Explicit scanner checkpoints with selected rules, violations, incomplete findings, and covered targets |
| Accessible semantics | Authored role/name/description/state, landmark/heading, and relationship expectations |
| Keyboard/focus journeys | Native Tab/Shift+Tab, activation, modal focus entry/containment/restoration, escape behavior, skip-to-main links, route/form-error focus |
| Contrast and targets | Supported text/non-text contrast and touch-target geometry checks in explicit rendered states; preserve scanner limitations |
| Preferences and adaptation | Light/dark, forced colors, reduced motion, text enlargement, zoom/reflow, and touch conditions with authored behavior expectations |
| Actual screen readers | Reader setup/navigation, bounded announcement transcripts, and assertions for validated OS/browser/reader combinations |
| HTML conformance | Validate original response source and rendered-DOM checkpoints separately |
| CSS conformance | Validate declared external/inline/generated stylesheet inputs with source and coverage provenance |
| ARIA rules | Scanner-backed role/property/state/relationship checks, distinct from interaction correctness |
| Microformats | Parse supported formats and assert extracted entities/properties, including URL/base handling |
| Structured data | Extract/process JSON-LD, Microdata, and RDFa; check declared schema.org vocabulary/profiles and authored facts |
| Discoverability/SEO | Assert status/redirects, title/description/language, canonical/hreflang, robots directives, crawlable links, and structured metadata |
| Named audit integrations | Adapt selected external audits with explicit tool/rule versions, configuration, input, and findings |

Heavier audits run at meaningful authored checkpoints with explicit readiness
conditions, not as automatic initial/final scans. Shared macros may apply the
same checks across journeys. Continuous app guards remain active. DOM checks
may operate inside a browser-executed body or through a host-driven adapter;
original-response checks, native input, readers, and external tools additionally
require their specific resource/target capabilities. A helper must declare those
requirements rather than infer support from the mode name.

#### Interactive Accessibility And Environment Ownership

Scanning alone cannot establish focus behavior, keyboard usability, or reader
announcements. Use native input plus authored expectations for journeys such as
opening/closing a modal and restoring focus. Do not guess a universal tab order
or application-specific interaction model from the DOM.

Runtime matrices describe supported preferences. Preserve how each condition
was applied: native browser zoom, text enlargement, viewport size, device scale,
and CSS transforms are different conditions. Unsupported native zoom cannot
silently become a smaller viewport. Test actual font controls and light/dark
transitions where those are part of the app's contract.

Reader adapters reuse existing automation libraries and own required desktop
focus, settings, permissions, language/voice, and cleanup as resources. Serialize
access to the actual shared desktop/reader when required; separate browser
contexts do not isolate an OS reader. Support is explicit per tested library/
OS/browser/reader version combination. Accessibility-tree snapshots, textual
speech logs, acoustic output, and CSS speech declarations are distinct evidence.
Neither a tree nor CSS declarations prove what a screen reader announced.

#### Document, Semantic, And Search Checks

Original HTML means the actual response used by the browser, retaining status,
headers, decoding, base URL, and document identity. Do not silently refetch a
different response. A rendered serialization loses parser-repaired source
defects and does not automatically include every frame or shadow root. Authors
select source, rendered checkpoints, or both. The same distinction applies to
source stylesheets versus dynamically generated/adopted/shadow styles; record
inaccessible or unavailable inputs explicitly.

Treat these as separate checks: JSON syntax; JSON-LD processing; schema.org
vocabulary/profile usage; search-provider rich-result requirements; and agreement
with visible application facts. For example, a valid structured offer may still
contain the wrong price. Preserve semantic entity identity, base-URL resolution,
and the processing algorithm rather than comparing raw JSON shape alone.
Microformats use an established parser's implied/nested-property semantics,
not just CSS class selection. ARIA validity does not prove correct interaction.

Validator/parser/audit resources use declared networking permissions, including
controlled JSON-LD remote-context loading. Never silently fetch external
contexts, upload documents, or contact a production validator. Prefer local
inputs/services and reusable adapters. Syntax/conformance checks do not prove
layout, browser compatibility, accessibility, or search visibility.

Search assertions retain original and rendered metadata separately. For example,
removing an original-response `noindex` during client startup does not establish
that a crawler will render/index the page. Provider-specific checks retain their
rules/version; schema.org validity is separate from rich-result eligibility.
Passing audits cannot guarantee indexing, ranking, or rich-result presentation.

#### Shared Findings And Acceptance Cases

Each check retains checkpoint/readiness identity, exact input/target scope,
tool/rule/profile version, exclusions, locations, and bounded native reports.
Distinguish violations, incomplete coverage, unavailable required capabilities,
and infrastructure errors. Inaccessible frames, unsupported trees, unavailable
stylesheets, and truncated reader logs cannot disappear into a claim of complete
passing coverage. Authors specify whether complete coverage is required.
CSS/header/source checks may also be reused without launching a browser when
their declared input and family contract permit it.

Acceptance cases include a valid-ARIA modal with broken focus restoration;
an inaccessible frame in an otherwise clean scan; source HTML repaired by the
parser; a client-updated price disagreeing with structured data; and original
`noindex` removed only after startup. Each must preserve the actual evidence
and fail the corresponding authored expectation rather than claim general
compliance. See [Accessibility Beyond Scanning](../research/browser-testing-landscape.md#accessibility-beyond-scanning)
for primary-source background.

### Browser Test Collection

Browser-executed tests use browser-free collection by default. Definitions and
their static imports must load without browser APIs; browser-only modules load
during execution. One designated collection browser is an explicit opt-in for
top-level browser imports. Browser matrices expand as planning metadata before
runtime filtering and sharding, without launching every browser for collection.

For ordinary browser tests, a selected target missing a declared required
functional capability fails compatibility. Intentional skips must be authored
explicitly; the runner does not silently remove cases or automatically skip
them for missing capabilities.

### Native Integration And Protocol Boundaries

Use provider-native action/locator APIs with prominent provider identity in
types and documentation, such as Playwright's `Page`. Overkill owns lifecycle,
guards, checks, measurements, results, and artifacts rather than a universal
action/locator DSL. Cross-controller source compatibility is not a requirement.
Avoid unnecessary breaking changes after adoption even without a semantic
versioning promise.

First-party scope excludes a Classic WebDriver command adapter. Necessary
provider/session setup for BiDi remains possible. Assess Playwright's supported
public BiDi paths before adding another client for demonstrated capability gaps.

### Alternative And Rationale

A first-party component-testing layer would encourage a testing boundary that
the recommended unit/integration split deliberately avoids. Framework-specific
mounting and rendering are consumer setup rather than another Overkill product
mode. General browser execution remains available to those consumers.

### Assumptions And Invalidation

This boundary assumes that ordinary tests and explicit consumer fixtures can
host custom rendering without framework-specific engine behavior. A demonstrated
limitation in those extension points should be addressed there first. Adding a
first-party component-testing product would require revisiting this guidance.

The [browser testing landscape](../research/browser-testing-landscape.md)
preserves prior art and unresolved adapter/platform details; it does not
override the settled scope above.

## Mutation Runner Contract

### Question And Answer

How should the first-party mutation integration execute selected microtests
without making mutation testing an engine concern?

Ship `@overkill-dev/stryker-runner` as a Stryker `TestRunner` plugin above
`@overkill-dev/run`. Stryker owns source mutation, sandboxing, mutant planning,
scores, thresholds, incremental reports, and mutant parallelism. The adapter
owns Overkill configuration loading, identity translation, execution, and
result translation. It uses public programmatic APIs, never terminal parsing.
No custom mutation engine or general mutation-provider framework is needed.

Scope is Node microtest profiles with per-case mutant coverage and
selection. Integration (including browser), benchmark, and mixed-family runs are rejected
before test collection. Installing the plugin does not activate mutation testing
in ordinary runs. The adapter selects an existing microtest profile; no second
profile or duplicated discovery policy is required. When exactly one microtest
profile exists, its name is optional in Stryker's adapter configuration. When
there are several, an explicit name is required. No eligible profile, an unknown
name, or selection of a non-microtest profile fails before collection.
Eligibility uses the complete normalized profile registry, including the built-in
`microtest` fallback. No-config projects can infer that fallback. A custom
microtest profile normally makes inference ambiguous with the fallback; explicitly
configuring the `microtest` entry replaces it. Other profile families may coexist
in the registry, but one invocation selects exactly one microtest profile.
Pre-collection rejection covers profile and configuration selections; incompatible
test nodes in selected files remain subject to collection-time validation.

### Execution And Coverage

- Mutation execution has an explicit adapter-owned policy: serial cases.
  Preserve the configured profile's process model and
  restrictions. Stryker parallelizes mutants. Resolve and expose the scheduling
  override before running through `RunRequest.execution: { mode: 'serial' }`;
  no dedicated mutation profile is required. The resolved request retains this
  intent, the configured profile remains unchanged, and
  `RunFacts.execution.scheduling` exposes the effective scheduling.
- Reuse the profile's discovery, loader, capability restrictions, and process
  usage policies. Keep ordinary V8 coverage disabled and disable retries and baseline
  updates. Use one campaign seed across the dry run, all mutants, workers, and
  worker replacements. Accept an explicit seed or generate one once for the
  campaign and expose it for reproduction. Derive case seeds from that seed and
  stable executable identity, independently of scheduling and filtered selection.
  `overkill.seed` is a nonnegative decimal string. The plugin contributes a
  generated JSON Schema default; Stryker resolves and distributes it before
  worker creation. Workers require the resolved seed, including replacements.
  Initialization logs the seed through Stryker for reproduction. Multiple
  programmatic campaigns in one Node process may share that schema default;
  explicit seeds control reproduction independently of module caching.
- Freeze authoritative discovery, loader declarations, selection, permissions,
  and process usage policy during unmutated initialization. Exclude configuration,
  test definitions, and adapter code from mutation targets. If configuration is
  evaluated again with a static mutant active, reject conflicting policy facts;
  unchanged test IDs alone are insufficient validation.
  Stryker owns the `mutate` exclusions. Initialization rejects overlaps with
  the loaded config entry, discovered test modules, and executing adapter code;
  imported macros, suite fragments, and other definition helpers require
  project-owned exclusions. Keep protected files in the sandbox rather than
  removing them through `ignorePatterns`.
  Resolve policy outside the execution module graph and transport the frozen
  facts into execution hosts. Worker initialization must not import user
  configuration or its dependencies into that graph before the invocation's
  activation mode is established. This also applies to replacement workers.
  Each plugin worker freezes once in a fresh resolver process; replacement
  workers resolve independently until campaign coordination supplies a shared
  authority. Transport immutable `FrozenMicrotestPolicy` data through the public
  runner's `FrozenRunCommand`, with invocation seed, narrowing selection, and
  reporting supplied separately. Revalidate file-backed configuration in the
  execution host before collection. Compare effective policy, discovery and
  loader declarations; ignore reporters, valid unrelated profiles, disabled
  coverage settings, and overridden scheduling. Retain native module caching.
  `overkill.paths` supplies explicit discovery input when the selected profile
  has no file policy and otherwise follows ordinary discovery rules.
  Capture the original project root when Stryker loads the plugin, before the
  worker changes cwd. Rebase original absolute config and discovery inputs to
  sandbox copies; never fall back to original project files. Carry an explicit
  nullable `FileModuleBoundary` through frozen policy. Native synchronous module
  hooks enforce sandbox and trusted installed-package roots before configuration
  revalidation and user imports in each execution process, including symlink
  resolution. Shared roots must not admit original project files. Hook scopes
  follow asynchronous operations and close on success or failure. Ordinary runs
  use `null` and install no hook; preserve native module caching and existing
  capability permissions.
- Performance is the default priority. The Stryker adapter's `freshState`
  configuration defaults to `false`. Normal in-process runs reuse the loaded
  module graph and assume the suite can be rerun in the same process. Persistent
  caches can affect mutation results; document that limitation explicitly.
  Setting `freshState: true` resets the complete transitive module graph and
  mutable state for every invocation, accepting startup and collection cost.
  Do not implement freshness with import URL query parameters.
  Freshness resets process-local ESM, CommonJS, globals, and mutable state. It
  does not reset external files, databases, or services. Every fresh invocation
  collects again, including an invocation following a collection failure.
- Initialize the Stryker namespace inside the process that executes instrumented
  code. For static activation, activate before importing any user configuration
  or test modules. For runtime activation, collect without an active mutant,
  then activate before executing cases. Honor Stryker's activation mode and
  hit limit through its instrumented runtime contract.
  Reset invocation counters, hit-limit state, active mutation, and current test
  identity at their lifecycle boundaries. Preserve namespace and counter-object
  identities retained by instrumented modules in a reused graph. Clear active
  mutation and test identity when an invocation ends, including error paths.
  Partial setup and reset failures still attempt every independent cleanup
  operation, including clearing hit-limit state and the activation environment
  variable. Incomplete reset is an infrastructure error; never replace retained
  objects to recover. Preserve execution and disposal failures when both occur.
- During the dry run, set Stryker's `currentTestId` at the local, awaited case
  start boundary and clear it after case completion, including scope cleanup.
  Reads outside a case remain in Stryker's static coverage bucket. Parent-side
  events received through IPC are too late to control child-side attribution.
- Return Stryker's mutant counters, not V8 coverage. This is private adapter
  data, separate from Overkill's aggregate coverage artifacts. Support Stryker's
  `perTest`, `all`, and `off` modes; the normal optimized path is `perTest`.
  Static or uncertain attribution requires the full eligible suite. Never infer
  `NoCoverage` from missing transport data, missing tests, or ordinary coverage.
  Retain the dry-run mode and unaggregated counters with the original eligible
  catalog across workers. `all` aggregates counters for Stryker without using
  per-case selection; `off` omits returned coverage and also selects the full
  eligible suite. In `perTest`, narrow only when a valid filter includes every
  recorded covering case. A valid filter that omits a covering case or lacks
  positive attribution widens to the full frozen catalog. Complete empty
  counters are valid; a case touching no instrumented code needs no bucket.
  Missing or malformed transport and incomplete test delivery remain errors.
  Preserve Stryker's explicit `ignoreStatic` opt-out: it may select runtime-only
  execution for hybrid mutants. Otherwise recorded import-time hits require
  static activation. Widening preserves the invocation deadline and bail policy.
- Honor both the profile's per-case timeouts and Stryker's invocation deadline;
  the earlier applicable limit wins. The invocation deadline covers startup,
  collection, execution, and cleanup. Stryker owns enforcement against its
  plugin worker, including a synchronous infinite loop. Terminate and reap
  adapter-owned execution hosts on timeout or disposal. Unrelated processes
  remain outside that ownership boundary. Disable Overkill retries; Stryker
  retains ownership of its infrastructure recovery.

  Use one monotonic budget from invocation entry, including initialization when
  performed lazily within that invocation. Keep the sender's budget active across
  IPC and transport remaining durations rather than Unix deadlines. Cancellation
  must bypass queued work and target the current operation; it must not dispose a
  surviving initialized session. Explicit initialization outside an invocation
  does not acquire an invented invocation deadline.

### Reporting And Persistence

Stryker owns campaign output and reports. Mutation invocations suppress ordinary
Overkill reporters, including configured custom reporters. Adapter-owned
reporting collects structured results, failures, and counters in memory without
disabling test checks.

Overkill writes nothing to disk by default during mutation invocations: no run
records, results, duration history, artifacts, or reports. Stryker's sandbox and
campaign reports remain governed by Stryker's configuration.

The adapter setting `overkill.artifactPersistence` supports `off`, `failures`, and `all`,
defaulting to `off`. Opt-in persistence saves available diagnostic artifacts and
transcripts with campaign, mutant, invocation, and case identity. It does not
enable ordinary Overkill reports, run records, or duration-history persistence.
`failures` means failed test invocations, including killed mutants, timeouts,
execution errors, and failed dry runs; surviving mutants are included by `all`.

Persisted diagnostics include available native failure outcomes and diffs,
runner errors, and delivered artifacts or transcripts. They use a versioned
diagnostic envelope, separate from ordinary result reports and run records.
Store them under the launch project's configured runtime-state directory at
`mutation/<campaign>/<invocation>/diagnostics.json`; copy file-backed evidence
beside the document so it survives sandbox cleanup. Workers and replacements
share campaign identity, while every invocation has a unique identity. Preserve
structural case, work, and attempt identities and run-scoped attribution.
Invocations without available diagnostic evidence create no files. Unattached
transcript objects do not gain automatic recording.

Use existing artifact production and limits. Persistence does not enable capture
or capabilities forbidden by the selected profile. Runner-owned persistence
happens outside the test capability boundary; artifact delivery or write failure
is an execution error, not a mutant kill.

### Process And Error Ownership

Stryker owns the mutation campaign and supervises its plugin workers. Overkill
still owns microtest execution, assertion and scope contracts, capability
policy, asynchronous-error attribution, and structured results. External
orchestration does not disable those checks.

Stryker uses a pool of plugin worker processes. Each adapter instance handles
multiple mutant-run invocations; a worker is not recreated for every test or
mutant by default. When a plugin cannot reload its environment, Stryker restarts
it for required reloads, including transitions involving static mutants. The
[reload decorator](https://github.com/stryker-mutator/stryker-js/blob/v10.0.0/packages/core/src/test-runner/reload-environment-decorator.ts)
owns that behavior. Worker isolation from the main CLI does not isolate tests
from the plugin worker's own transport and logging.

The adapter preserves the configured process model. Fresh-state execution is
opt-in; it does not add a process boundary to ordinary in-process runs.

| Configured process model | `freshState: false`                                                                                  | `freshState: true`                                                        |
| ------------------------ | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `in-process`             | Execute serially inside Stryker's reusable plugin worker with the profile's best-effort observations | Start a fresh invocation host; execute the normal in-process runner there |
| `supervised-process`     | Use the normal runner's fresh restricted test child                                                  | Use that same fresh-child boundary, without an additional invocation host |

Report `reloadEnvironment: false` for normal in-process execution because native
ESM cannot reset its transitive imports. Stryker then restarts the plugin worker
when a reload is required. Report `true` when the adapter can reset its execution
environment through fresh-state mode or the supervised child's lifecycle.
Fresh-state mode changes module lifetime, not the configured profile's permission
guarantees. Its in-process runner still supplies best-effort observations.

Use the public runner's generic `createExecutionSession` lifecycle. Install its
factory before configuration revalidation and user imports. Validate the complete
collected plan before exact `WorkId` selection. Await case entry and completion
around native case execution, including cleanup; completion may stop further
serial admissions. Deliver native results and validated lifecycle data in memory.
Ordinary reporter and persistence paths do not run in these sessions. Generic
session contracts do not expose Stryker instrumentation or result types.

The adapter installs an authenticated, versioned IPC receiver in Stryker's main
process. Generated schema defaults distribute its endpoint to workers using the
Stryker `10.0.0` worker marker. Registration must not wait for the dry run. Publish
the original eligible catalog and coverage once, retain them by canonical sandbox
root for the process lifetime, and fetch once per worker. Replacement workers
must not perform another unmutated test collection to reconstruct the baseline.
Keep transport and catalog failures distinct from absent mutant coverage.

The receiver owns fresh invocation hosts and supervised execution children.
Plugin-worker disconnect cancels their invocation and awaits child termination,
including children stuck in synchronous code. Reused in-process code remains
under Stryker's plugin-worker supervision. Receiver sockets must not keep Node
alive; no additional broker process, reporter, launcher, or disk manifest is
required. Reject conflicting publications and incompatible direct reuse of a
loaded native ESM graph. Account for Stryker's sandbox file filters and static
planner activation when validating and selecting against the original catalog.

Keep console policy, uncaught-exception and unhandled-rejection observation,
and async-leak checks around test execution. Stryker logging, transport, and
adapter bootstrap operations belong outside the test policy boundary. An
existing runner guard that accidentally captures those operations needs a
boundary correction, not a blanket policy bypass.

Use the existing programmatic runner APIs so configured test policy remains
active. No adapter-specific low-level execution API, unchecked mode, or
host-supplied process-error observer is required. Runtime methods remain native
under [No Runtime Monkey-Patching](../decisions/principles.md#no-runtime-monkey-patching).
Stop per-run event subscriptions, diagnostics subscriptions, and async observers
when the run completes. Complete Stryker bootstrap before enabling test
observations and deliver adapter results after those observations stop. Validate
that Stryker-owned logging and transport do not become test-policy violations
when in-process execution shares the plugin worker.

Keep a surviving plugin worker after an unsafe invocation once its owned scopes,
observations, and invocation bookkeeping are closed. Do not automatically enable
fresh-state execution or retire that worker because of a case timeout, leak, or
unattributed error. This does not promise removal of leaked work or mutable module
state. Later observations still require safe attribution to the current attempt;
unattributed failures remain errors. Stryker handles workers that exit, crash,
exceed its invocation deadline, or require its normal environment reload.

An observable interruption closes the attempt's scope and awaits its registered
cleanups once, even if the body remains pending. Cleanup stays inside the original
attempt's policy and instrumentation boundary. Late body settlement cannot deliver
another result or repeat cleanup. If cleanup hangs in the reused plugin worker,
the invocation remains pending for Stryker's existing deadline enforcement; the
adapter adds no watchdog, retirement policy, or fresh-state fallback. Forced
process termination cannot guarantee remaining cleanup.

Resource allocations from closed or foreign attempts, and allocations without
known ownership, remain ambiguous run errors. They do not become current-case
failures based on serial timing or matching native resource types.

Native observations preserve process methods. Diagnostics are not inherently
case-local: out-of-test console output and new IPC listeners can produce run
errors while observation is active.
Fresh-state and supervised execution separate those activities by process.
Normal in-process execution must preserve their ownership within a shared worker.

### Identity And Result Contract

Dry-run collection establishes the eligible test catalog and fixed selection.
Retain the original nullable file restriction, including eligible files with no
cases. Do not reconstruct that restriction from files represented in the catalog.
Repeated dry runs validate the original file restriction, coverage mode, and
catalog before case execution; they cannot replace the original baseline.
Return the original baseline counters after validating each repeated dry run,
including when a reused graph no longer repeats its import-time reads.
Normalize sandbox file origins to canonical project-relative paths. Encode
`CaseId` structurally, including parameter identity; display names and source
positions are presentation data. Use the complete executable identity when a
valid microtest plan distinguishes executions of the same logical case; never
collapse distinct `WorkId` values into one Stryker ID. Other test families and
their runtime or workload features remain outside this integration's scope.

Each invocation validates its executable catalog against that catalog and runs
Stryker's requested IDs exactly when attribution supports narrowing. Static or
uncertain attribution widens valid filters as specified under
[Execution And Coverage](#execution-and-coverage); it never widens beyond the
frozen eligible catalog. An absent filter means the complete eligible suite;
an explicit empty filter means no tests. Unknown IDs, duplicate IDs,
changed case identities or selection metadata, or a requested test becoming
skipped are adapter errors, never successful survival. Empty mutant selections
execute nothing and return an error rather than claiming survival or coverage.
A selection with no runnable cases after valid coverage fallback is also empty;
intentional skips remain visible in the dry-run catalog.
Mutated collection failures are reported as
errors rather than silently changing the catalog or widening an invalid filter.

| Overkill observation                                                                                         | Stryker result                                                                 |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Dry run completes normally                                                                                   | Individual success, failure, and skipped results with stable IDs and durations |
| Dry-run timeout or infrastructure failure                                                                    | Dry-run timeout or error; no mutation score                                    |
| Mutant causes a safely attributed case failure, including an assertion, body error, or test-policy violation | `Killed`, with the failing IDs and structured diagnostic rendered as a message |
| All requested runnable cases complete successfully                                                           | `Survived`, with the number actually executed                                  |
| Execution deadline expires, a case times out, or Stryker's hit limit is exceeded                             | `Timeout`                                                                      |
| Pre-case loading or collection failure, infrastructure failure, or failure without safe case attribution     | `Error`, with its diagnostic                                                   |
| Inconclusive result, unexpected skip, identity drift, or incomplete result delivery                          | `Error`                                                                        |

Test-policy violations count as kills only when safely attributed to an eligible
case and its active attempt. Permission violations, forbidden console output,
and unhandled errors can therefore kill a mutant without an assertion failure.
Unattributed observations, attribution drift, and adapter, reporter, transport,
or persistence failures remain errors. Do not infer attribution merely because
cases execute serially. A failure before any case can be identified remains an
error even after a successful dry run.

Result precedence is `Error`, then `Timeout`, then `Killed`, then `Survived`.
An infrastructure failure invalidates the invocation even after a confirmed
kill. A timeout during cleanup or continued execution also overrides an earlier
kill, including when `disableBail` is enabled. Preserve earlier confirmed case
failures in diagnostics when returning an error or timeout.

Internal lifecycle checkpoints may preserve confirmed failures before another
case is admitted and before lifecycle disposal. Snapshots can be sampled more
than once; checkpoints do not establish successful completion or complete
coverage. A native supervised watchdog timeout remains a timeout when forced
termination prevents final lifecycle delivery. Unexpected missing delivery
without timeout evidence remains an error.

A verified Stryker hit-limit guard is timeout evidence even when it is thrown
during cleanup or wrapped by loading and policy revalidation. Independent
cleanup, reset, and infrastructure failures retain error precedence.

Stop scheduling further cases after a confirmed kill unless Stryker's
`disableBail` requests complete execution. Finish admitted work, case cleanup,
observer shutdown, and final result delivery before returning the kill. Cases
not executed because of this explicit early stop do not become missing-result
errors. Report the actual executed count and confirmed killing IDs.

The dry run must establish the complete eligible catalog. An intentionally
skipped case is reported as skipped during the dry run and never demonstrates
a kill.

Dry-run assertion, body, and test-contract failures remain individual failed
test results. Case cleanup failures invalidate the dry run as infrastructure
errors, including when the same case also failed an assertion or timed out.
Error diagnostics retain the affected stable test IDs and complete failure
lists alongside runner errors. Such invocations do not publish a campaign
baseline. Stryker aborts on dry-run errors or timeouts without a mutation score.
Stryker owns score policy, including its treatment of timeouts and errors.

### Alternatives And Evidence

- **Stryker with adapter-owned execution:** selected. Its public plugin contract
  already provides dry runs, exact selection, activation modes, and structured
  results. Current [Vitest source](https://github.com/stryker-mutator/stryker-js/blob/f2a49ff02437e3b7fe2682dba808ac93039895bf/packages/vitest-runner/src/vitest-test-runner.ts)
  forces one worker and `maxConcurrency: 1`; its setup hooks attribute per-case
  counters. It retains a Vitest context, so it does not establish that fresh OS
  processes are required by Stryker.
- **Reuse Jest's execution model:** Jest runs files in band and wraps the test
  environment for attribution. Its module environment can reload between runs;
  native Overkill ESM imports provide no equivalent transitive reset guarantee.
  `runInBand` alone does not establish serial concurrent test bodies.
- **Execute directly in Stryker's reused worker:** selected for normal
  in-process runs to avoid mandatory startup overhead. Native ESM can report
  `reloadEnvironment: false` so Stryker restarts for required reloads.
  Runtime mutant runs still reuse state; repeatability is a suite requirement.
  Fresh-state mode is the opt-in alternative for cache-dependent results.
- **Require fresh execution for every mutant:** rejected as the default because
  process startup and collection add cost to every mutation invocation. Offer
  this guarantee through `freshState: true` instead. Stryker's
  `maxTestRunnerReuse: 1` alone is insufficient: its reuse counter counts mutant
  runs, leaving the first mutant able to reuse dry-run state.
- **File-level attribution:** the [TAP adapter used with AVA](https://stryker-mutator.io/docs/stryker-js/tap-runner/)
  uses a fresh process per file and selects files. This avoids requiring serial
  cases but loses Overkill's case-level selection and killer identities.
- **Always execute the full suite:** rejected as the complete design because
  it loses selective reruns. Stryker's `off` mode remains available when a user
  requests full-suite execution without coverage optimization, retaining the
  adapter's execution policy.
  The command runner also loses structured failure classification.
- **Different mutation engine:** [Mutagen](https://github.com/brandoncorrea/mutagen)
  offers physical source copies and a custom runner, but only `0.1.0` was
  published at the assessment date. [Mutode](https://github.com/TheSoftwareDesignLab/mutode/commits/master/)
  has no default-branch commits after January 2020.
  [LLMorpheus](https://github.com/neu-se/llmorpheus) still executes through a
  Stryker fork. None currently provides stronger evidence for replacing Stryker.

Maintenance assessed on 2026-10-05: [Stryker 10.0.0](https://github.com/stryker-mutator/stryker-js/releases/tag/v10.0.0)
was released on 2026-08-14, with substantive runner and instrumenter work also
merged in September. This supports retaining it; it does not promise future
maintenance or timely issue resolution. The
[plugin API](https://github.com/stryker-mutator/stryker-js/tree/v10.0.0/packages/api/src/test-runner)
is the compatibility contract, ahead of simplified documentation examples.

### Compatibility And Validation

This resolution preserves the concept's microtest-only scope, API-first
boundary, stable identity model, and aggregate V8 coverage policy. Mutation
execution is a separate, explicitly reported orchestration policy.

Each invocation needs fresh scopes, observers, and result collection even when
it reuses an already collected plan and module graph. Selection applies to the
frozen eligible catalog without reimporting modules merely to rerun cases.
Keep Stryker types, globals, and score semantics inside the adapter package.

Compatibility validation covers sandbox-relative and parameterized IDs, runtime and
static activation, exact filtered execution, worker reuse, opt-in state reset,
capability enforcement, counter delivery, and complete timeout termination on
the repository's pinned Node version. Compare optimized results against full
suite results on repeatable representative suites. Measure worker-reuse and
fresh-state costs separately, including startup, collection, and test execution.

Validation also covers native early exit, abort, and result-less termination,
preserving the configured process model's documented observation gaps.

Revisit this answer if those checks show incorrect selection, if maintaining
restrictions requires private engine imports, if process startup removes the
benefit of opt-in reset, or if Stryker no longer supports the project's toolchain.
Changing vendors would reopen the concept's first-party Stryker commitment;
it is not an adapter implementation detail.

## Property-Based Testing Resolution

### Question And Constraints

What authoring, execution, shrinking, and replay contract defines property
testing in Overkill?

The existing concept requires integrated shrinking, dependent generators,
deterministic reproduction, witnesses, and reuse by `@overkill-dev/model`.
The property family remains separate from microtests, with microtest-like
capability restrictions. The initial shrinking deep dive expanded into the
property family contract through the decisions recorded below.

### Resolution

Public generators use fluent composition. Primitive constructors live under
`gen`; generator values expose `map`, `flatMap`, and `filter`. Custom domain
generators return values built from those constructors and methods.
`property({ title, generator, test })` is the primary constructor and returns
an ordinary property-family test node usable directly or inside `suite(...)`.
Its generator and body are available during collection; generation starts
only during execution. Each body receives its input and a fresh injected
property-local assertion context. The standard import is
`@overkill-dev/test/property`; semantic ownership stays in
`@overkill-dev/property`.

`scope.forall(generator, body)` remains an advanced composition form. It is
not a runtime subtest and does not add cases to the collected tree. Its
witness replay executes the enclosing case normally, including setup and
non-target property calls, substituting the saved input only at the target
invocation. Target identity is source location plus invocation occurrence,
with an explicit stable key available. Missing, ambiguous, or unreached targets
produce a replay error. This preserves surrounding behavior rather than
promising independent access to an inline callback. First-class property
witnesses replay the declared property body directly.

Nested authoring uses the family-owned `withProperties(body)` scope wrapper
around an ordinary `test(...)` value. It supplies typed `scope.forall` support
without widening the base microtest scope or registering runtime subtests.
Both replay forms retain normal case and suite lifecycle, runtime selection,
capability enforcement, cleanup, and supervision. Direct replay bypasses
generation and shrinking, not those execution boundaries.

First-party generator composition carries shrinking automatically. Every
newly generated input and shrink candidate submitted to the property body
satisfies the constraints declared by the composed generator. This guarantees
domain validity, not that a candidate still fails or that its displayed value
becomes smaller. Decoded regression inputs have the separate replay policy
below.

- `map` reapplies its pure transformation to source candidates. It does not
  require an inverse or a separate shrinker for the mapped output.
- Tuples and records preserve each component's declared domain.
- `flatMap` retains the dependency. When the source changes, candidates come
  from the dependent generator constructed for that new source. With the
  source fixed, that dependent generator may shrink its own output.
- Recursive generators retain declared size and depth limits throughout
  generation and shrinking.
- Filtering rejects candidates outside the predicate. Rejection is bounded
  and never counts as a passing trial.

For an array and an index generated within its length, shrinking the array
cannot leave an out-of-range index. The index must be generated or shrunk
under the new length constraint. An empty array is unavailable if the
declared domain requires an index into it.

Generator callbacks are pure and deterministic under their generation
context. Dependent regeneration uses retained deterministic context, never
ambient randomness. If changed bounds make retained choices incompatible,
the backend must deterministically reject or reconstruct the candidate under
the new bounds before invoking the property body. Reproducing the old value
after the domain changes is not a requirement.

The generator retains enough state to reconstruct a fresh input for every
trial. Property bodies may mutate their input without corrupting the retained
counterexample or later candidates. Arbitrary output cloning is insufficient
for custom classes and aliasing; reconstruction belongs to the generator.
Custom generators must satisfy the same validity, reconstruction, and bounded
shrinking contract. Provenance need not have one prescribed representation.

Callbacks allocate fresh mutable outputs or derive them from reconstructed
source inputs. Returning an externally shared mutable instance violates this
contract; deterministic return values alone do not establish reconstruction.
Runtime detection of shared mutable outputs is not promised.

Explicit examples are pure synchronous input factories, typed as
`PropertyExample<Value> = () => Value`. First-class declarations accept
`property({ title, generator, examples, test })`. Nested declarations accept
`scope.forall({ generator, examples, test })` alongside the existing positional
form. Example factories return concrete inputs with fresh mutable graphs;
they are not sampling generators. Construction snapshots the factory array
without executing it. Nested examples do not override collected exploration policy.

Fresh reconstruction also applies to corpus replay, explicit examples,
automatic edges, direct witness replay, and failure confirmations. Stored
payloads and retained generation state stay untouched; every execution receives
its own decoded or reconstructed graph.

The initial custom-generator API composes the provided primitives and
combinators, inheriting shrinking automatically. Authors do not supply a
separate shrinker. Opaque sampling-only callbacks are outside the initial API;
concrete values remain regression examples. A singleton domain may have no
smaller candidates without violating the contract.

Generator values carry private Overkill identity shared across package copies.
Fluent constructors and combinators preserve that identity; shape-compatible
objects and generators from other libraries are not accepted directly.

A property invocation stops generating new inputs at its first failure and
shrinks that failure into one primary counterexample and witness. It does not
continue searching for additional failures during that invocation.

Corpus replay, edge-case execution, new trials, failure confirmations, and
shrinking execute sequentially within a property invocation. Each trial's
assertion, input, and cleanup state finishes before the next begins. Separate
property cases may execute in parallel under the runner's ordinary scheduling
and isolation policy; there is no initial within-property concurrency option.
Within an enclosing case, each nested `scope.forall` invocation must be awaited
before another begins. Overlapping calls and completion with an unfinished
invocation are scope-contract failures. Stop admitting inputs and finish cleanup
for admitted work before completing the case.

Before shrinking, a fresh reconstruction must reproduce the original failure.
Confirmation does not require shrink state. Examples, automatic edges, and
exhaustive inputs with a reconstructible recipe still confirm and retain a
replayable witness when candidate shrinking is unavailable.
After candidate search completes, confirm the retained counterexample again.
Both confirmations use the existing total and shrink work budgets; no extra
confirmation budget is reserved.
If rechecking the same retained input passes or produces an unrelated failure,
the run stays failed, reports a non-reproducible failure, retains both observed
outcomes, and stops shrinking. The same rule applies if a later confirmation
of the retained counterexample disagrees. Available input evidence may still
be saved, but it must not be presented as a reliably reproducing witness or
automatically added to the regression corpus.

Shrinking preserves the original failure. A candidate replaces the retained
counterexample only when it reproduces that failure. Passing inputs, rejected
inputs, and unrelated failures do not replace it. Other observed failures keep
separate diagnostics without changing the shrink target. Generator callback
exceptions and execution infrastructure failures are not generator rejections
and must remain visible as errors.

Failure identity is automatic by default: assertion kind and source location,
or exception type and originating throw location. Input-dependent values and
messages do not participate in matching. Authors can supply an explicit stable
failure key through `sample.failureKey(key)` when automatic identity is too broad.
Keys are nonblank trial-local strings; repeated identical keys are allowed,
while conflicting keys are observation-contract failures. Keys preserve the
assertion-versus-body-error distinction. Assertion failures and body
errors remain distinct. If no reliable identity is available, shrinking stops
and retains the original failure with a diagnostic explaining the limitation.

When a trial collects several failed checks, its first failed assertion in
recording order is the primary shrink target. A replacement must reproduce
that check, not the complete original failure set. Other checks remain
diagnostics. With no failed assertion, the user body error supplies the target.
An explicit failure key may define a broader semantic target. Cleanup,
supervision, resource, and scope-contract failures keep their native outcomes
and stop execution rather than becoming ordinary assertion shrink targets.

The requested new-trial count excludes corpus replays and injected edge cases.
Those known inputs run in addition to new exploration, with separate reported
counts. “New” denotes the exploration phase, not globally distinct values;
accepted repeated values may count as trials. A growing corpus cannot satisfy
the new-trial target. Rejected inputs,
shrink attempts, and failure confirmations also do not count as accepted new
trials. A separate total-work budget bounds all phases; exhausting it before
required successful trials complete is inconclusive unless a failure has
already been established.

Execution order is checked-in corpus, compatible local corpus, explicit
examples, bounded automatic edge cases, then new exploration. Every explicit
example is a required check unless an earlier failure stops the invocation.
If the work budget prevents required examples from completing without an
established failure, the result is inconclusive. Automatic edge cases use a
deterministic representative set bounded by profile policy; composed generators
do not require the Cartesian product of all component edge cases.

Small, exactly enumerable domains automatically use exhaustive testing when
complete enumeration fits a configured limit. After required corpus and
edge-case checks pass, testing every domain value successfully satisfies the
property even below its requested new-trial count. Report exhaustive completion
and the number of domain values checked. A truncated traversal, sampled subset,
or unknown domain cannot claim exhaustive success; larger and unknown domains
retain the requested new-trial target.

Targeted search is explicit and opt-in. Property-local numeric scores guide
which inputs are explored; they are not required coverage conditions. Missing
a high-scoring input does not invalidate otherwise completed passing trials.
Required input coverage is declared separately and reports inconclusive when
unmet. Input coverage describes generated-input conditions, not the code
coverage feature excluded from the property profile. Scores and coverage
observations are local to each trial and do not survive into later trials as
mutable user state. Targeting obeys the same deterministic context and budgets
as ordinary generation.

`sample.target(label, score)` records a finite numeric score to maximize;
authors negate a score when lower values are preferable. `sample.cover(label,
condition)` records input-coverage observations against declared requirements.
Invalid scores and labels are contract errors. Labels, retained search state,
sizes declared by constructors, and recursive depth are bounded by collected property policy.

Coverage requirements count accepted new exploration only, including targeted
exploration. In exhaustive mode, their denominator is the complete enumerated
domain. Corpus replay, explicit examples, automatic edges, rejected candidates,
failure confirmation, and shrinking do not contribute to that denominator or
satisfy its thresholds. Report their observations separately. Exhaustive
completion still has to satisfy explicitly declared input coverage; checking
all values does not override a requirement that the domain cannot meet.

Traversal budgets bound candidate production, reconstruction, rejection,
duplicate processing, and property-body evaluations. Execution also obeys
cancellation and supervision. Repeated outputs, including constant mappings,
cannot cause unbounded search. Generation exhaustion before the required
accepted trial count is inconclusive. Shrink budget exhaustion retains the
last confirmed failure; a supervisor interruption keeps its native execution
outcome and any available confirmed evidence.

Reporting distinguishes exhausted search, exhausted budget, and interruption.
Use “shrunk counterexample”, not an unqualified claim of minimality. Even an
exhausted candidate search does not prove a global minimum.

### Collected Property Policy

Property profiles require explicit file discovery and expose `property`
exploration defaults. They use microtest execution models and capability
restrictions, reject resource descriptors and authored capture controls,
and do not expose code coverage, retries, or attachment configuration.
Defaults are supervised concurrent case execution with maximum concurrency 5,
a 2 s collection deadline, a 1 s soft timeout, and a 2 s hard timeout.

Policy version 1 has these finite safe-integer defaults:

| Setting               | Default |
| --------------------- | ------: |
| `newTrials`           |     100 |
| `maxSize`             |     100 |
| `maxDepth`            |      10 |
| `maxAutomaticEdges`   |     100 |
| `maxExhaustiveValues` |   1,000 |
| `maxWork`             |  10,000 |
| `maxShrinkWork`       |   1,000 |
| `maxLabels`           |     100 |
| `maxRetainedInputs`   |     100 |

`newTrials`, `maxWork`, `maxLabels`, and `maxRetainedInputs` must be positive;
other limits may be zero. A zero edge, exhaustive, or shrink limit disables
that activity. Small work limits remain valid even when they cannot satisfy
the requested trial count. Total work charges candidate production,
reconstruction, rejection, duplicate processing, confirmations, and body
evaluations across all phases. Shrink work additionally charges those
operations during shrinking and remains subject to total work.

`property({ title, generator, test, settings })` and
`withProperties(body, settings)` supply sparse exploration overrides.
Profile values are defaults: declaration settings may raise or lower them,
without changing capability restrictions or timeout/process supervision.
Every nested `scope.forall(generator, body)` inherits its wrapper's policy;
there are no invocation-time policy overrides.

An unconfigured second wrapper preserves the original declaration. A
configured second wrapper is invalid, including when the first wrapper used
profile defaults. Preserve that conflict as declaration metadata and report
it during collection instead of silently merging settings. Validate every
discovered property before filtering or sharding. Collection must never
execute generators, property bodies, or codecs to discover settings.

The engine represents executable property declarations with
`bodyMode: 'property'` and unresolved or resolved policy. Generator semantics
remain in the property package. Bodyless runner summaries carry only typed
policy metadata; callbacks and generators remain in executable declarations.
Frozen facts record the resolved profile and case policy. Supervised
assignments verify the policy by work identity before execution.

### Replay Boundary

A witness and its promoted regression use reviewable, versioned JSON rather
than an opaque binary replay payload. The payload explicitly represents
non-JSON types and graph references. It records its codec identity and version;
serialization-library upgrades cannot silently change the stored format.

The JSON transport uses `devalue` behind Overkill's codec boundary. Its
reference table is retained as JSON data, not executable source or a binary
blob. Promotion presents a decoded value preview alongside the reference
table so authors can inspect both values and graph relationships. The preview
is diagnostic; replay always uses the lossless payload.

The probe with `devalue` 6.0.2 preserved a cyclic record, shared references,
object Map keys, a custom class through its codec, bigint, sparse arrays, and
negative zero. The library explicitly makes
[cross-version format stability and human-readable output non-goals](https://github.com/sveltejs/devalue).
Overkill therefore owns format versioning, decoder compatibility, and review
presentation rather than treating an unversioned library dump as the contract.

Built-in readers retain supported historical format decoders. Writers use the
current format; migration is an explicit operation and never a side effect of
test execution. Each stored entry identifies its transport format and input
codec version so the reader selects the matching decoder. Dependency upgrades
must pass compatibility fixtures for every supported historical format.
Custom codec authors declare the versions they support. Unsupported versions
follow the strict checked-in corpus, tolerant local cache, and strict direct
replay policies below.

A first-class property witness replays the retained input directly without
generation or shrinking. The targeted invocation of a nested witness also
uses the retained input without shrinking; other enclosing-case execution
follows the normal replay policy described above.
Replay requires a lossless, versioned input codec; diagnostic assertion
serialization is not a replay codec. Unsupported or incompatible inputs must
produce an explicit replay error rather than a lossy substitute.

Supported standard values have built-in codecs that preserve shared references
and cycles. Replay restores the input graph, including aliasing, rather than
duplicating shared objects or cutting back-references. The initial set covers
null, undefined, booleans, strings, numbers including non-finite values and
negative zero, bigint, ordinary mutable arrays including holes, plain and
null-prototype records, Date including invalid dates, RegExp, Map, Set,
ArrayBuffer, typed arrays, and DataView. Shared backing stores, offsets, Map
iteration order, and RegExp `lastIndex` are part of the preserved state.

The wrapper must supplement or reject transformations that lose state.
`devalue`'s default RegExp encoding omits `lastIndex`, so the built-in regex
codec records it explicitly. Node Buffer requires an explicit codec; treating
it as Uint8Array is not lossless. Functions, symbols, proxies, accessors,
nonstandard property descriptors, and unsupported native brands are outside
the default set. Default encoding must not invoke getters or silently discard
state. Custom codecs may support additional values by reconstructing them from
supported data, within the same supervision and purity contract.

A generator producing a custom type supplies an explicit versioned codec with
encode and decode operations.
Decoding reconstructs the type and preserves behavior, values, and any identity
relationships the generator promises. Codec payloads are validated before
replay; custom class instances are never silently reduced to plain objects.
Codec failures retain the property failure and report that its witness is not
replayable when a failure has already been established; before that point they
are execution errors, never rejected or passing trials. `defineCodec(...)`
constructs an ordinary versioned codec value;
`generator.withCodec(codec)` attaches it to the complete generated input.
Every trial captures and decodes its input before executing the body, including
passing trials, shrink candidates, and confirmations. The body receives its
original generated input; the validation reconstruction is discarded. Captures
precede body mutation and consume the existing work budget.
Codec callbacks are pure, synchronous, execute within the supervised property boundary,
and reconstruct the full input graph, including cross-component aliases.

A corpus entry containing only a decoded value can replay as a regression
without being shrinkable. Further shrinking requires retained compatible
generation state or explicit support from the generator for that value.

Replayable confirmed failures are automatically saved in the local corpus
under `runtimeStateDir/corpus`. Authors explicitly promote selected entries
into a checked-in regression corpus; a test run never promotes entries or
changes repository files automatically. Fresh CI runs replay the checked-in
corpus without depending on a restored local cache. Both corpora replay before
novel generation, and promotion preserves the input and its codec version.
The runner owns persistence outside the restricted property-body scope.
Property profiles name checked-in files or directories with `corpus.checkedIn`
(default `[]`). The local cache is partitioned by profile. Its default limits
are 1,000 entries, 64 MiB total, and 1 MiB per entry, configurable through
`corpus.localCache.maxEntries`, `maxBytes`, and `maxEntryBytes`.
Eviction retains the newest entries within both limits. Oversized entries are
diagnosed without caching; write failures are runner errors. Confirmation stays
within the existing shrink-work budget, including when shrinking is disabled.

Incompatible checked-in entries fail the run until explicitly migrated or
removed. Incompatible local cache entries are skipped with diagnostics.
Neither policy permits lossy decoding. Direct witness replay remains strict:
an incompatible witness reports a replay error. Corpus incompatibility is
distinct from a decoded regression input that executes and fails the property.

Successfully decoded checked-in regressions replay independently of current
generation limits. Narrowing a generator does not retire those regressions.
If the property no longer applies, an author must explicitly update or remove
the entry. Such inputs are direct regression trials; shrinking them requires
compatible generation state or explicit generator support under its current
constraints. An entry without that support remains a terminal counterexample.

Property witness payloads use the schema in
[Failure Artifacts](./failure-artifacts.md#witnesses-and-replay-artifacts).
Checked-in corpora contain the same encoded input and target identity in
versioned JSON entries, keyed to the owning case and nested invocation when
present. `overkill corpus promote <witness> --to <path>` and the runner-owned
`promoteWitness(...)` API expose the same explicit promotion operation.
Promotion verifies decoding and displays the selected input before writing the
chosen destination. No staging, commit, or push is part of promotion. Explicit
inspection and migration operations likewise belong to the runner; property
bodies receive no persistence capability.

Corpus entries are associated with stable case and invocation identities,
ordered deterministically within each phase, and saved atomically. Local
storage may deduplicate identical encoded inputs under the same target and
codec versions; phase counts describe actual executed trials. Checked-in
entries are retained until explicit editing or removal; the local cache
follows bounded runtime-state policy. Corpus changes do not consume or reseed
the new-exploration random stream. The stream derives from the run seed,
case/runtime identity, and stable invocation identity; witnesses record the
resolved property seed. Backends and collected policies are versioned so
identical context reproduces the same candidate sequence.

Corpus operations accept standalone witness files or a local cache index.
Inspection lists cache entry IDs; promotion and migration require `--entry <id>`
when reading an index. They create a new destination and reject existing files.
Custom codecs are selected explicitly with `--codec <module>` and optional
`--codec-export <name>` (default `default`), without collecting or executing tests.
Runner writers await a required `beforeWrite` preview callback before publication.

Profiles own default new-trial counts, growth/depth limits, edge and exhaustive
limits, traversal and shrink budgets, and existing timeout and process usage policies.
Explicit per-property settings are resolved and validated during collection;
they never bypass profile capability restrictions or hard supervision limits.
`sampleGenerator(generator, request)` previews fresh generated values using an
explicit seed, count, size, and depth. It uses the same bounded generation
contract, without executing the property body.

One declared property remains one engine case and one boundary assertion.
Trial phase, index, resolved seed, accepted/rejected counts, coverage, and
shrink termination belong to property result metadata and diagnostics, not
additional engine cases or frozen plan facts. Primitive constructors cover
bounded integers, floating-point values, bigint, booleans, strings, bytes,
constants, choices, arrays, tuples, records, and bounded recursive composition.
String limits use UTF-16 code units; generators can exercise lone surrogates
as well as valid Unicode. Byte generation uses owned Uint8Array storage.

The concrete constructor names are `gen.boolean`, `gen.integer`,
`gen.number`, `gen.bigint`, `gen.string`, `gen.bytes`, `gen.constant`,
`gen.array`, `gen.tuple`, `gen.record`, `gen.choice`, and
`gen.recursive`. Integer and bigint constructors require inclusive
`{ min, max }` bounds. Unconstrained `gen.number()` includes all IEEE
double values; explicit finite bounds exclude NaN and infinities.
Constants are scalar singleton domains. Record declarations are plain objects
or objects with a null prototype, with own enumerable string data fields;
every field is required. Empty records and tuples are valid,
while choices require at least one generator.

Length bounds contain both `minLength` and `maxLength`.
`maxSize` caps each declared string, byte array, and array independently;
unbounded constructor forms use `0..maxSize`. Explicit maxima intersect
that cap without relaxing declared minima. An excluded minimum exhausts
the active domain. Size caps describe generator constructors, not a graph
inspection of arbitrary mapped outputs. Pure transformations may expand
their source values.

Recursive composition uses `gen.recursive({ leaf, branch, maxDepth })`.
The branch callback receives the recursive child generator. A leaf has
depth zero, every expansion consumes one level, and the declaration's limit
intersects the active remaining depth. Child domains are compiled lazily
with that retained depth, including during dependent shrinking.

Generator construction snapshots bounds and component declarations without
running callbacks. Codec metadata attaches to the complete input:
`filter` preserves it; `map`, `flatMap`, and structural composition
clear inherited attachments. Attach the resulting input's codec afterward.

### Alternatives And Trade-offs

- Value plus shrinker: supports domain-specific extensions directly, but
  separate output shrinkers alone cannot recover generic `map` and `flatMap`
  dependencies. Keep it as a backend baseline when composition retains the
  necessary context. Reject making authors supply a second shrinker for every
  first-party composition.
- Lazy generation trees: retain source candidates for mapped and dependent
  composition. They fit the contract, but branch rebuilding and retained
  state need memory bounds; they do not establish global minimality.
- Typed choice traces: rerun generation from reduced choices and can share
  reduction across generator shapes. They fit the contract, but changing
  dependent bounds and trace compatibility add complexity. Hypothesis uses
  this representation in its [internals](https://github.com/HypothesisWorks/hypothesis/blob/master/guides/internals.rst).
- Sampling-only custom generators: simpler extensions, but weaken integrated
  shrinking and input reconstruction. Excluded from the initial custom API;
  concrete regression examples remain distinct from generators.

Use `fast-check` behind Overkill's generator API.
Its public [`Arbitrary`](https://fast-check.dev/docs/api/classes/Arbitrary/)
generation and contextual shrinking operations supply the backend; its runner
does not own property execution. Overkill owns trial reconstruction, failure
identity, traversal budgets, finite-domain metadata, edge cases, targeted
search, corpus persistence, codecs, and reporting. Backend-specific types and
shrink state do not become the public generator or durable replay contract.

### Assumptions And Invalidation

The decision assumes pure generator callbacks, reconstructible inputs, and
bounded repeated property execution. Reconsider it if required custom
generators cannot meet those constraints, or all evaluated backends exceed
acceptable memory or runtime costs. An adapter for effectful property tests
must define trial isolation before claiming the same guarantees.

Compatibility validation requires fresh trial state,
dependency-preserving array/index shrinking, changing dependent element bounds,
non-injective mappings, impossible filters, recursive limits, mutation
isolation, deterministic candidate sequences, and lossless witness replay.
Measure candidate evaluations and peak retained memory on the same workloads.
Retained-memory validation uses isolated forced-GC checkpoints and reports the
maximum observed live heap above baseline with the checkpoint interval. This is
a sampled estimate, not an exact allocation peak or a portable byte threshold.

### Exhaustive domains and input coverage

Small enumerable domains run exhaustively when discovery completes within
`maxExhaustiveValues`. That limit bounds both candidate discovery and retained
domain entries; `maxRetainedInputs` bounds retained search inputs. Partial
discovery falls back to sampling without changing the sampling random stream.
Discovery consumes total work. Empty domains remain inconclusive.

Declare invocation-local `coverage: [{ label: 'positive', minimumPercent: 20 }]`
on `property(...)` or object-form `scope.forall(...)`. Observe inputs with
`sample.cover('positive', value > 0)`. Each label counts at most once per trial;
repeated observations combine with OR and missing observations count as false.
Percentages are finite values from 0 through 100. Labels are unique and nonblank.

Coverage counts accepted exploration trials or distinct exhaustive values using
Node deep strict equality. Examples, corpus inputs, and automatic edges have
separate observations and cannot satisfy requirements. Unmet requirements stay
inconclusive even after exhaustive completion. Trial observers expire after
cleanup. Coverage labels are bounded by `maxLabels` per invocation.

### Targeted exploration

Call `sample.target('distance', -distance)` to guide subsequent exploration
toward smaller distances. Scores must be finite numbers; larger scores win.
Repeated calls for one label use the trial maximum. Missing observations
supply no score. Labels must be nonblank strings. Targeting and coverage share
`maxLabels`, including declared coverage labels. Observers expire after cleanup.

Only passing new exploration trials supply guidance. Corpus inputs, examples,
and automatic edges do not seed the search. Exhaustive traversal is unchanged.
Search alternates fresh generation with mutations of retained generation choices,
regenerating through the original generator to preserve its domain.
`maxRetainedInputs` bounds per-label champions and `maxWork` bounds search work.
Failing to improve a score never invalidates completed passing trials; required
coverage remains a separate condition.

### Generator Preview And Relation Contract

Preview requires a bigint seed and nonnegative safe-integer count, size, and depth.
A standalone preview uses a fixed 10,000-unit work budget and an independent,
versioned random stream. It returns exactly count samples in a shallow-frozen
array or throws RangeError on domain or work exhaustion. Zero count evaluates no
callbacks. Repeated values are valid. Callback errors propagate unchanged.
Preview executes no property bodies, codecs, corpus replay, or shrinking.
Work bounds cover traversal and reconstruction, not arbitrary callback code or
mapped output allocations.

`relation({ transform, run, check })` returns a PropertyBody for property or
nested forall use. All callbacks may be asynchronous. Execution awaits transform,
run on the original input, run on the transformed input, then check, sequentially.
Run and check receive the property-local sample scope. Cancellation is checked
before each callback; cleanup follows normal trial lifecycle.

Check receives original and transformed observations, each containing its actual
input and output after execution. No cloning occurs; authors provide independent
branches when mutation requires isolation. Shrinking and replay retain the original
input and recompute the relation. Existing property machinery owns settings,
examples, coverage, codecs, witnesses, errors, and the single assertion boundary.

## Model-Based Testing Resolution

`@overkill-dev/model` is an optional package above the property core. It uses
property profiles and capability restrictions. It generates sequential valid
operation traces, not concurrent histories or resource-backed integration runs.
Differential testing and linearizability retain their separate package ownership.

`model` creates a property-family case. `modelScenario` returns a property
invocation for direct or nested composition and generator preview. Operations
are ordinary typed data; there is no command registry or foreign runner.
Definitions supply pure initial-state, state-dependent command-generator, and
transition callbacks. Transitions return enabled next states or disabled results.
Generation and shrinking preserve enabled transitions; disabled commands never
silently disappear during execution. A null command generator denotes terminal
state. Length bounds intersect property size policy without relaxing minima.

Every evaluation reconstructs independent prediction and system operation graphs.
The property sample scope exposes `reconstructInput()` through
`PropertySampleScope<Value>`. Retained recipes regenerate new inputs or decode
stored ones; reconstruction charges property work and expires with the trial.
Factories and transitions obey the existing purity and fresh-graph contract.

Validate the entire predicted trace before system creation. Check the initial
system and each completed operation, then finish ordinary trial cleanup. Checks
use existing assertion semantics. Invalid stored or explicit traces fail with an
indexed applicability error before system creation. Stored traces remain runnable
outside current generation length bounds and replay without command generators.

Reuse property phase accounting, failure identity, shrinking, confirmation,
codecs, corpora, witnesses, and supervision. One model remains one collected case
and one property boundary assertion. No new CLI, test family, or witness format
is introduced. Data operations avoid registry identities and command-specific
replay compatibility; authors dispatch their operation unions explicitly.

## Differential Testing Resolution

`@overkill-dev/differential` is a separate optional install above the property
core. `differential({ implementations, check })` returns `PropertyBody<Input>`
for `property` or nested `scope.forall`. It introduces no test family, CLI,
configuration extension, or witness format.

Implementations are an ordered readonly tuple of at least two named run
callbacks sharing input and output types. Names are unique nonblank strings.
Construction validates and snapshots the declaration without running callbacks.
Each run receives a fresh `sample.reconstructInput()` graph and the trial abort
signal. Runs settle sequentially in declaration order. Reconstruction charges
ordinary property work and remains outside outcome capture.

Outcomes are `{ kind: 'returned', value }` or `{ kind: 'threw', error }`.
Capture ordinary synchronous throws and asynchronous rejections, but propagate
permission denials and engine control signals unchanged. Check cancellation
before reconstruction and execution, after settlement, and around comparison.
The engine exposes `isTestControlError(error)` for package-owned catch boundaries.

The required check receives ordered observations with name, actual input after
execution, and outcome, plus `PropertySampleScope<Input>`. It returns the usual
assertion result. Equivalence is explicit, including expected errors; identical
throws do not automatically pass. Check errors retain body-error semantics.
Observation containers are shallow-frozen; input and output graphs remain intact.
Shared external mutable state remains the author's responsibility.

Property owns examples, coverage, settings, codecs, phase accounting, shrinking,
confirmation, corpora, witnesses, cleanup, and supervision. A differential property
counts as one case and one boundary assertion. Replay restores inputs and reruns
current implementations; captured outcomes are not replay payloads. Checks may
use `sample.failureKey` when automatic assertion identity is too broad.

## Linearizability Checking Resolution

`@overkill-dev/linearizability` is an optional package above the model layer.
`checkLinearizability({ history, model, maxWork, signal })` checks an ordered
invocation/response event log. Unique invocation IDs pair responses; missing
responses are pending. Event order establishes real-time precedence.

The observation-driven pure model reuses enabled/disabled `ModelTransition`
results and adds explicit alternative next states. Every completed operation
must fit a sequential explanation. Pending operations may be omitted or included
with model-approved effects. Callbacks preserve input and branch state graphs.

The asynchronous bounded search returns linearizable, not-linearizable only on
exhaustive rejection, or inconclusive on work exhaustion. It charges candidate
inspection, transition calls, and successor exploration separately, yields every
256 units, propagates cancellation and model errors, and rejects malformed input.
Diagnostic prefixes are not minimal counterexamples. See the package readme for
the exact public contract and work-accounting limits.

The `linearizability(...)` helper owns concurrent operation execution
and recording. Property continues to own shrinking, witnesses, corpora, reporting,
and supervision; this checker adds no parallel infrastructure or test family.

### Concurrent Operation Authoring

`linearizability({ create, run, model, maxWork })` returns a
`PropertyBody<LinearizabilityProgram<Operation>>`. Programs are readonly arrays
of readonly operation arrays. Lanes execute concurrently; operations within each
lane execute sequentially. Empty programs and lanes are valid.

`create(sample)` creates a fresh system for each trial and registers teardown
with `sample.cleanup`. `run(operation, system, signal)` returns an output or a
promise. Ordinary throws become recorded outcomes. Cancellation, permission
denials, and engine control errors stop admission, abort the helper signal, and
drain admitted work before propagation. Existing timeout supervision may interrupt
uncooperative work and run cleanup without waiting for it.

Execution and model observations use independently reconstructed operation graphs.
Models are pure; returned output graphs must remain stable after settlement.
Event order, including synchronous returns and throws, determines precedence.
The checker budget is separate from property traversal work.

Linearizable histories pass, exhaustive rejection fails with bounded history and
checker diagnostics, and checker exhaustion calls `sample.inconclusive(reason)`.
This trial-local control requires a nonblank reason. Existing failures take
precedence; inconclusive confirmation or shrinking cannot erase an established
failure or create an unconfirmed witness.

Use ordinary property generators, examples, codecs, corpora, and nested `forall`.
Witnesses preserve lane inputs, not event-loop timing. Replay reruns current code;
property confirmation reports failures that do not reproduce. Property profile
capability and resource restrictions remain unchanged.
