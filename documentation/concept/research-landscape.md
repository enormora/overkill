# Research Landscape

## Purpose

This document is not a market survey. It records the ideas that materially influence the Overkill concept and the ones that should be rejected.

## Mainstream JavaScript and TypeScript

### Jest and Vitest

Useful lessons:

-   broad ecosystem adoption makes APIs familiar
-   multiple reporters and snapshots are practical necessities
-   serializer and matcher extension points are valuable
-   stale snapshot detection is a real requirement, not polish

Costs that Overkill should resist:

-   heavy dependence on magic around module behavior
-   encouraging module mocking as the path of least resistance
-   a tendency for the easiest API to hide the most important execution details

Sources:

-   <https://jestjs.io/docs/snapshot-testing>
-   <https://vitest.dev/guide/snapshot.html>

### Mocha and uvu

Useful lessons:

-   library-first composition ages well
-   directness matters
-   tiny runners can stay understandable

Costs:

-   globals and legacy shape in Mocha
-   incomplete modern story around typed runtimes, reporters, and orchestration
-   dormant ecosystem risk in very small tools

### node:test, Deno, and Bun

Useful lessons:

-   test registration at module load time can keep the authoring model simple
-   direct runtime execution is a credible workflow
-   seeded randomization is normal enough to be a first-class feature
-   single-process execution can still be a good default

Costs:

-   built-in runners tend to optimize for generality rather than a strong opinionated model

Sources:

-   <https://docs.deno.com/api/deno/~/Deno.test>
-   <https://bun.sh/docs/test>

## Browser and Environment-Centric Testing

### Playwright Test

Playwright Test is the most sophisticated testing system in mainstream JS today. It is worth studying both for what to copy and for what to deliberately diverge from.

#### Fixture System

`test.extend({ ... })` builds typed fixture sets. Each fixture is `async ({ deps }, use) => { setup; await use(value); teardown }` — a coroutine where `await use(value)` is the yield. The runner parses parameter destructuring of every callback (test body, fixture, hook), builds a dependency DAG, instantiates only the requested subgraph lazily, and tears down in reverse order.

Two scope axes: `'test'` (default; setup per test) and `'worker'` (setup once per worker process). Worker fixtures act as global before/after hooks per worker but survive file boundaries when worker reuse kicks in.

What this proves:

-   typed parameter-injected DI scales to large codebases
-   coroutine setup/teardown beats paired hooks because teardown can never be orphaned
-   lazy instantiation eliminates "load-everything" overhead
-   `auto: true` fixtures are the right escape hatch for cross-cutting tracing

What this costs:

-   wiring is by string literal — VS Code rename does not propagate from `test.extend` keys to consumer destructuring; silent breakage
-   without explicit generics, parameter names are not type-checked at all
-   fixtures cannot be accessed from `describe` for data-driven loops without a `for` outside the suite
-   `auto: true` plus `option: true` plus `scope: 'worker'` overload one tuple shape; the API is dense

Overkill direction:

-   keep the lazy DAG and coroutine lifecycle
-   replace string-name wiring with **symbol-keyed** fixtures (`fixture(authedApi)` imported, not destructured by name) so refactors propagate
-   keep the tuple form's option pattern but do not normalize `auto: true` as the place to put cross-cutting reporters

#### Projects, Project Dependencies, And Project Teardown

Projects are top-level matrices. Each project has its own `use` (fixtures and config), `testMatch`, `testIgnore`, `fullyParallel`, `retries`, and crucially:

-   `dependencies: ['setup']` — must complete (and pass) before this project starts
-   `teardown: 'cleanup'` — runs after this project AND its dependents finish

The big idea: **setup is a project, not a hook**. `globalSetup` collapses into "a project that other projects depend on." Setup gets traces, fixtures, retries, parallelism, structured reporting "for free" because it is a real test.

This generalizes Buster's `extends` and pytest's session fixtures into one orthogonal-axes model. Overkill should adopt this directly: there is no separate "global setup file" concept; setup is a tagged subset of the same test graph.

#### Sharding And Parallelism

Three independent layers:

1.  **workers** — per-machine processes (`workers: 4`)
2.  **fullyParallel** — distributes individual _tests_ to workers, not files; without it, file is the scheduling unit
3.  **shards** — `--shard=1/3` deterministic partition across machines; `blob` reporter + `merge-reports` post-hoc

The interaction with worker-scoped fixtures: worker fixtures setup _once per worker process_, not per shard. A 4-shard × 4-worker run pays setup cost 16 times. Worker reuse across files happens only when worker-fixture parameters match — implicit invalidation rules that surprise users.

`describe.configure({ mode: 'serial' })` collapses retry semantics: a serial group retries together. This is the only way to express "these tests share mutable state and must run in order."

Overkill direction: name the three axes explicitly (workers × fullyParallel × shards). Document them as orthogonal. See `runtime-behavior.md` for the resulting parallelism table.

#### Auto-Waiting / Polled Assertions

`expect(locator).toBeVisible()` is **not** a point-in-time check. It polls the live DOM until the predicate passes or the assertion timeout elapses. This makes the assertion _temporal_: "this becomes true within N ms," not "this is true now."

`expect.poll(fn).toBe(value)` and `expect(async () => { ... }).toPass()` generalize the pattern outside UI testing.

Transferable kernel: any async invariant — cache populates within 500ms, queue drains within 2s, metric reaches threshold — is more honestly expressed as a polled assertion than an awaited delay plus point check. Overkill should ship `assertEventually(predicate, { timeout, intervals })` as a first-class assertion alongside the synchronous variants.

#### Trace Viewer And Trace Format

Traces are zip files containing screenshots, network requests, console output, DOM snapshots before/after each action, source-mapped action timeline, and `expect` calls. Configurable via `trace: 'on' | 'on-first-retry' | 'retain-on-failure' | 'off'`.

The viewer is a static HTML page (`trace.playwright.dev`) that opens the zip locally — no server, no upload. The trace format is open and stable enough that CI artifacts can be linked directly.

Overkill direction: failure artifacts should be **single self-contained zip files per failed test**, not scattered logs/screenshots/diffs across directories. A static viewer that opens the zip locally beats any cloud upload story. See `failure-artifacts.md`.

#### Reporters API

Lifecycle: `onBegin`, `onTestBegin`, `onStepBegin`/`onStepEnd` (recursive — steps form a tree per test), `onTestEnd`, `onError`, `onStdOut`/`onStdErr`, `onEnd`, `onExit`. Step categories distinguish library-emitted steps (`expect`, `fixture`, `hook`, `pw:api`) from user-emitted (`test.step`, `test.attach`).

Built-in reporters: `list`, `line`, `dot`, `json`, `junit`, `html`, `github`, `blob` (mergeable from shards).

Transferable kernel: a flat "list of test results" is too coarse. The per-test tree of typed steps with attachments is the right shape. Overkill's reporter contract should preserve the step tree.

#### Soft Assertions And `expect.soft`

```ts
await expect.soft(page.getByTestId('status')).toHaveText('Success');
await expect.soft(page.getByTestId('eta')).toHaveText('1 day');
```

Failing soft assertions accumulate on `testInfo.errors` rather than throwing. The whole test runs; the test ends failed with N errors.

Caveat: soft is bolted on as a flag on the matcher chain, not a different
type. Overkill should make aggregation explicit rather than a hidden matcher
suffix. The chosen direction is:

-   builder-style `assert.*` for recorded non-gating assertions
-   builder-style `require.*` for gating assertions and narrowing
-   explicit aggregation blocks such as `assert.all(() => { ... })` when a
    suite wants "run all" semantics

That keeps the richer result protocol without making soft or non-fail-fast
behavior the invisible default. See `assertions-and-results.md` and
`results-not-exceptions.md`.

#### Annotations And Verdict Modifiers

```ts
test.fail('not yet ready', body); // xfail — runs; warns if it passes
test.fixme('to be fixed', body); // skip with intent
test.slow(condition, 'reason'); // 3× timeout multiplier
test.info().annotations.push({ type: 'issue', description: 'ABC-123' });
```

`test.fail` is not a skip — it is xfail (test runs; flips verdict). Annotations are first-class metadata accessible to reporters via `testCase.annotations`.

Overkill direction: verdict modifiers belong on the test descriptor as fields, not as imperative side-effecting calls. See `metadata-and-selection.md` § stability markers and `glossary.md` § verdict.

#### `test.step` And Attachments

```ts
test('checkout', async ({ page }, testInfo) => {
    await test.step('login', async () => {
        /* ... */
    });
    await test.step('add to cart', async (step) => {
        await step.attach('cart', { body: ss, contentType: 'image/png' });
    });
});
```

Steps are nestable, named, and appear in the trace and HTML report as the natural "what was the test doing when it failed?" structure.

#### What Playwright Does Less Well

-   `expect` matchers are narrower than Vitest's; users stack libraries
-   parameter-name injection breaks rename refactors silently
-   project config interactions (`fullyParallel`, `dependencies`, `teardown`, `use`, `testMatch`) are non-obvious
-   worker-reuse rules across files depend on worker-fixture parameter equality — surprising invalidation
-   `test.use` for fixture override is positional and untyped against the project's options shape unless authors thread types manually

Sources:

-   <https://playwright.dev/docs/test-fixtures>
-   <https://playwright.dev/docs/test-projects>
-   <https://playwright.dev/docs/test-global-setup-teardown>
-   <https://playwright.dev/docs/test-parallel>
-   <https://playwright.dev/docs/test-sharding>
-   <https://playwright.dev/docs/actionability>
-   <https://playwright.dev/docs/test-assertions>
-   <https://playwright.dev/docs/trace-viewer>
-   <https://playwright.dev/docs/api/class-reporter>
-   <https://playwright.dev/docs/test-annotations>
-   <https://playwright.dev/docs/api/class-testinfo>

### Folio

Folio is the Playwright-team predecessor you were referring to. It described itself as a customizable framework for building higher-level test frameworks, and later fed into Playwright Test.

Its most important lessons for Overkill are:

-   the framework should expose a builder layer, not only a finished DSL
-   fixture and runtime composition can produce a custom exported test API
-   higher-level packages can be built from a reusable lower-level engine

That maps closely to Overkill’s desired split between `@overkill/engine`, first-party DSLs, and resource packages.

Sources:

-   <https://github.com/microsoft/folio>
-   <https://www.infoq.com/news/2020/11/microsoft-playwright-test-runner/>

## Historical Modular Systems

### Buster.JS

Buster.JS (Christian Johansen + August Lilleaas, ~2010-2013, archived 2018) was extreme in modularity. The package graph included `buster-test`, `buster-assertions` (later `referee`), `buster-eventedlogger`, `buster-test-cli`, `buster-format`, `buster-stack-filter`, `buster-static`, `buster-publishing`, `buster-html-doc`, `ramp` (browser automation), `capture-server`, `buster-resources`, `buster-server`, `buster-bayeux-emitter`. Each module had its own README, version, and could be used independently.

#### Generic Substrate, Not Test-Specific

Critical insight: `ramp` and `capture-server` had **no concept of "a test."** They orchestrated browsers loading resource sets and streaming events back. A test run was one application of that substrate. A synced slideshow across devices was another POC. This is the cleanest separation of "test infrastructure" from "test concept" in JS history.

For Overkill: package families like `@overkill/transport`, `@overkill/event-stream`, and `@overkill/identity` should be substrate that doesn't know about tests. The test-aware layer composes them.

#### Tests As An Event Stream From Day One

`buster-eventedlogger` modeled the entire test run as an event stream: `test:start`, `assertion:pass`, `test:complete`, `suite:complete`, `run:complete`. A reporter was a subscriber. A network reporter was just a subscriber that pushed events over Bayeux (HTTP long-poll, websockets where available). Local and remote reporters shared zero code. This is exactly the pattern that landed in Playwright reporters ten years later.

For Overkill: an evented reporter pipeline with a pluggable transport (in-process, IPC, WebSocket) means the same reporter works locally and against a remote runner. See `package-architecture.md` and `extensions-and-plugins.md`.

#### Configuration That Anticipated Playwright Projects

```js
config['Browser unit']        = { environment: 'browser', sources: [...], tests: ['test/unit/**'] };
config['Browser integration'] = { extends: 'Browser unit',  tests: ['test/integration/**'] };
config['Node']                = { environment: 'node',    tests: ['test/node/**'] };
```

Named groups, each with an `environment`, `libs`/`sources`/`tests`/`resources`, `extensions`, and `extends` for inheritance. **This is Playwright projects, six years earlier.** The matrix-of-environments idea was Buster's.

#### Controllable Test Start Timing

`autoRun: false` plus explicit `buster.run()` lets the test author gate the start of the run — useful when AMD modules are still loading, when async setup must complete, when a service worker must register. The runner doesn't auto-start; the bootstrapper says "go."

For ESM with `await import()` and dynamic registration, the explicit-start pattern is more honest than today's "tests fire on load" assumption. Overkill's tests-as-values shape (see `tests-as-values.md`) takes this further: the file _exports_ the suite, the runner starts walking when ready.

#### Static Browser Runs

`buster-static` generated a static `index.html` plus a bundle to a directory; you opened it in any browser and tests ran. No daemon, no capture step, no WebSocket plumbing. Cypress later commercialized this pattern as "open mode." Karma went the opposite direction (always a server). Buster realized you can ship a folder.

#### Why Buster Died (And What To Avoid)

1.  **Stuck in beta** — no 1.0 ever shipped. Issue #171 (multi-config) milestoned for 1.0 in 2012, archived 2018 unfixed.
2.  **Capture-server friction** — users had to install a server, run it, capture browsers manually before tests could run. Karma did the capture automatically; PhantomJS made headless trivial. Buster's killer feature became its onboarding cliff.
3.  **Too modular** — 14+ packages with cross-version drift. A `buster-test` bug needed coordinated releases across half the ecosystem.
4.  **One-author bottleneck** — Christian Johansen put his maintenance attention into Sinon (which lives) and consultancy work; rough edges (hung hybrid Node+browser test runs) stayed rough.
5.  **Headless+Jest wave** — 2014-2016 brought Jest, headless Chrome, jsdom. Buster's evented capture model became a curiosity.

Survivors: **Sinon.js** (decoupled from Buster years ago, alive at sinonjs.org) and **referee** (assertions, low traffic but in the `sinonjs` org). Concepts (evented reporting, generic-substrate-not-aware-of-tests, multi-environment named groups, static HTML test runners, controllable run start) exist in modern frameworks individually; none recombines them.

#### Lessons For Overkill

-   modularity is right, but ship as **one cohesive workspace with one version line** — Buster's lesson, painful version
-   substrate first, test-aware second — keep `@overkill/transport`, `@overkill/event-stream`, `@overkill/identity` substrate generic
-   evented reporting is the right shape, but typed
-   onboarding must be `git clone && npm i && overkill` in 60s — anything else fails

#### What To Reject

-   Buster also normalized hooks, globals, and Sinon-centric mocking. Overkill rejects all three.
-   the AMD-era extension model (`buster-amd`, `buster-resources`) is obsolete; ESM is the right substrate

Sources:

-   <https://busterjs.readthedocs.io/en/latest/>
-   <https://busterjs.readthedocs.io/en/v0.6.x/overview/>
-   <http://docs.busterjs.org/en/v0.6.x/developers/architecture/>
-   <https://github.com/busterjs/buster-test>
-   <https://github.com/busterjs/ramp>
-   <https://github.com/busterjs/buster-static>
-   <https://sinonjs.org/>

## Cross-Language Testing Models

### DSL Shapes Are More Diverse Than TDD vs BDD

The biggest DSL lesson from outside mainstream JS is that the interesting
design axis is usually **not** whether the surface says `describe()` or
`context()` or `it()`. The deeper choices are:

-   how tests are discovered
-   whether tests are side effects or values
-   whether examples, properties, models, and docs are separate families
-   whether setup is hidden lifecycle machinery or ordinary composable code

Across ecosystems, at least these distinct DSL families show up:

-   **function or attribute discovery**
    -   Rust `#[test]`
    -   Go `TestXxx`, `BenchmarkXxx`, `FuzzXxx`, `ExampleXxx`
    -   JUnit `@Test`, `@ParameterizedTest`, `@TestFactory`
-   **registration DSLs**
    -   Jest, Vitest, Mocha, ExUnit
-   **tests-as-values / tree DSLs**
    -   Haskell `tasty`
    -   RackUnit suites as values
-   **submodule-based colocated tests**
    -   Racket `module+ test`
-   **documentation/example DSLs**
    -   Go `ExampleXxx`
    -   Rust doctests
-   **property / model / relation DSLs**
    -   QuickCheck-style properties
    -   model-based testing DSLs
    -   metamorphic relations

Overkill should therefore avoid treating TDD/BDD trees as the only serious
shape. The architecture should be able to host multiple authoring families
that lower into one engine model.

### Go

Go’s table-driven style remains one of the clearest examples of low-magic testing. The `Run` model shows that parameterized or grouped execution does not require a large hierarchy system.

Source:

-   <https://go.dev/blog/subtests>

Go also demonstrates a more radical idea that JS frameworks often underuse:

-   tests
-   benchmarks
-   fuzz targets
-   executable examples

are separate top-level DSL families, not just modifiers on one universal
`test()` primitive. That separation gives clearer execution policy and
clearer user intent.

### Rust

Rust shows two valuable things:

-   a simple failure model based on panic or explicit `Result`
-   a compiler-supported path toward custom harnesses

That supports Overkill’s decision to keep the core outcome contract flexible rather than forcing one assertion system.

Sources:

-   <https://doc.rust-lang.org/rust-by-example/testing/unit_testing.html>
-   <https://doc.rust-lang.org/nightly/unstable-book/language-features/custom-test-frameworks.html>

Rust doctests are another important reminder that documentation examples are
their own DSL family with their own tradeoffs. They should not be modeled as
ordinary unit tests by default.

Source:

-   <https://doc.rust-lang.org/rustdoc/write-documentation/documentation-tests.html>

### Racket and RackUnit

Racket contributes two especially relevant ideas.

#### `module+ test`

Racket's `module+ test` submodule is a colocated-but-not-runtime-loaded test
model. Importing a module normally does not run its tests. `raco test`
discovers and runs the `test` submodule instead.

This is one of the cleanest answers to "how can tests live near the code
without polluting the runtime loading story?" It is a much more disciplined
shape than true in-source test blocks.

For Overkill, the lesson is not "copy `module+` syntax". The lesson is that
**colocation and runtime separation can coexist** if the module system owns
the distinction.

Sources:

-   <https://docs.racket-lang.org/guide/Module_Syntax.html>
-   <https://docs.racket-lang.org/raco/test.html>

#### RackUnit Suites As Values

RackUnit also validates tests-as-values directly. A test suite is a value,
and the API explicitly distinguishes between syntax forms that run checks
immediately and suite values that are built and later executed.

This is very close to the direction documented in
`tests-as-values.md`.

Source:

-   <https://docs.racket-lang.org/rackunit/api.html>

### Haskell `tasty`

`tasty` is the strongest mainstream precedent for explicit test trees.

The important type is:

-   `TestTree`

and providers such as `tasty-hunit`, `tasty-quickcheck`, and others lift
their specific tests into that tree.

Conceptually the tree looks like:

```hs
testGroup "users"
  [ testCase "build" ...
  , testCase "validate" ...
  , testProperty "round-trip" ...
  ]
```

So the structure is:

-   named groups
-   leaf tests from different providers
-   one compositional tree consumed by the runner

This is exactly the kind of lower-level unification Overkill should preserve:
different authoring families can still lower into one execution tree.

Sources:

-   <https://hackage.haskell.org/package/tasty-0.6/docs/Test-Tasty.html>
-   <https://hackage-content.haskell.org/package/tasty-hunit-0.10.2/docs/Test-Tasty-HUnit.html>

### Swift Testing

Swift Testing is interesting because it combines:

-   parameterization
-   metadata and traits
-   stronger output ergonomics

The main transferable idea is trait-based test customization. The main non-transferable part is macro-heavy syntax.

Source:

-   <https://developer.apple.com/xcode/swift-testing/>

Swift Testing also proves that macro-based DSLs can make metadata and
parameterization feel lightweight without requiring a registration-tree API.
That is a distinct DSL family from both Jest-style registration and
tests-as-values.

### JUnit 5 and pytest

JUnit 5 and pytest both show that a framework can center on reflection,
attributes, decorators, and factory hooks instead of nested BDD trees.

Important ideas:

-   JUnit `@TestFactory` dynamic tests are produced by factory methods, not
    only by fixed annotations
-   pytest parametrization and `pytest_generate_tests` push test expansion
    into decorators and collection hooks
-   both frameworks make metadata and generation first-class without needing
    `describe()` as the universal grouping concept

This matters for Overkill because it suggests the DSL space is broader than
"tree of imperative registration calls" versus "flat test functions". There
is also a serious **factory / generation** axis.

Sources:

-   <https://docs.junit.org/5.10.1/user-guide/index.html>
-   <https://pytest.org/en/8.1.x/how-to/parametrize.html>

### ZIO Test

ZIO Test is one of the strongest references for composable test aspects. Timeout, retries, repeats, environment constraints, and execution strategy are modeled as transformations rather than special-case hooks.

This is a strong conceptual influence on Overkill’s modifier/trait layer.

Sources:

-   <https://zio.dev/reference/test/aspects/>
-   <https://zio.dev/reference/test/why-zio-test/>

## Snapshot and Baseline Systems

Snapshot systems in Jest, Vitest, and Playwright establish several baseline truths:

-   snapshots must be reviewable
-   updates must be explicit
-   CI should fail on stale or obsolete entries
-   custom serializers or domain adapters are necessary for real projects

Vitest is especially relevant because it now distinguishes custom serializers from domain-specific snapshot adapters. That supports Overkill’s idea of a broader baseline abstraction instead of a one-size-fits-all snapshot string model.

Sources:

-   <https://jestjs.io/docs/snapshot-testing>
-   <https://vitest.dev/guide/snapshot.html>
-   <https://playwright.dev/docs/aria-snapshots>

## Benchmarking and Performance Tooling

### JMH

JMH’s main lesson is humility: benchmarking requires harness support, controlled setup, and protection against measurement traps. It is not just a loop around a function.

The most important JMH concepts for Overkill are:

-   **forks** as an explicit isolation boundary
-   **warmup** versus **measurement** iterations
-   parameterized benchmarks
-   distinct run strategies for cold-start versus steady-state questions

JMH is also strong evidence that a benchmark DSL should make execution policy
part of the definition, not an afterthought.

Source:

-   <https://github.com/openjdk/jmh>

### Criterion.rs

Criterion.rs matters because it shows a modern benchmark harness can be both
ergonomic and statistically serious.

The most important concepts are:

-   benchmark groups
-   benchmark IDs and parameterized cases
-   throughput annotations
-   custom measurement backends

The custom measurement story is especially relevant to Overkill because it
points toward a benchmark API that is not hard-wired to wall-clock timing.

Sources:

-   <https://bheisler.github.io/criterion.rs/book/user_guide/advanced_configuration.html>
-   <https://bheisler.github.io/criterion.rs/book/user_guide/custom_measurements.html>

### BenchmarkDotNet

BenchmarkDotNet contributes a concept Overkill should likely steal directly:
**jobs** as named execution profiles.

Its useful ideas include:

-   `Throughput`, `ColdStart`, and `Monitoring` run strategies
-   explicit launch, warmup, and iteration counts
-   diagnosers and exporters
-   environment comparison as a first-class concern

That maps well to Overkill's distinction between benchmark shape, execution
constraints, and reporting.

Sources:

-   <https://benchmarkdotnet.org/articles/configs/jobs.html>
-   <https://benchmarkdotnet.org/articles/configs/configs.html>

### pytest-benchmark

pytest-benchmark is valuable less for raw timing and more for its surrounding
workflow:

-   pedantic mode
-   compare mode
-   histograms
-   machine-info hooks
-   structured result export

This is strong support for Overkill's position that benchmarking needs
comparison/reporting/policy features, not just a timer.

Source:

-   <https://pytest-benchmark.readthedocs.io/en/latest/>

### BenchmarkTools.jl

BenchmarkTools is valuable because it models:

-   benchmark groups
-   setup and teardown per sample
-   benchmark parameter tuning
-   comparison of benchmark results over time

It also explicitly discusses environmental noise and CPU shielding, which supports Overkill’s decision to treat calibration and normalization as first-class benchmark concerns.

Source:

-   <https://juliaci.github.io/BenchmarkTools.jl/stable/manual/>

### Hyperfine

Hyperfine is important because it treats **external command benchmarking** as
the primary use case rather than as an awkward edge case.

Its most relevant concepts are:

-   `--warmup`
-   `--setup`
-   `--prepare`
-   `--conclude`
-   `--cleanup`
-   parameter scans
-   easy machine-readable exports

These map directly onto Overkill's desired external-process benchmark story.

Source:

-   <https://github.com/sharkdp/hyperfine>

### Google Benchmark

Google Benchmark is useful as a reference for:

-   fixture benchmarks
-   counters and rates
-   benchmark-context metadata

The counter model is especially relevant because it shows how secondary
metrics can be first-class reporting citizens rather than comments attached
to runtime numbers.

Source:

-   <https://github.com/google/benchmark/blob/main/docs/user_guide.md>

### Browser Performance Tooling

Browser performance tooling is relevant to Overkill benchmarking because many
real frontend teams care about:

-   frame pacing and jank
-   paint timing
-   responsiveness
-   event-loop blocking
-   bundle-size budgets

The key lesson is that these are still benchmark problems, just with a
browser runtime and richer metric sources.

Two especially relevant influences:

-   **WebDriver BiDi**
    -   important long-term cross-browser automation/control direction
    -   good fit for portable event-driven browser benchmarking
    -   not obviously sufficient on its own yet for the deepest
        engine-specific performance/tracing metrics
-   **Chrome DevTools Protocol**
    -   exposes performance metrics programmatically
    -   useful for browser-oriented benchmark adapters
-   **Lighthouse / DevTools performance workflows**
    -   validate the idea of user-flow and timespan performance analysis
    -   support the broader concept of workflow benchmarks rather than only
        single-step microbenchmarks

Sources:

-   <https://www.w3.org/TR/webdriver-bidi/>
-   <https://chromedevtools.github.io/devtools-protocol/tot/Performance/>
-   <https://developer.chrome.com/docs/devtools/performance/overview>

### Tinybench

Tinybench is a useful reference for JS-specific timing and statistics APIs, but it mainly validates the lower-level measurement layer. It does not by itself answer workload orchestration, budgets, or policy semantics.

Source:

-   <https://github.com/tinylibs/tinybench>

## Property-Based, Model-Based, and Verified Testing

These systems matter because they show that “test runner” can mean more than example-based assertions.

Important lessons:

-   properties are executable specifications
-   generators and shrinking are core user experience, not add-ons
-   model-based testing can express workflow validity better than brittle examples
-   metamorphic relations are a real alternative to example-by-example
    oracle assertions
-   testing code itself can be wrong, so richer structure sometimes matters

These ideas should shape future Overkill package families even if they do not enter the first default DSL.

Sources:

-   Foundational Property-Based Testing: <https://lemonidas.github.io/pdf/Foundational.pdf>
-   Property-based testing of web services from business-rule models: <https://link.springer.com/article/10.1007/s10270-017-0647-0>
-   Improved semantics and implementation through property-based testing with QuickCheck: <https://kar.kent.ac.uk/42307/>
-   Software Testing with QuickCheck: <https://www.researchgate.net/publication/225219256_Software_Testing_with_QuickCheck>
-   DSL Composition for model-based test generation: <https://eceasst.org/index.php/eceasst/article/view/1579>

## Node Capability Model

Node’s permission model is highly relevant for Overkill microtests:

-   it is stable in current Node
-   it can deny filesystem, network, child processes, workers, addons, WASI, and inspector
-   Node explicitly describes it as a “seat belt” rather than a hostile-code sandbox

This is close to Overkill’s needs. It supports accidental-impurity prevention without overclaiming security guarantees.

Coverage is the key complication: Node’s V8 coverage flow still writes to disk through `NODE_V8_COVERAGE` and `v8.takeCoverage()`, so strict microtest mode needs a narrow exception path for coverage artifacts.

Sources:

-   <https://nodejs.org/api/permissions.html>
-   <https://nodejs.org/api/v8.html>
-   <https://nodejs.org/dist/latest/docs/api/cli.html#node_v8_coveragedir>

## Research Conclusions

The main conclusions for Overkill are:

-   keep the core small and event-driven
-   do not assume TDD/BDD registration trees are the only serious DSL shape
-   support multiple authoring families that lower into one engine model
-   let microtests and integration tests have different default capability models
-   prefer explicit typed context over hidden fixture lookup
-   adopt a first-class modifier or trait model for cross-cutting behavior
-   treat baselines as a broader concept than string snapshots
-   treat benchmarking as its own package family
-   absorb benchmark concepts such as benchmark groups, warmup, forks,
    diagnosers, parameter scans, setup/prepare/cleanup phases, and custom
    measurements rather than exposing only a timer loop
-   treat browser performance metrics and bundle-size budgets as natural
    extensions of the benchmark family
-   keep browser benchmark collection backend-agnostic: BiDi where possible,
    CDP/Lighthouse where deeper metric access is required
-   keep room for tests-as-values, property DSLs, model/state-machine DSLs,
    and documentation/example test DSLs
-   explore future DSLs and package families without forcing them into the first default runner
