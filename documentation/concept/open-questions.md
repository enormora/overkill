# Open Questions

## How To Read This Document

This document is no longer a flat backlog. It is a dependency-ordered design tree.

The order matters:

1. decide what belongs in `@overkill/engine`
2. decide how the default DSL builds on it
3. decide how `@overkill/resources` composes with that DSL
4. decide how orchestration resolves execution strategy
5. decide how reporters, baselines, and benchmarks fit on top
6. decide which bundles and future package families deserve first-class treatment

Each question includes:

-   the dependency it hangs on
-   possible suggestions
-   the current recommended answer

Recommended answers are not final law. They are the present best path through the design tree based on the current concept.

## Branch 1: Engine Boundary

### 1.1 What is the smallest stable responsibility of `@overkill/engine`?

Depends on:

-   nothing upstream; this is the root architecture question

Possible suggestions:

-   narrow engine: only test definitions, execution plans, events, results, and reporter contracts
-   medium engine: narrow engine plus baseline identity and scheduling primitives
-   broad engine: narrow engine plus fixtures, assertions, and snapshot semantics

Recommended answer:

-   choose the narrow engine

Why:

-   it preserves the API-first, low-magic goal
-   it keeps higher-level packages replaceable
-   it best matches the Buster modularity and Folio builder-layer lessons

### 1.2 Should `@overkill/engine` know about only one test outcome model?

Depends on:

-   1.1

Possible suggestions:

-   throw/reject only
-   explicit structured result only
-   support both throw/reject and explicit structured outcomes

Recommended answer:

-   support both

Why:

-   it keeps the engine flexible enough for plain tests, richer assertion packages, and benchmark or baseline-aware extensions

### 1.3 Should `@overkill/engine` know about baseline-aware tests?

Depends on:

-   1.1
-   1.2

Possible suggestions:

-   no: keep baseline identity fully above the engine
-   partial: engine exposes generic artifact identity hooks but no snapshot semantics
-   yes: engine has first-class baseline-aware test definitions

Recommended answer:

-   choose the partial option

Why:

-   stale-baseline detection may need stable identity and lifecycle hooks
-   generic artifact identity is safer than pushing snapshot semantics into the engine

## Branch 2: Default DSL And Authoring Model

### 2.1 What should be the dominant registration shape of `@overkill/test`?

Depends on:

-   1.1

Possible suggestions:

-   module-load `test()` registration
-   exported manifest objects
-   imperative builder plus explicit `run()`

Recommended answer:

-   use module-load `test()` registration as the default first-party DSL

Why:

-   it gives the cleanest direct-file workflow
-   it matches the low-magic direction better than hidden discovery
-   it is still compatible with a builder-oriented lower layer

### 2.2 Should Overkill support more than one first-party DSL early?

Depends on:

-   2.1

Possible suggestions:

-   one DSL first, alternates later
-   two equal-status DSLs from the start
-   one DSL only, indefinitely

Recommended answer:

-   one DSL first, alternates later

Why:

-   the architecture should permit multiple DSLs
-   the product should not fragment before the default story becomes coherent

### 2.3 How important are test macros in the default DSL?

Depends on:

-   2.1

Possible suggestions:

-   treat macros as optional sugar
-   make macros and parameterized helpers a first-class reuse mechanism
-   prefer suites and hooks instead of macros for reuse

Recommended answer:

-   make macros and parameterized helpers first-class

Why:

-   they are the cleanest anti-hook reuse mechanism
-   they fit the flat-test design better than nested suite machinery

### 2.4 Is flat testing enough, or does the DSL need a suite construct?

Depends on:

-   2.1
-   2.3

Possible suggestions:

-   flat tests only, with file boundaries as grouping
-   flat tests plus a minimal suite/group naming construct
-   nested suites as a first-class hierarchy

Recommended answer:

-   flat tests plus a minimal suite/group naming construct

Why:

-   file boundaries alone are weak for naming, baseline identity, and multi-environment reporting
-   nested suites create pressure toward hook-driven state and hierarchy semantics

### 2.5 Should the default DSL expose `.skip` and `.only`?

Depends on:

-   2.1
-   4.1

Possible suggestions:

-   no inline controls; use orchestration filters and profiles
-   allow `.skip` but not `.only`
-   allow both

Recommended answer:

-   no inline controls in the core default concept

Why:

-   it keeps selection logic in orchestration
-   `.only` interacts badly with multi-worker and multi-process execution

## Branch 3: Assertions

### 3.1 Should `@overkill/assert` be optional or inseparable from `@overkill/test`?

Depends on:

-   1.2
-   2.1

Possible suggestions:

-   optional package
-   built into the DSL and always present
-   no first-party assertion package at all

Recommended answer:

-   keep `@overkill/assert` optional

Why:

-   it preserves engine openness
-   it still allows deep integration for assertion tracking and rich diagnostics

### 3.2 What assertion-tracking model should the first package prioritize?

Depends on:

-   3.1

Possible suggestions:

-   count tracking plus `plan()`
-   zero-assertion detection only
-   returned assertion values or accumulated effects as the primary model

Recommended answer:

-   prioritize count tracking plus `plan()`, while preserving future room for returned-value or effect-based models

Why:

-   it solves the practical need now
-   it does not foreclose deeper experimental models later

### 3.3 Should baseline-aware comparison logic live in `@overkill/assert` or `@overkill/baselines`?

Depends on:

-   1.3
-   3.1

Possible suggestions:

-   keep all comparison logic in `@overkill/baselines`
-   keep serializers and comparison hooks in `@overkill/assert`, storage and lifecycle in `@overkill/baselines`
-   merge both concerns into one package

Recommended answer:

-   serializers and semantic matchers in `@overkill/assert`; artifact storage and lifecycle in `@overkill/baselines`

Why:

-   comparison logic is assertion-shaped
-   artifact identity, stale detection, and update policy are baseline-shaped

## Branch 3A: Doubles

### 3A.1 Should Overkill have a first-party doubles package at all?

Depends on:

-   2.3
-   3.1

Possible suggestions:

-   no first-party doubles package; leave the space to third-party tools
-   yes, but keep it tiny and explicit
-   yes, and build a broad Sinon-style ecosystem

Recommended answer:

-   yes, but keep it tiny and explicit

Why:

-   many projects will want first-party doubles that fit Overkill's explicit-injection philosophy
-   the package can stay small if it refuses patching and module mocking as default workflows

### 3A.2 Should the package expose multiple user-facing concepts like spy, fake, and stub?

Depends on:

-   3A.1

Possible suggestions:

-   yes: preserve the traditional vocabulary
-   partly: expose multiple concepts internally but one public entrypoint
-   no: use one primary concept that covers simple and advanced cases

Recommended answer:

-   no: use one primary concept that covers simple and advanced cases

Why:

-   Sinon terminology is useful historically but noisy in practice
-   one concept better matches Overkill's minimal and explicit design language

### 3A.3 What should the primary abstraction be called?

Depends on:

-   3A.1
-   3A.2

Possible suggestions:

-   `testDouble()`
-   `double()`
-   `mock()`

Recommended answer:

-   `testDouble()`

Why:

-   it is explicit at the call site and avoids mathematical ambiguity
-   `mock()` carries too much baggage from other ecosystems
-   `double()` is elegant but easier to misread outside context

### 3A.4 What should the primary API shape be?

Depends on:

-   3A.2
-   3A.3

Possible suggestions:

-   mutable chain API as the design center
-   config object plus composable rule helpers
-   imperative reconfiguration methods only

Recommended answer:

-   config object plus composable rule helpers

Why:

-   it reads better for both simple and advanced behavior
-   it avoids long mutable chains with overlapping semantics
-   it composes naturally with typed helpers and future resource factories

### 3A.4a How important is direct instance introspection?

Depends on:

-   3A.3
-   3A.4

Possible suggestions:

-   keep introspection minimal and rely on assertion helpers
-   expose rich direct instance properties such as `callCount`, `firstCall`, and typed call/result records
-   expose rich introspection only behind debug helpers

Recommended answer:

-   expose rich direct instance properties such as `callCount`, `firstCall`, and typed call/result records

Why:

-   good doubles are often inspected directly in assertions and debuggers
-   friendly introspection is one of the strongest practical strengths of Sinon-style tools
-   Overkill should preserve that strength without inheriting the rest of Sinon's conceptual sprawl

### 3A.5 How should advanced behavior be expressed?

Depends on:

-   3A.4

Possible suggestions:

-   chained methods like `onFirstCall().returns(...)`
-   ordered rules such as `onCall(1, returns(...))`
-   one answer function that receives a structured call object
-   ordered rules plus an answer-function escape hatch

Recommended answer:

-   ordered rules plus an answer-function escape hatch

Why:

-   rules cover most practical cases cleanly
-   answer functions provide full power without inventing endless chained methods

### 3A.6 Should arg-based behavior use a `when()` helper?

Depends on:

-   3A.4
-   3A.5

Possible suggestions:

-   no; only call-order and answer-function behavior
-   yes, with exact typed argument tuples first
-   yes, with a broad matcher DSL from day one

Recommended answer:

-   yes, with exact typed argument tuples first

Why:

-   `when()` is expressive and readable
-   keeping it exact and typed avoids dragging in a large matcher language too early

### 3A.7 Should first-party doubles support object-method replacement or module replacement?

Depends on:

-   3A.1
-   3A.2

Possible suggestions:

-   yes, both should be first-class
-   support object-method replacement only
-   no: explicit injection only in the first-party concept

Recommended answer:

-   no: explicit injection only in the first-party concept

Why:

-   patching and module replacement conflict with Overkill's core philosophy
-   explicit injection composes better with resources, macros, and capability-restricted microtests

## Branch 4: Resources

### 4.1 What exactly is `@overkill/resources`?

Depends on:

-   1.1
-   2.1

Possible suggestions:

-   fixture helpers for `@overkill/test`
-   a generic resource and context composition layer
-   a full orchestration layer

Recommended answer:

-   a generic resource and context composition layer

Why:

-   it needs to work for ordinary tests, benchmarks, and future browser packages
-   orchestration should stay in `@overkill/run`

### 4.2 What lifecycle scopes should `@overkill/resources` support conceptually?

Depends on:

-   4.1

Possible suggestions:

-   per-test only
-   per-run and per-test only
-   per-run, per-file, per-suite, per-case, and shared/exclusive resource scopes

Recommended answer:

-   support per-run, per-file, per-suite, per-case, and shared/exclusive scopes

Why:

-   benchmarks and browser tests need richer lifecycles than microtests
-   the resource model should not be artificially microtest-shaped

### 4.3 Should resources be able to influence execution strategy?

Depends on:

-   4.1
-   4.2

Possible suggestions:

-   no, resources only prepare context
-   yes, but only as hints
-   yes, through explicit execution requirements and preferences

Recommended answer:

-   yes, through explicit requirements and preferences

Why:

-   shared or exclusive resources often directly affect safe concurrency and isolation

## Branch 5: Execution Strategy And Orchestration

### 5.1 Where should execution strategy be resolved?

Depends on:

-   4.3

Possible suggestions:

-   inside each high-level package independently
-   inside `@overkill/resources`
-   inside `@overkill/run` using package-provided constraints

Recommended answer:

-   inside `@overkill/run` using package-provided constraints

Why:

-   execution is a cross-cutting concern
-   neither resources nor benchmarks should unilaterally own the final plan

### 5.2 What shape should execution constraints take?

Depends on:

-   5.1

Possible suggestions:

-   hard constraints only
-   soft preferences only
-   both hard constraints and soft preferences

Recommended answer:

-   support both hard constraints and soft preferences

Why:

-   some requirements are non-negotiable, such as exclusive resource access
-   some are optimizations, such as preferred worker count

### 5.3 Should worker pools be universal?

Depends on:

-   5.1
-   5.2

Possible suggestions:

-   yes, every non-trivial run uses a worker pool
-   no, worker pools are one strategy among several
-   no worker pools at all in the first concept

Recommended answer:

-   worker pools should be one strategy among several

Why:

-   microtests may run in-process
-   benchmarks may require one worker
-   integration or browser families may prefer file-level or environment-level process isolation

### 5.4 What should the default execution mode be for `@overkill/test`?

Depends on:

-   5.3

Possible suggestions:

-   single-process in-order
-   single-process concurrent
-   worker-pool parallel by default

Recommended answer:

-   single-process in-order

Why:

-   it matches the explicit, debuggable microtest story
-   concurrency can be added deliberately through orchestration

### 5.5 How should conflict resolution work when packages disagree?

Depends on:

-   5.2

Possible suggestions:

-   first package wins
-   orchestration chooses the most restrictive plan
-   orchestration requires explicit user conflict resolution

Recommended answer:

-   orchestration should choose the most restrictive plan for hard constraints and report the reason; unresolved preference conflicts can fall back to a deterministic priority order

Why:

-   safety and correctness beat throughput
-   the user should still be able to see why a run became serialized

### 5.5a Should retries be part of the default microtest model?

Depends on:

-   5.4
-   5.5

Possible suggestions:

-   yes, retries should be available everywhere
-   no for microtests, but acceptable in integration-style modes
-   no retries anywhere

Recommended answer:

-   no for microtests, but acceptable in integration-style modes

Why:

-   retries normalize the wrong failure model for microtests
-   integration-style tests may legitimately need controlled retry semantics

### 5.6 What timeout and hang-detection guarantees should different execution modes provide?

Depends on:

-   5.1
-   5.2
-   5.3

Possible suggestions:

-   promise hard timeouts everywhere
-   provide only soft timeouts and no forced termination anywhere
-   distinguish in-process and isolated execution modes explicitly

Recommended answer:

-   distinguish in-process and isolated execution modes explicitly

Why:

-   an in-thread `while (true)` loop cannot be reliably force-stopped without an external isolation boundary
-   isolated worker or subprocess execution can support a supervisor or sidecar that terminates stuck tasks
-   this keeps microtests cheap while still allowing stronger control in integration or benchmark profiles

### 5.7 Should microtests pay the overhead for hard hang recovery?

Depends on:

-   5.6

Possible suggestions:

-   yes, always run microtests in a supervised isolated worker
-   no, keep microtests cheap and in-process by default
-   offer an opt-in strict-supervised microtest profile

Recommended answer:

-   keep microtests cheap and in-process by default, with an opt-in strict-supervised microtest profile if needed later

Why:

-   the default microtest story optimizes for low overhead and explicitness
-   hard supervision is more appropriate for isolated profiles than for the default path

### 5.7a If supervised microtests exist, should crash-only recovery be considered acceptable?

Depends on:

-   5.6
-   5.7

Possible suggestions:

-   no, supervision is useless unless graceful recovery is guaranteed
-   yes, crash-only supervision is acceptable for disposable supervised profiles
-   only for integration and benchmark profiles, never for microtests

Recommended answer:

-   yes, crash-only supervision is acceptable for disposable supervised profiles

Why:

-   a killed run is usually better than a permanently wedged run
-   the execution unit can be treated as disposable if that contract is explicit
-   this should remain opt-in, not the default microtest promise

### 5.8 Should Overkill try to detect leaked resources separately from hard hangs?

Depends on:

-   4.3
-   5.6

Possible suggestions:

-   no, only timeout the whole run
-   yes, track leaked resources and report them as diagnostics
-   yes, and treat all leaked resources as immediate hard failures in every profile

Recommended answer:

-   yes, track leaked resources and report them as diagnostics, with policy deciding whether they are warnings or failures

Why:

-   leaked ports, listeners, timers, or servers are a different problem than CPU-bound infinite loops
-   separating leak diagnostics from hard termination leads to a more honest model

## Branch 6: Reporter Model

### 6.1 Should reporters remain separate packages?

Depends on:

-   1.1

Possible suggestions:

-   one aggregate reporter package
-   one package per reporter, no aggregate package
-   one package per reporter plus optional curated bundle entrypoints

Recommended answer:

-   one package per reporter plus optional curated bundle entrypoints

Why:

-   it preserves dependency clarity
-   onboarding can still stay easy

### 6.2 Should the engine keep both real-time and final-result reporter lifecycles?

Depends on:

-   1.1

Possible suggestions:

-   real-time only
-   final-result only
-   both

Recommended answer:

-   keep both

Why:

-   terminal reporters and artifact-generating reporters have genuinely different needs
-   the current source tree already points in this direction

### 6.3 How should stdout sink conflicts be handled?

Depends on:

-   6.1
-   6.2

Possible suggestions:

-   do nothing; the user owns the mess
-   warn only
-   reject by default unless a primary stdout reporter is designated

Recommended answer:

-   reject by default unless a primary stdout reporter is designated

Why:

-   silent interleaving is almost always bad
-   this is a user-facing orchestration problem the system can reason about

### 6.4 Should artifact reporters declare sinks and capabilities?

Depends on:

-   6.2
-   6.3

Possible suggestions:

-   no, keep sink behavior implicit
-   declare sinks only
-   declare sinks, lifecycle mode, and artifact ownership

Recommended answer:

-   declare sinks, lifecycle mode, and artifact ownership

Why:

-   it helps orchestration catch conflicts
-   it helps bundles and integrations reason about reporter combinations

### 6.5 Should the engine preserve multiple presentation-friendly views of failures and errors?

Depends on:

-   1.2
-   6.2

Possible suggestions:

-   no; keep the payload minimal and let reporters reconstruct what they can
-   yes; preserve structured detail so different reporters can present the same event differently
-   yes, but only for assertion failures

Recommended answer:

-   yes; preserve structured detail so different reporters can present the same event differently

Why:

-   stdout, JSON, and HTML reporters need different presentations
-   the core should preserve information, not lock in one rendering

## Branch 7: Baselines

### 7.1 Should Overkill keep one umbrella baseline concept?

Depends on:

-   1.3

Possible suggestions:

-   no, snapshots and performance budgets are separate concepts
-   yes, one umbrella concept with semantic subtypes
-   yes, one fully unified comparison model

Recommended answer:

-   one umbrella concept with semantic subtypes

Why:

-   the operational workflow is shared
-   the semantic meaning is not

### 7.2 Where should stale baseline detection live?

Depends on:

-   1.3
-   7.1

Possible suggestions:

-   entirely in `@overkill/baselines`
-   partly in `@overkill/engine` identity hooks, mainly in `@overkill/baselines`
-   entirely in orchestration

Recommended answer:

-   partly in engine identity hooks, mainly in `@overkill/baselines`

Why:

-   stale detection depends on collected identity
-   storage, comparison, and cleanup policy still belong above the engine

### 7.2a Should artifact identity be treated as a separate shared concept?

Depends on:

-   1.3
-   7.2

Possible suggestions:

-   no; let each package derive its own naming
-   yes; define stable shared identity parts for tests, cases, environments, workloads, and artifacts
-   yes, but only for baselines

Recommended answer:

-   yes; define stable shared identity parts for tests, cases, environments, workloads, and artifacts

Why:

-   stale detection, reporting, reproducibility, and benchmark policies all need stable identity
-   this should not be reinvented separately in every package

### 7.3 Which test families should use snapshots by default?

Depends on:

-   7.1

Possible suggestions:

-   all test families
-   integration, browser, and workflow-oriented families only
-   benchmarks and snapshots share one default path

Recommended answer:

-   integration, browser, and workflow-oriented families only

Why:

-   microtests should not drift toward giant artifact-based checks as the default habit

### 7.4 Should baseline updates ever happen during ordinary runs?

Depends on:

-   7.1

Possible suggestions:

-   yes, when configured
-   only for missing artifacts
-   never; updates require explicit mode

Recommended answer:

-   never; updates require explicit mode

Why:

-   reviewable artifact drift is central to the concept

## Branch 8: Benchmarking

### 8.1 Should `@overkill/bench` reuse ordinary test definitions or define its own top-level authoring model?

Depends on:

-   1.1
-   5.1

Possible suggestions:

-   reuse ordinary test definitions with extensions
-   define a distinct benchmark authoring model
-   support both equally from day one

Recommended answer:

-   define a distinct benchmark authoring model that still reuses engine-level execution and reporting contracts

Why:

-   benchmark workloads, calibration, and policy are not just “tests plus timing”

### 8.2 Should benchmark workloads be first-class or just parameterized cases?

Depends on:

-   8.1

Possible suggestions:

-   parameterized cases are enough
-   workloads are first-class and parameterization builds on them
-   workloads are just metadata

Recommended answer:

-   workloads should be first-class

Why:

-   workload identity drives fixtures, reporting, budgets, and normalization

### 8.3 Should benchmarks be allowed to force single-worker execution?

Depends on:

-   5.2
-   8.1

Possible suggestions:

-   never; orchestration always decides
-   yes, as a hard constraint when requested
-   yes, but only as a soft preference

Recommended answer:

-   yes, as a hard constraint when requested

Why:

-   reliability is often more important than throughput for benchmarks

### 8.4 Should performance baselines be treated as ordinary snapshots?

Depends on:

-   7.1
-   8.1

Possible suggestions:

-   yes, exactly the same model
-   no, separate concept entirely
-   same umbrella baseline model, but distinct performance semantics

Recommended answer:

-   same umbrella baseline model, but distinct performance semantics

Why:

-   budgets need thresholds, normalization, and metric-specific policy

## Branch 9: Bundles

### 9.1 Should Overkill ship curated bundles at all?

Depends on:

-   1.1
-   6.1

Possible suggestions:

-   no, packages only
-   yes, curated bundles in addition to packages
-   yes, bundles only

Recommended answer:

-   curated bundles in addition to packages

Why:

-   teams want convenience
-   the architecture should still stay package-first

### 9.2 What bundle strategy makes the most sense?

Depends on:

-   9.1

Possible suggestions:

-   pure meta-packages
-   opinionated re-export packages
-   both

Recommended answer:

-   both, but keep the number of curated bundles small

Why:

-   meta-packages are simple for dependency management
-   re-export packages can improve onboarding and common imports

### 9.3 Should there be an `@overkill/all` package?

Depends on:

-   9.1
-   9.2

Possible suggestions:

-   yes, as a normal documented default
-   yes, but position it as onboarding or evaluation convenience
-   no

Recommended answer:

-   yes, but only as onboarding or evaluation convenience

Why:

-   it should not become the conceptual center of the product

## Branch 9A: Metadata, Reproducibility, And Extensions

### 9A.1 Should metadata be a first-class shared concept?

Depends on:

-   2.4
-   5.1

Possible suggestions:

-   no; rely mostly on names and paths
-   yes; define structured metadata for selection, reporting, and policy
-   yes, but keep it reporter-only

Recommended answer:

-   yes; define structured metadata for selection, reporting, and policy

Why:

-   names and paths are too weak for serious filtering and policy decisions
-   the same metadata should drive selection, reporting, and identities

### 9A.2 How much reproducibility should Overkill promise?

Depends on:

-   5.1
-   7.2a
-   9A.1

Possible suggestions:

-   promise only seed replay
-   promise reproducible run intent and planning, not bit-for-bit machine equivalence
-   promise full identical results across machines

Recommended answer:

-   promise reproducible run intent and planning, not bit-for-bit machine equivalence

Why:

-   this is realistic
-   it still gives users replayable order, stable selection, and meaningful artifact association

### 9A.3 Does Overkill need a heavy plugin runtime?

Depends on:

-   1.1
-   9A.1

Possible suggestions:

-   yes; make plugins the main extension model
-   no; stable package APIs and contracts are enough for most cases
-   no plugins at all

Recommended answer:

-   no; stable package APIs and contracts are enough for most cases

Why:

-   the API-first architecture already gives strong extension points
-   a heavy plugin runtime would add complexity without being necessary for the core concept

## Branch 10: Future Package Families

### 10.1 How early should browser support become first-class?

Depends on:

-   4.1
-   5.1
-   6.1

Possible suggestions:

-   immediately after the default microtest stack is coherent
-   only after baselines and benchmarks are mature
-   leave it indefinitely to third parties

Recommended answer:

-   immediately after the default microtest stack is coherent

Why:

-   browser support is one of the clearest proofs that the resource and orchestration model generalizes

### 10.2 When should property-based testing become first-class?

Depends on:

-   1.2
-   2.3

Possible suggestions:

-   keep it indefinitely as future work
-   make it the next major package family after browser/integration support
-   fold it into the default DSL early

Recommended answer:

-   make it the next major package family after browser/integration support

Why:

-   it needs dedicated primitives
-   it is important, but not the first proof of the architecture

### 10.3 How much should mutation and external integration adapters influence the engine API now?

Depends on:

-   1.1
-   6.4

Possible suggestions:

-   not at all; design them later
-   only enough to preserve structured events, results, and stable identities
-   make them first-class engine concerns now

Recommended answer:

-   only enough to preserve structured events, results, stable identities, and focused rerun/selection surfaces, while planning Stryker integration from the beginning

Why:

-   the engine should stay lean
-   planned integrations still need dependable integration surfaces from day one

### 10.3a How should coverage influence the architecture from the beginning?

Depends on:

-   5.1
-   10.3

Possible suggestions:

-   not at all; leave coverage as a later concern
-   plan for easy explicit enablement, but keep coverage outside the default run mode
-   make coverage always-on in the default runner

Recommended answer:

-   plan for easy explicit enablement, but keep coverage outside the default run mode

Why:

-   coverage is important, and the tool choice matters
-   always-on coverage conflicts with the explicit, low-overhead default story
-   the architecture should still preserve the hooks and artifact handling that coverage tools need

### 10.3b How should type tests fit the concept?

Depends on:

-   1.1
-   5.1
-   10.3

Possible suggestions:

-   ignore them and leave everything to external tools
-   support them through adapters or integrations, but do not build a custom Overkill type-test engine
-   build a full first-party type-test implementation

Recommended answer:

-   support them through adapters or integrations, but do not build a custom Overkill type-test engine

Why:

-   type tests matter in a TypeScript-first ecosystem
-   adapter support gives value without dragging the project into a second standalone compiler-facing framework

### 10.3c How should watch mode fit the concept?

Depends on:

-   5.1
-   10.3

Possible suggestions:

-   build a custom watch system immediately
-   lean on Node's built-in `--watch` behavior by default and add only minimal orchestration glue where needed
-   leave watch mode out entirely

Recommended answer:

-   lean on Node's built-in `--watch` behavior by default and add only minimal orchestration glue where needed

Why:

-   it matches the platform-first philosophy
-   it avoids inventing a large custom watcher story too early

### 10.3d How should IDE and MCP support influence the concept?

Depends on:

-   6.5
-   9A.1
-   10.3

Possible suggestions:

-   do nothing special; terminal output is enough
-   preserve stable machine-readable APIs so third parties can build editors and MCP servers
-   build first-party IDE features into the runner concept

Recommended answer:

-   preserve stable machine-readable APIs so third parties can build editors and MCP servers

Why:

-   the architecture should stay open without becoming IDE-centric
-   the same structured data helps reporters, adapters, and remote execution

### 10.3e How should remote execution influence the concept now?

Depends on:

-   5.1
-   7.2a
-   9A.2
-   10.3

Possible suggestions:

-   ignore it until much later
-   treat it as an architectural direction without making it an immediate implementation goal
-   make it a first release requirement

Recommended answer:

-   treat it as an architectural direction without making it an immediate implementation goal

Why:

-   remote execution is especially relevant for browser and heavy integration workloads
-   stable identities, structured artifacts, and machine-readable planning already pay off for this direction

## Summary Of The Current Recommended Path

If the concept were to follow one coherent path through the tree today, it would be:

-   narrow `@overkill/engine`
-   one default module-load DSL in `@overkill/test`
-   first-class macros and parameterized helpers
-   minimal suite/group naming, not nested suite trees
-   optional but deeply integrated `@overkill/assert`
-   generic `@overkill/resources`
-   execution resolved in `@overkill/run` from hard constraints and soft preferences
-   worker pools as one strategy, not the universal model
-   separate reporter packages with both real-time and final-result lifecycles
-   reject stdout conflicts by default unless explicitly resolved
-   one umbrella baseline concept with subtype-specific semantics
-   distinct benchmark authoring on top of shared engine contracts
-   curated bundles in addition to fine-grained packages
-   browser support as the next major proof of the architecture after the core microtest stack
