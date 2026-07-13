# Platform-First Implementation Notes

## Purpose

This document does not define implementation work. It defines both an implementation philosophy and an architectural bias:

- prefer platform primitives first
- prefer standards before framework-specific abstractions
- adopt third-party libraries only when the platform leaves a real gap

The key point is not only “check the platform before adding libraries.”

It is also:

- let platform primitives shape public APIs when they are a good fit
- let standards influence subsystem boundaries
- avoid wrapping platform concepts in unnecessary framework-local replacements

For Overkill, “platform” means three overlapping layers:

- Node.js built-ins
- Web Platform APIs
- ECMAScript language features and proposals

The architectural idea is simple:

- build on top of platform primitives such as Fetch, Request, Response, Headers, AbortController, AbortSignal, streams, and explicit disposal
- let those primitives shape Overkill’s abstractions where they are a good fit
- avoid inventing framework-local replacements when the platform already offers a strong model

Current baseline assumption:

- Overkill may target Node 26 as the preferred minimum runtime baseline in order to lean more aggressively on current platform capabilities

## Decision Rule

When implementing a subsystem, evaluate options in this order:

1. Node built-in
2. Web standard or modern ECMAScript primitive
3. very small library that wraps the platform closely
4. larger library only when it provides clear value that the platform does not

The burden of proof should be on the dependency, not on the platform.

When the desired platform primitive is not yet standard or not yet widely available, Overkill may consider a polyfill or shim, but only with stricter rules:

1. the non-standard API must already be a good conceptual fit for Overkill
2. the polyfill must stay behind an Overkill-owned abstraction
3. the architecture must not assume the polyfill is permanent
4. the fallback story must remain understandable if the polyfill is removed later

When designing a public abstraction, also ask:

1. is there already a platform primitive users understand?
2. should Overkill expose that primitive directly?
3. if Overkill wraps it, is the wrapper preserving the platform model or obscuring it?

Examples:

- prefer `AbortSignal` over a custom cancellation token type
- prefer Fetch-like request/response shapes over bespoke transport abstractions
- prefer explicit disposal-compatible resource APIs over custom teardown conventions

## Node Built-Ins To Prefer First

### TypeScript execution and type stripping

Node now supports lightweight TypeScript execution by stripping erasable syntax.

Why it matters:

- directly aligns with the “run `.ts` files without a custom binary” goal
- reduces the need for loaders in the simplest path
- fits Overkill’s explicit design better than custom transpilation layers

Architectural implication:

- `@overkill-dev/test` and `@overkill-dev/run` should avoid assuming that a custom transpilation pipeline is always present

Important caveats:

- Node intentionally ignores `tsconfig.json`
- syntax requiring JavaScript generation is out of scope for plain type stripping

Current support status:

- stable as of Node `v25.2.0`
- no experimental warning as of Node `v24.3.0` / `v22.18.0`

Sources:

- <https://nodejs.org/api/typescript.html>
- <https://nodejs.org/en/learn/typescript/run-natively>

### Watch mode

Node has built-in watch mode.

Why it matters:

- Overkill should first evaluate whether a useful watcher story can be built on top of Node’s watch mode before adding a separate watcher stack

Architectural implication:

- watcher features should be layered so they can degrade cleanly to platform watch support rather than assuming a custom watcher core from day one

Source:

- <https://nodejs.org/dist/latest/docs/api/cli.html>

### Globbing and path matching

Node now has built-in globbing and path glob matching.

Why it matters:

- `@overkill-dev/run` may not need `glob` at all for many discovery cases

Architectural implication:

- file discovery APIs should stay close to simple glob and path-matching primitives rather than inventing a large custom query language too early

Sources:

- <https://nodejs.org/download/release/latest-jod/docs/api/fs.html>
- <https://nodejs.org/api/path.html>

### `node:perf_hooks`

Node’s performance APIs are a strong first stop for:

- benchmark timing
- internal instrumentation
- measuring dependency load, I/O, and async durations

Architectural implication:

- benchmark and diagnostics APIs should align with Performance entries and observation concepts where practical

Source:

- <https://nodejs.org/api/perf_hooks.html>

### `trace_events`

Node trace events are worth considering for low-level diagnostics and machine-consumable tracing, especially for benchmark or orchestration diagnostics.

Important caveat:

- this API remains marked experimental in Node’s documentation and should not become a casual default

Sources:

- <https://nodejs.org/api/index.html>
- historical trace events docs: <https://nodejs.org/download/release/latest-v10.x/docs/api/tracing.html>

### `AsyncLocalStorage`

`AsyncLocalStorage` is a strong candidate for:

- per-test execution context
- correlated diagnostics
- associating async work with the current test or run

It is especially interesting because it now has `withScope()` support that integrates with explicit resource management.

Architectural implication:

- if Overkill needs per-test async context, it should strongly consider exposing concepts that can map naturally onto `AsyncLocalStorage` rather than inventing a parallel async context model

Source:

- <https://nodejs.org/api/async_context.html>

### `node:diagnostics_channel`

Node diagnostics channels are relevant to Overkill because they provide
platform-native observability hooks for some categories of runtime behavior.

Especially relevant built-in channels include:

- `console.log`
- `console.info`
- `console.debug`
- `console.warn`
- `console.error`
- HTTP lifecycle channels
- worker and child-process channels

Architectural implication:

- Overkill should prefer diagnostics-channel-based observability where it
  exists before introducing direct monkey-patching
- this is especially useful for strict console policies in microtests and
  opt-in diagnostic capture modes

Important caveat:

- diagnostics channels do not solve general filesystem capture
- they do not automatically observe every raw stdout write path
- built-in channels still need to be evaluated for stability and overhead

Source:

- <https://nodejs.org/download/release/latest-jod/docs/api/diagnostics_channel.html>

### `node:test` and `node:assert`

These should be treated as idea donors and selective capability sources, not as the default foundation.

Potentially relevant ideas:

- `t.plan()` and `t.assert`
- file snapshots
- mocks and timers
- watch mode behavior

Caution:

- Overkill’s philosophy differs sharply from Node’s built-in test runner in areas like hooks, hierarchy, and broader architecture
- `assert.CallTracker` is deprecated and should not be a foundation for future Overkill design

Sources:

- <https://nodejs.org/api/test.html>
- <https://nodejs.org/api/assert.html>
- deprecation note visible in Node v22 docs: <https://nodejs.org/download/release/v22.17.1/docs/api/all.html>

## Web Platform APIs To Prefer First

### Fetch primitives

Overkill should prefer Web Fetch API primitives where they make architectural sense:

- `Request`
- `Response`
- `Headers`
- `URL`
- `URLPattern` when relevant and available

This matters especially for:

- integration-test runtimes
- request/response modeling
- adapters and higher-level framework integrations

Architectural implication:

- packages that model request/response workflows should prefer Web Fetch shapes as the public mental model

### `AbortController` and `AbortSignal`

These should be considered the default cancellation primitive across Overkill.

Likely uses:

- timeouts
- watcher shutdown
- test interruption
- benchmark cancellation
- reporter and resource teardown

Overkill should avoid inventing a separate cancellation token abstraction unless the platform primitive proves insufficient.

Architectural implication:

- cancellation should be a first-class cross-package concept built on `AbortSignal`

### Streams

Web Streams and Node stream interop should be considered before inventing custom event-pipe abstractions for:

- machine-readable event reporting
- large report artifact generation
- snapshot streaming

Architectural implication:

- reporter and artifact APIs should remain stream-friendly and avoid forcing everything through array-in-memory collection

### Scheduler APIs

The emerging scheduling APIs are worth watching for future orchestration and prioritization work.

Current status:

- promising, not something to build a core design around today
- polyfills exist, but should be treated as experimental implementation options rather than architectural foundations

Source:

- <https://github.com/WICG/scheduling-apis>
- <https://www.npmjs.com/package/scheduler-polyfill>

## Current Modern Language Features To Use Deliberately

These are no longer just future-looking ideas. They are relevant enough to shape current Overkill architecture.

### Explicit resource management

Very relevant right now.

Potential Overkill uses:

- resource lifetimes in `@overkill-dev/resources`
- scoped cleanup
- temporary benchmark or integration fixtures
- scoped async context via `AsyncLocalStorage.withScope()`

Architectural implication:

- `@overkill-dev/resources` should be designed so that explicit disposal is a natural fit, not an awkward add-on

Current support note:

- Node’s own `AsyncLocalStorage.withScope()` documentation explicitly shows usage with `using`

Sources:

- <https://github.com/tc39/proposal-explicit-resource-management>
- <https://nodejs.org/api/async_context.html>

## ECMAScript Features And Proposals To Keep In View

These should not be adopted blindly. The point is that Overkill should check whether the language already offers a good primitive before inventing a framework-local one.

### `import defer`

Very relevant to startup and lazy loading concerns.

Potential uses:

- deferring heavy reporter or snapshot machinery
- reducing startup cost for direct-file microtest runs

Architectural implication:

- package boundaries and lazy-load points should be designed so that future deferred loading is plausible

Current caveat:

- still a proposal, so design with it in mind but do not depend on it as a baseline assumption

Source:

- <https://github.com/tc39/proposal-defer-import-eval>

### ShadowRealm

Relevant as a possible future sandboxing or isolation primitive.

Current caveat:

- still proposal-stage and not a present design foundation
- should not drive today’s microtest guarantees

Source:

- <https://github.com/tc39/proposal-shadowrealm>

### Temporal

Relevant for:

- deterministic time handling
- benchmark timestamps
- time-based assertions or diagnostics

Architectural implication:

- avoid overfitting time APIs to `Date` if more precise or explicit temporal modeling becomes desirable

Current caveat:

- useful to keep in view, but it should not yet be assumed as a Node baseline in the concept documentation unless we verify official runtime support in the targeted Node version

Source:

- <https://tc39.es/proposal-temporal>

### Function implementation hiding

Worth watching for cleaner stack traces and less framework-noise leakage if it matures.

Current caveat:

- too early to build around

Source:

- <https://github.com/tc39/proposals>

### Structs

Potentially relevant for high-throughput internal data structures if it matures, especially around event pipelines or benchmark traces.

Current caveat:

- too early for design commitment

Source:

- <https://github.com/tc39/proposal-structs>

### Types as Comments

Relevant philosophically because it aligns with the goal of running type-annotated code directly.

Current caveat:

- proposal-stage, and Node’s current built-in type stripping is the more practical near-term path

Source:

- <https://tc39.es/proposal-type-annotations/>

### Signals

Worth tracking as a possible future state-management primitive, but not mature enough to anchor Overkill design today.

Source:

- <https://github.com/tc39/proposal-signals>

## State And Coordination Models

### Signals

Signals are worth watching for:

- reactive reporter views
- derived state in HTML reports or dashboards
- future tooling UIs

But they are not yet a reason to make the engine itself signal-centric.

### Statecharts

Statecharts are worth considering where behavior is truly stateful and externally visible, for example:

- watcher lifecycle
- reporter orchestration
- supervised execution profiles
- benchmark pipeline control

This is most relevant at the `@overkill-dev/run` layer, not the core engine.

If adopted, the question should be “does a state machine make this subsystem easier to reason about?” rather than “should we use XState everywhere?”

## Practical Evaluation Areas

Before implementing a subsystem, Overkill should ask:

- is there a Node built-in for this already?
- is there a Web-standard primitive for this already?
- is there a modern ECMAScript feature or proposal that should shape the abstraction?
- if we add a dependency, are we replacing a real platform gap or just bypassing a platform we did not learn yet?

Before defining a public API, Overkill should also ask:

- should this API directly expose a platform primitive?
- are we preserving a familiar platform mental model?
- are we accidentally inventing framework-local vocabulary for something the platform already names well?

Before adopting a polyfill, Overkill should also ask:

- is the target platform concept mature enough to shape the architecture?
- can we hide the polyfill behind a stable Overkill interface?
- would we still want the abstraction if the polyfill disappeared tomorrow?

## Recommended Current Leanings

Today, the strongest platform-first leanings are:

- use Node type stripping first for the simplest direct `.ts` execution path
- assume a Node 26-era platform baseline where that materially simplifies the architecture
- use Node watch mode first before adding a custom watcher stack
- use Node globbing first before adding `glob`
- use `AbortController` / `AbortSignal` as the default cancellation primitive
- use `AsyncLocalStorage` where per-test async context actually helps
- use `perf_hooks` before inventing custom timing infrastructure
- design `@overkill-dev/resources` with `using` / `Symbol.dispose` in mind
- allow polyfills only where they support a platform-shaped abstraction without becoming the abstraction itself
- treat emerging proposals as inspiration and future-proofing, not as baseline assumptions
