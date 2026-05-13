# Documentation Strategy

## Purpose

This document captures how the user-facing Overkill documentation should be
structured.

The guiding problem is clear: Overkill wants to support advanced mechanics
without overwhelming new users or making the product look larger than it
needs to be.

## Principle

The docs should reflect the low-API-surface principle.

That means:

-   show the common path first
-   keep advanced mechanics discoverable but not foregrounded
-   document layers separately so users only learn the layer they need

## Documentation Layers

The user-facing documentation should likely be organized in layers.

### 1. Quick Start

Show only the smallest useful first-party path:

-   write a simple test
-   run it
-   read a failure

Do not introduce advanced helpers here.

### 2. Core Concepts

Introduce only the concepts most users need early:

-   tests as values
-   `assert` / `require`
-   `case`
-   macros
-   microtests versus integration-style tests

### 3. Common Workflows

Focused guides for the common day-to-day tasks:

-   writing fast microtests
-   organizing suites and macros
-   using doubles
-   enabling coverage
-   adding reporters

### 4. Advanced Topics

This is where the rarer mechanics belong:

-   `defineHarness(...)`
-   transcript recording
-   reusable multi-case macros
-   `inFlight(...)`
-   queue-flush helpers
-   benchmark workloads and policies
-   browser metrics backends

These should exist, but they should not be in the first screenful of the
main docs.

### 5. Reference

Reference documentation should be complete and searchable, but not the main
learning path.

## API Presentation

The API overview should not dump every helper equally.

Prefer:

-   a short “start here” API list
-   separate advanced reference pages
-   package-by-package reference sections

Avoid:

-   one giant flat API index that makes Overkill look bigger than it is
-   presenting every advanced helper as required knowledge

## Progressive Disclosure

Progressive disclosure should be intentional:

-   beginners see tests, assertions, and running
-   intermediate users see doubles, macros, baselines, and reporters
-   advanced users find harnesses, recording, flush helpers, mutation,
    browser-performance metrics, and custom assertion registration

## Examples

Examples should prefer:

-   `case` over `t`
-   no inline destructuring by default
-   realistic but small examples
-   one concept per example

Advanced examples can compose multiple concepts, but basic examples should
not.

## What To Avoid

The docs should avoid:

-   leading with the full package graph
-   leading with every possible test style
-   leading with every advanced utility
-   assuming users want framework-level ceremony for small tests

Overkill should feel smaller than its internal architecture.
