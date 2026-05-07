# Architecture Decisions

This document replaces the former `open-questions.md` design tree.

The large dependency-ordered question set served its purpose while the
concept was still fluid. The major architecture decisions are now settled
enough that the canonical docs should read normatively, and this file should
act only as a compact index of those decisions.

Remaining speculative work belongs in:

-   [`ideas-and-future-directions.md`](./ideas-and-future-directions.md)
-   [`novel-techniques.md`](./novel-techniques.md)
-   clearly marked "open items" inside the specific domain doc that owns the
    topic

## Core Architecture

-   `@overkill/engine` stays narrow.
-   The engine owns generic test definitions, execution plans, events,
    results, reporter contracts, and programmatic integration surfaces.
-   The engine supports both structured outcomes and explicit throwing-mode
    tests.
-   The engine does **not** own snapshot semantics, fixture semantics, or a
    mandatory file-based identity model.

## Default Authoring Model

-   `@overkill/engine` remains directly usable as a low-level API.
-   `@overkill/test` is the single preferred first-party high-level DSL.
-   That high-level DSL should be tests-as-values.
-   Direct-file execution should work through a small helper such as
    `runIfMain(import.meta, spec)`.
-   Test macros are the primary first-party reuse model.
-   Generated-case macros are acceptable as an extension of the macro model,
    not as a separate reuse philosophy.
-   Tables or parameterized helpers are acceptable only as specialized
    helpers built on the same model, not as a competing first-party reuse
    philosophy.
-   The default grouping model is flat tests plus minimal explicit
    suite/group naming.
-   Inline `.skip` / `.only` are not part of the core default concept.
-   True in-source tests are rejected for the planned default concept.
-   Documentation examples should prefer `case` as the injected context name.

## Assertions

-   `@overkill/assert` remains a distinct package, but it is the only
    supported first-party assertion system.
-   The primary end-user DX is builder/context injection, not raw returned
    assertion values.
-   Builder mode injects `assert`, `require`, and `plan`, and requires
    `return assert.done()`.
-   `assert` records ordinary assertions.
-   `require` records gating assertions, supports narrowing, and
    short-circuits on failure.
-   Builder assertions are fail-fast by default; aggregate "run all"
    behavior is explicit.
-   Throwing mode remains supported through an explicit alternate API such as
    `throwingTest`.
-   The low-level assertion protocol is `AssertionNode`.
-   Low-level constructors live under `assertion.*`.
-   Custom assertions are explicitly supported as extensions of the
    first-party assertion system.

## Doubles

-   Overkill has a first-party doubles package.
-   It stays small and explicit.
-   The primary concept is `testDouble()`.
-   The preferred API shape is a config object plus composable rule helpers.
-   Rich direct introspection is first-class.
-   Advanced behavior uses ordered rules plus an answer-function escape hatch.
-   Arg-based behavior starts with exact typed `when(...)` matching.
-   The advanced path stays config-object-driven (`rules`, `fallback`,
    `answer`) rather than introducing a second fluent API.
-   Object-method replacement and module replacement are out of scope for the
    first-party concept.

## Test Ergonomics

-   Overkill should support a first-party harness concept for dependency-heavy
    unit tests.
-   Overkill should support generic interaction transcripts rather than
    framework-specific emitter helpers only.
-   Overkill should support small async queue helpers such as `flushAsync()`,
    `microtasks()`, and `immediate()`.
-   An advanced `inFlight(...)` helper is acceptable as a small opt-in
    mechanic.
-   Overkill should not add a broad first-party step/scenario DSL just to
    make long tests feel more structured.

## Resources And Execution

-   `@overkill/resources` is a generic resource and context composition
    layer.
-   It is the main first-party primitive for integration and browser-style
    test layers.
-   It supports per-run, per-file, per-suite, per-case, shared, and
    exclusive scopes.
-   It should support deterministic local services, temporary registries,
    browser page-object fixtures, and explicit resource-owned attachments.
-   Resources may contribute explicit execution requirements and preferences.
-   `@overkill/run` resolves the final execution plan.
-   Execution constraints include both hard requirements and soft
    preferences.
-   Worker pools are one strategy among several.
-   The default `@overkill/test` execution mode is single-process and
    in-order.
-   Retries are not part of the microtest default, but may exist in
    integration-style modes.
-   Timeout guarantees differ by execution mode.
-   Default microtests stay cheap and in-process.
-   A supervised microtest profile may exist later; crash-only recovery is
    acceptable there.
-   Leaked-resource diagnostics are distinct from hard hang detection.

## Reporters

-   Reporters remain separate packages, with optional curated bundle
    entrypoints.
-   The engine preserves both real-time and final-result reporter
    lifecycles.
-   Reporter sink conflicts, especially stdout conflicts, are understood by
    orchestration and rejected by default unless explicitly resolved.
-   Reporter declarations should include sinks, lifecycle mode, and artifact
    ownership.
-   The engine preserves enough structured detail for multiple presentation
    styles of the same failure or error.

## Baselines And Artifacts

-   Overkill keeps one umbrella baseline concept with semantic subtypes.
-   Stale-baseline detection relies on shared identity, but lives mainly in
    `@overkill/baselines`.
-   Artifact identity is a shared cross-cutting concept.
-   Snapshots are not the default for microtests; they are primarily for
    integration, browser, and workflow-oriented families.
-   Baseline updates are always explicit.
-   Artifact paths are fully readable.
-   Stale artifacts are marked stale rather than renamed automatically.

## Benchmarking

-   `@overkill/bench` has its own top-level authoring model.
-   It reuses engine-level execution and reporting contracts.
-   Workloads are first-class.
-   Benchmark packages may force single-worker execution as a hard
    constraint.
-   Performance baselines live under the umbrella baseline model, but with
    benchmark-specific semantics.

## Bundles, Metadata, And Extensions

-   Overkill ships curated bundles in addition to fine-grained packages.
-   Both meta-packages and opinionated re-export packages are acceptable,
    but the number of curated bundles should stay small.
-   `@overkill/all` is acceptable only as onboarding or evaluation
    convenience.
-   Metadata is a first-class shared concept.
-   Overkill promises reproducible run intent and planning, not bit-for-bit
    equivalence across machines.
-   Overkill does not need a heavy plugin runtime; stable package contracts
    are the main extension surface.
-   The higher-level stack may support optional JS/TS config files.
-   The engine remains programmatic-only.
-   Config should stay low-surface and orchestration-focused.

## Planned Integration Direction

-   Browser support should become first-class soon after the default
    microtest stack is coherent.
-   Browser support should stay adapter-driven above the shared runtime,
    baseline, and artifact model.
-   Property-based testing should follow browser/integration support.
-   Property-based tests are a real higher-layer family with seed,
    shrinking, and witness needs.
-   Stryker integration is planned from the beginning.
-   Coverage is planned from the beginning, but stays explicit and off by
    default.
-   Type tests are supported through adapters or integrations rather than a
    custom engine.
-   Watch mode should lean on Node's built-in `--watch` behavior by default.
-   Stable machine-readable APIs should make IDE and MCP integrations easy.
-   Remote execution is an architectural direction from the start, not an
    immediate release requirement.

## Rejected Or Deferred Directions

The full list with rationale lives in [`non-goals.md`](./non-goals.md);
the highlights:

-   No first-class production-facing `@overkill/world` package in the
    current concept.
-   No Overkill dependency should be required in consumer production code.
-   No first-party object or module patching story in doubles.
-   No in-source tests as the planned default authoring model.
-   No always-on coverage in the default run mode.
