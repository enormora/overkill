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
-   incomplete modern story around typed environments, reporters, and orchestration
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

Playwright’s fixture system proves that typed, lazy, composable environments scale well for integration work. Its strongest lesson is that environment setup can replace a large class of hook usage.

Tradeoff:

-   the implementation model is explicit
-   the call-site UX still feels partly magical because parameter injection hides dependencies in a special DSL shape

Overkill should keep the composability but prefer a clearer typed context model.

Sources:

-   <https://playwright.dev/docs/test-fixtures>
-   <https://playwright.dev/docs/next/test-snapshots>

### Folio

Folio is the Playwright-team predecessor you were referring to. It described itself as a customizable framework for building higher-level test frameworks, and later fed into Playwright Test.

Its most important lessons for Overkill are:

-   the framework should expose a builder layer, not only a finished DSL
-   fixture and environment composition can produce a custom exported test API
-   higher-level packages can be built from a reusable lower-level engine

That maps closely to Overkill’s desired split between `@overkill/engine`, first-party DSLs, and resource packages.

Sources:

-   <https://github.com/microsoft/folio>
-   <https://www.infoq.com/news/2020/11/microsoft-playwright-test-runner/>

## Historical Modular Systems

### Buster.JS

Buster is one of the strongest historical precedents for the product shape you want. Its docs explicitly described Buster as many stand-alone modules with documented APIs that could be reused independently, and its module list separated concerns such as assertions, browser automation, configuration, formatting, static browser runs, and CLI concerns.

Important lessons from Buster:

-   modularity should be real, not just internal packaging
-   browser automation support can live in a reusable subsystem rather than inside the runner core
-   assertions can be independently reusable
-   extension points such as AMD support and coverage support can sit above the core model
-   test start timing can be controllable instead of hard-wired

Important caution:

-   Buster also normalized hooks, globals, and Sinon-centric mocking in ways Overkill should not copy into the default story

The reusable `ramp` browser automation layer is especially relevant because it shows how browser and integration capabilities can be first-class without infecting the smallest test core.

Sources:

-   <https://busterjs.readthedocs.io/en/latest/>
-   <https://busterjs.readthedocs.io/en/v0.6.x/overview/>

## Cross-Language Testing Models

### Go

Go’s table-driven style remains one of the clearest examples of low-magic testing. The `Run` model shows that parameterized or grouped execution does not require a large hierarchy system.

Source:

-   <https://go.dev/blog/subtests>

### Rust

Rust shows two valuable things:

-   a simple failure model based on panic or explicit `Result`
-   a compiler-supported path toward custom harnesses

That supports Overkill’s decision to keep the core outcome contract flexible rather than forcing one assertion system.

Sources:

-   <https://doc.rust-lang.org/rust-by-example/testing/unit_testing.html>
-   <https://doc.rust-lang.org/nightly/unstable-book/language-features/custom-test-frameworks.html>

### Swift Testing

Swift Testing is interesting because it combines:

-   parameterization
-   metadata and traits
-   stronger output ergonomics

The main transferable idea is trait-based test customization. The main non-transferable part is macro-heavy syntax.

Source:

-   <https://developer.apple.com/xcode/swift-testing/>

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

Source:

-   <https://github.com/openjdk/jmh>

### BenchmarkTools.jl

BenchmarkTools is valuable because it models:

-   benchmark groups
-   setup and teardown per sample
-   benchmark parameter tuning
-   comparison of benchmark results over time

It also explicitly discusses environmental noise and CPU shielding, which supports Overkill’s decision to treat calibration and normalization as first-class benchmark concerns.

Source:

-   <https://juliaci.github.io/BenchmarkTools.jl/stable/manual/>

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
-   testing code itself can be wrong, so richer structure sometimes matters

These ideas should shape future Overkill package families even if they do not enter the first default DSL.

Sources:

-   Foundational Property-Based Testing: <https://lemonidas.github.io/pdf/Foundational.pdf>
-   Property-based testing of web services from business-rule models: <https://link.springer.com/article/10.1007/s10270-017-0647-0>
-   Improved semantics and implementation through property-based testing with QuickCheck: <https://kar.kent.ac.uk/42307/>

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
-   let microtests and integration tests have different default capability models
-   prefer explicit typed context over hidden fixture lookup
-   adopt a first-class modifier or trait model for cross-cutting behavior
-   treat baselines as a broader concept than string snapshots
-   treat benchmarking as its own package family
-   explore future DSLs and package families without forcing them into the first default runner
