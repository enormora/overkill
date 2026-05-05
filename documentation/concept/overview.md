# Overkill

## Summary

Overkill is a TypeScript-first testing ecosystem for teams that want explicit behavior, strong programmatic APIs, and fewer hidden defaults. It is not an all-in-one framework pretending every kind of test is the same. It is a small core plus first-party packages for different testing modes.

The core idea is simple:

-   make the execution model obvious
-   make composition first-class
-   avoid normalizing bad testing habits
-   keep the core small enough that other tools can build on it cleanly

## Why It Exists

Most TypeScript test runners optimize for convenience by adding hidden behavior:

-   module interception and mocking shortcuts
-   global APIs
-   implicit environment setup
-   process models that are fixed too early
-   snapshot and reporter behavior that is hard to reason about

Overkill takes the opposite approach. It prefers explicit APIs and capability-oriented execution, even when that means slightly more ceremony.

## Who It Is For

Overkill is for teams that:

-   primarily write TypeScript
-   want a programmatic runner API, not just a CLI
-   care about test architecture as much as test ergonomics
-   want microtests to stay pure and fast
-   need a path from microtests to integration, browser, snapshot, and benchmark workflows without switching mental models

It is not trying to optimize for maximum Jest API compatibility.

## Product Shape

Overkill is a monorepo with fine-grained packages as the architectural truth.

Core package families:

-   `@overkill/engine`: runner contracts, test definitions, events, results, reporter integration points
-   `@overkill/test`: default microtest-oriented DSL with explicit support for test macros
-   `@overkill/assert`: optional assertion package with count-tracking and richer failure semantics
-   `@overkill/doubles`: explicit, function-first test doubles centered on a single `testDouble()` concept
-   `@overkill/resources`: typed environments, resource composition, and execution requirements
-   reporter packages such as `@overkill/reporter-line`, `@overkill/reporter-tap`, `@overkill/reporter-json`, and `@overkill/reporter-html`
-   `@overkill/run`: orchestration for discovery, filtering, seeds, and terminal workflows
-   `@overkill/baselines`: shared baseline model for snapshots and performance expectations
-   `@overkill/bench`: benchmark-specific package family

Planned early integrations:

-   type-test support should exist through adapters or integrations, not through a custom Overkill type-test engine
-   a first-party Stryker plugin should be planned from the beginning
-   coverage should be easy to enable from the beginning, even though it is not part of the default run mode
-   watch mode should work through Node's built-in `--watch` behavior wherever that is sufficient
-   machine-readable APIs should keep IDE and MCP implementations easy for third parties

Likely future families:

-   browser and visual testing
-   property-based testing
-   remote execution and distributed orchestration helpers

## Testing Modes

Overkill deliberately treats different testing modes as different things.

### Microtests

Microtests are small, local, and side-effect-restricted by default. In the first-party concept they should not casually read files, write files, talk to the network, spawn processes, or mutate global environment outside clearly granted exceptions.

The intent is not security isolation. The intent is catching accidental impurity early and keeping microtests fast and predictable.

The default DSL should still support strong reuse through test macros and parameterized cases so users do not fall back to hooks or hidden shared setup just to avoid repetition.

### Integration-Style Tests

Integration-style tests are allowed to use richer environments, I/O, snapshots, and external processes. They need stronger orchestration, more expressive fixtures, and often more than one reporter.

They may also justify controlled retries, quarantine markers, and richer failure artifacts in ways that microtests should not.

### Benchmarks

Benchmarks are not “tests with a timer.” They model workloads, fixtures, setup, controlled environments, additional metrics, and checked-in budgets. They deserve their own package family.

### Type Tests

Type tests should be part of the concept as a supported test family, but through adapters or integrations rather than a custom Overkill implementation.

They matter because TypeScript-first projects need to catch regressions in:

-   inference
-   overload behavior
-   conditional types
-   declaration-level API ergonomics

## Execution Strategy

Execution strategy should not be hard-coded by any one package. Different layers may place different demands on the run:

-   `@overkill/resources` may introduce resource-sharing or isolation requirements
-   `@overkill/doubles` should remain cheap enough for in-process microtests and should not force isolation by itself
-   `@overkill/bench` may want strict single-worker execution for measurement stability
-   future browser or integration packages may prefer worker pools, file-level isolation, or one-process-per-environment strategies

The concept should therefore treat execution strategy as a negotiated run plan built from package-provided requirements and constraints, with orchestration resolving the final plan.

Remote execution is not a default mode, but it should be treated as a real architectural direction from the start, especially for browser and integration-heavy workflows.

## Reporter Model

Reporters should support two distinct modes:

-   real-time reporters that observe start, progress, and completion events
-   final-result reporters that only consume the finished run result

This matches the existing code direction and keeps HTML or file-writing reports from pretending they need streaming output when they do not.

When multiple reporters are configured, Overkill should conceptually distinguish output sinks such as:

-   stdout
-   stderr
-   files or directories
-   in-memory or machine-consumable event streams

The preferred direction is for orchestration to detect obvious sink conflicts, especially multiple reporters trying to own stdout, and either reject the configuration or require one reporter to be explicitly designated as the stdout reporter. If that proves too heavy in implementation, the user may still override it deliberately, but the concept should treat sink collisions as something the system understands rather than silently ignoring.

The core should preserve the necessary detail for different reporter styles without forcing one presentation:

-   human-first terminal summaries
-   structured machine payloads
-   richer artifact-oriented HTML or file reports

## Baselines

Overkill uses **baseline** as the umbrella term for checked-in artifacts that are compared during runs and only updated intentionally.

Baseline subtypes include:

-   content snapshots
-   visual or terminal snapshots
-   performance baselines and budgets

The shared workflow matters:

-   baselines are stored in version control
-   changes are reviewed
-   updates are explicit
-   stale baselines are detectable

The semantics still differ. Performance baselines need thresholds, normalization, and drift rules that ordinary content snapshots do not.

## Bundles

Fine-grained packages remain first-class, but some teams will want curated bundle distributions.

Possible bundle shapes:

-   a minimal microtest bundle
-   a default testing bundle
-   an integration-oriented bundle
-   a full convenience bundle

Bundles are a distribution convenience, not the architectural source of truth. The docs should always explain the underlying package model even when bundle entrypoints exist.

## Metadata And Identity

Overkill should treat metadata and identity as shared concepts rather than ad-hoc strings.

That includes:

-   tags and traits for selection
-   stable test and case identities
-   environment and workload identities
-   artifact identities derived from those parts

These concepts connect selection, reproducibility, reporting, baselines, and benchmark policies.

## Tooling Openness

Overkill should stay open to external tooling from the beginning.

That includes:

-   type-test adapters
-   mutation testing through Stryker
-   explicit coverage tooling
-   editor or IDE integrations
-   MCP servers and other machine-consumers

The engine and orchestration layers should preserve the machine-readable data these integrations need rather than assuming terminal output is the only product surface.

## Defaults

The concept currently assumes:

-   modern Node, with Node 25 as the preferred baseline
-   ESM-first package shape
-   TypeScript focus rather than general JavaScript coverage
-   single-process deterministic execution by default
-   randomization as explicit opt-in with reproducible seeds
-   stable identity and selection metadata as first-class concepts
-   coverage is off by default, but should be easy to enable through explicit tooling
-   watch mode should lean on Node's built-in `--watch` behavior by default
-   no hooks in the default microtest story
-   no hidden module interception in the core story
-   orchestration resolves execution strategy from explicit constraints instead of burying it in one runner default

## Relationship To Existing Tools

Overkill takes ideas from many systems without copying their whole world:

-   Playwright fixtures show that typed environment composition can scale
-   Deno shows direct module-based registration can stay simple
-   Bun validates seeded randomization as a normal runner feature
-   Go shows the enduring value of flat, table-driven testing
-   Rust shows that a runner can support both panic/throw style and explicit result style
-   ZIO Test and Swift Testing show useful trait/aspect models for cross-cutting behavior

The goal is not novelty for its own sake. The goal is to assemble a cleaner testing model for TypeScript.

## Source Notes

Key sources used across the concept docs:

-   Node permissions: <https://nodejs.org/api/permissions.html>
-   Node V8 coverage: <https://nodejs.org/api/v8.html>
-   Playwright fixtures: <https://playwright.dev/docs/test-fixtures>
-   Deno test registration: <https://docs.deno.com/api/deno/~/Deno.test>
-   Bun test runner: <https://bun.sh/docs/test>
-   Go subtests: <https://go.dev/blog/subtests>
-   Rust testing model: <https://doc.rust-lang.org/rust-by-example/testing/unit_testing.html>
