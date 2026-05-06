# Credits

This document records important ideas Overkill borrows or adapts from other
tools, libraries, and articles.

The purpose is not branding or name-dropping. The purpose is intellectual
honesty and future traceability.

## Testing And DSL Design

-   **AVA**
    -   macros as a serious reuse model rather than a novelty
    -   assertion-count discipline and failure on zero assertions as a
        quality signal
-   **Swift Testing**
    -   the explicit split between ordinary assertions and gating checks
        inspired Overkill’s `assert` / `require` concept
-   **Haskell `tasty`**
    -   tests as explicit values and unified trees consumed by one runner
-   **RackUnit / Racket**
    -   tests as suites-as-values and the broader idea that authoring does not
        need to begin from side-effectful registration
-   **Rust**
    -   structured test outcomes and the idea that throwing/panic-style tests
        can coexist with richer result models

## Doubles And Interaction Testing

-   **Sinon**
    -   strong direct introspection on doubles (`callCount`, `firstCall`,
        ordering)
    -   small behavior helpers such as `returns`, `resolves`, `rejects`,
        `throws`
    -   Overkill intentionally borrows these strengths while rejecting the
        larger surface and patching culture
-   **testdouble.js**
    -   useful precedent for argument-based behavior definitions such as
        `when(...)`

## Property, Model, And Advanced Testing

-   **QuickCheck and related property-testing work**
    -   the importance of generators, shrinking, and properties as a distinct
        testing family
-   **model-based and metamorphic testing literature**
    -   the idea that relation-based checks matter more than surface-level DSL
        style in advanced testing

## Browser, Runtime, And Platform Philosophy

-   **platform-first web framework work**
    -   the broader philosophy of building on platform primitives rather than
        replacing them with framework-local concepts
-   **Node.js and Web Platform APIs**
    -   direct use of platform capabilities such as `AbortSignal`,
        diagnostics channels, `perf_hooks`, and typed runtime contexts

## Benchmarking

-   **JMH**
    -   warmup / measurement separation and execution policy as part of the
        benchmark definition
-   **Criterion.rs**
    -   grouped benchmarks, parameterized benchmark identities, and richer
        measurement vocabulary
-   **BenchmarkDotNet**
    -   benchmark jobs and diagnoser-style metric collection
-   **hyperfine**
    -   external-process benchmarking as a primary workflow
-   **packtory and eslint-plugin-mocha local benchmark suites**
    -   practical evidence that real projects need workload files, checked-in
        thresholds, PTY-aware CLI benchmarks, and richer metrics than runtime
        alone

## Why This File Exists

Overkill should stay opinionated, but it should not pretend every good idea
originated here.

When a concept is clearly inspired by prior art, the documentation should say
so.
