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

That still needs a scope boundary:

- the first-party browser story should start with running tests in real
  browsers
- page-object-heavy and end-to-end-style flows are important, but they
  should be framed as richer adapter-driven layers rather than as the
  default meaning of "browser testing"

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

- first-party support for browser-executed tests
- adapter/integration support for richer browser-automation stacks
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
selection. Browser, integration, benchmark, and mixed-family runs are rejected
before test collection. Installing the plugin does not activate mutation testing
in ordinary runs. The adapter selects an existing microtest profile; no second
profile or duplicated discovery policy is required. When exactly one microtest
profile exists, its name is optional in Stryker's adapter configuration. When
there are several, an explicit name is required. No eligible profile, an unknown
name, or selection of a non-microtest profile fails before collection.

### Execution And Coverage

- Mutation execution has an explicit adapter-owned policy: serial cases.
  Preserve the configured profile's process model and
  restrictions. Stryker parallelizes mutants. Resolve and expose the scheduling
  override before running; no dedicated mutation profile is required.
- Reuse the profile's discovery, loader, capability restrictions, and resource
  policies. Keep ordinary V8 coverage disabled and disable retries and baseline
  updates. Use one campaign seed across the dry run, all mutants, workers, and
  worker replacements. Accept an explicit seed or generate one once for the
  campaign and expose it for reproduction. Derive case seeds from that seed and
  stable executable identity, independently of scheduling and filtered selection.
- Freeze authoritative discovery, loader declarations, selection, permissions,
  and resource policy during unmutated initialization. Exclude configuration,
  test definitions, and adapter code from mutation targets. If configuration is
  evaluated again with a static mutant active, reject conflicting policy facts;
  unchanged test IDs alone are insufficient validation.
  Resolve policy outside the execution module graph and transport the frozen
  facts into execution hosts. Worker initialization must not import user
  configuration or its dependencies into that graph before the invocation's
  activation mode is established. This also applies to replacement workers.
- Performance is the default priority. The Stryker adapter's `freshState`
  configuration defaults to `false`. Normal in-process runs reuse the loaded
  module graph and assume the suite can be rerun in the same process. Persistent
  caches can affect mutation results; document that limitation explicitly.
  Setting `freshState: true` resets the complete transitive module graph and
  mutable state for every invocation, accepting startup and collection cost.
  Do not implement freshness with import URL query parameters.
- Initialize the Stryker namespace inside the process that executes instrumented
  code. For static activation, activate before importing any user configuration
  or test modules. For runtime activation, collect without an active mutant,
  then activate before executing cases. Honor Stryker's activation mode and
  hit limit through its instrumented runtime contract.
  Reset invocation counters, hit-limit state, active mutation, and current test
  identity at their lifecycle boundaries. Preserve namespace and counter-object
  identities retained by instrumented modules in a reused graph. Clear active
  mutation and test identity when an invocation ends, including error paths.
- During the dry run, set Stryker's `currentTestId` at the local, awaited case
  start boundary and clear it after case completion, including scope cleanup.
  Reads outside a case remain in Stryker's static coverage bucket. Parent-side
  events received through IPC are too late to control child-side attribution.
- Return Stryker's mutant counters, not V8 coverage. This is private adapter
  data, separate from Overkill's aggregate coverage artifacts. Support Stryker's
  `perTest`, `all`, and `off` modes; the normal optimized path is `perTest`.
  Static or uncertain attribution requires the full eligible suite. Never infer
  `NoCoverage` from missing transport data, missing tests, or ordinary coverage.
- Honor both the profile's per-case timeouts and Stryker's invocation deadline;
  the earlier applicable limit wins. The invocation deadline covers startup,
  collection, execution, and cleanup. Stryker owns enforcement against its
  plugin worker, including a synchronous infinite loop. Terminate and reap
  adapter-owned execution hosts on timeout or disposal. Unrelated processes
  remain outside that ownership boundary. Disable Overkill retries; Stryker
  retains ownership of its infrastructure recovery.

### Reporting And Persistence

Stryker owns campaign output and reports. Mutation invocations suppress ordinary
Overkill reporters, including configured custom reporters. Adapter-owned
reporting collects structured results, failures, and counters in memory without
disabling test checks.

Overkill writes nothing to disk by default during mutation invocations: no run
records, results, duration history, artifacts, or reports. Stryker's sandbox and
campaign reports remain governed by Stryker's configuration.

One adapter artifact-persistence setting supports `off`, `failures`, and `all`,
defaulting to `off`. Opt-in persistence saves available diagnostic artifacts and
transcripts with campaign, mutant, invocation, and case identity. It does not
enable ordinary Overkill reports, run records, or duration-history persistence.
`failures` means failed test invocations, including killed mutants, timeouts,
execution errors, and failed dry runs; surviving mutants are included by `all`.

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

The native-observation implementation merged in
[PR #531](https://github.com/enormora/overkill/pull/531) removes process-method
patches. It does not make diagnostics case-local: out-of-test console output and
new IPC listeners can still produce run errors while observation is active.
Fresh-state and supervised execution separate those activities by process.
Normal in-process execution must preserve their ownership within a shared worker.

### Identity And Result Contract

Dry-run collection establishes the eligible test catalog and fixed selection.
Normalize sandbox file origins to canonical project-relative paths. Encode
`CaseId` structurally, including parameter identity; display names and source
positions are presentation data. Use the complete executable identity when a
valid microtest plan distinguishes executions of the same logical case; never
collapse distinct `WorkId` values into one Stryker ID. Other test families and
their runtime or workload features remain outside this integration's scope.

Each invocation validates its executable catalog against that catalog and runs
Stryker's requested IDs exactly. An absent filter means the complete eligible
suite; an explicit empty filter means no tests. Unknown IDs, duplicate IDs,
changed case identities or selection metadata, or a requested test becoming
skipped are adapter errors, never successful survival. Empty mutant selections
execute nothing and return an error rather than claiming survival or coverage.
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
Stop scheduling further cases after a confirmed kill unless Stryker's
`disableBail` requests complete execution. Finish admitted work, case cleanup,
observer shutdown, and final result delivery before returning the kill. Cases
not executed because of this explicit early stop do not become missing-result
errors. Report the actual executed count and confirmed killing IDs.

The dry run must establish the complete eligible catalog. An intentionally
skipped case is reported as skipped during the dry run and never demonstrates
a kill.
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

### Assumptions And Release Gates

This resolution preserves the concept's microtest-only scope, API-first
boundary, stable identity model, and aggregate V8 coverage policy. Mutation
execution is a separate, explicitly reported orchestration policy.

Current code has exact `case-id` filters, structured outcomes, awaited local case
events, and supervised processes. It does not yet expose the complete public
adapter lifecycle: initialization before user imports, child-local attribution,
counter transport, and execution of a collected plan without importing again.
Provide the smallest reusable runner extension needed for that lifecycle.
Each invocation needs fresh scopes, observers, and result collection even when
it reuses an already collected plan and module graph. Selection applies to the
frozen eligible catalog without reimporting modules merely to rerun cases.
Keep Stryker types, globals, and score semantics inside the adapter package.

Before release, demonstrate sandbox-relative and parameterized IDs, runtime and
static activation, exact filtered execution, worker reuse, opt-in state reset,
capability enforcement, counter delivery, and complete timeout termination on
the repository's pinned Node version. Compare optimized results against full
suite results on repeatable representative suites. Measure worker-reuse and
fresh-state costs separately, including startup, collection, and test execution.

Probes with the published Stryker 10 instrumenter confirmed counter attribution,
activation timing, and transitive ESM cache behavior. On Node 26.10, a covered
arithmetic mutant remained hidden by a cache in a reused graph and became
observable in a fresh process. Current Overkill policy also preserved native
process methods and removed its observation listeners after completion. These
are focused probes, not end-to-end adapter validation. Release validation must
also exercise native early exit, abort, and result-less termination, preserving
the configured process model's documented observation gaps.

Revisit this answer if those checks show incorrect selection, if maintaining
restrictions requires private engine imports, if process startup removes the
benefit of opt-in reset, or if Stryker no longer supports the project's toolchain.
Changing vendors would reopen the concept's first-party Stryker commitment;
it is not an adapter implementation detail.
