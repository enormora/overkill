# Assertions And Results

## The Problem

Overkill needs a result model that is:

-   simple enough for the core
-   rich enough for integrations
-   flexible enough for assertion tracking

## Baseline Outcome Contract

The core should accept at least two broad styles:

-   throw or reject to indicate failure
-   return an explicit structured outcome

This follows the broad lesson from Rust and similar systems that “failure as exception” and “failure as returned result” can coexist.

Source:

-   <https://doc.rust-lang.org/rust-by-example/testing/unit_testing.html>

## Why A First-Party Assertion Package Still Makes Sense

Assertion tracking is hard to do well if assertions are entirely external. A first-party assertion package offers a clean place to provide:

-   assertion count tracking
-   `plan()`-style guarantees
-   zero-assertion detection
-   rich diffs and mismatch metadata
-   baseline-aware serializers

It should remain optional so the core stays open to other authoring styles.

## Alternatives Worth Preserving

The docs should preserve room for future exploration of:

-   assertions as explicit returned values
-   assertions as accumulated structured effects
-   result combinators inspired by functional languages
-   domain-specific baseline comparisons with semantic matchers

Vitest’s recent domain snapshot adapter model is a useful sign that richer comparison contracts are practical in real tooling.

Source:

-   <https://vitest.dev/guide/snapshot.html>

## Current Concept Leaning

For the product concept:

-   core supports throw/reject and explicit result shapes
-   first-party assertions live in `@overkill/assert`
-   richer semantics should be layered on top of the core rather than forced into every test
