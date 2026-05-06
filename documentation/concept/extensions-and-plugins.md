# Extensions And Plugins

## Purpose

This document defines the concept for third-party and first-party extensions built on top of Overkill's API-first architecture.

## Position

Extensions should be easy because the architecture is API-first, but the concept should still name the major extension surfaces explicitly.

## Main Extension Surfaces

The most important extension types are:

-   reporters
-   baseline adapters
-   serializer adapters
-   custom assertions
-   resource and environment factories
-   benchmark metric collectors
-   benchmark policy adapters
-   orchestration helpers
-   future browser and workflow integrations

## Architectural Rule

Extensions should compose through stable contracts, not through private runner patch points.

That means:

-   reporters consume structured events or finished results
-   resource packages contribute explicit environment or execution constraints
-   baselines contribute identity, collection, comparison, and update semantics
-   benchmark packages contribute workloads, measurements, and policies

## Plugin Philosophy

Overkill does not need a giant global plugin container to be extensible.

The likely direction is:

-   stable package-level APIs
-   stable contracts in `@overkill/engine`
-   orchestration-level composition in `@overkill/run`

That is enough for many extension stories without inventing a heavy plugin runtime.

## When A Plugin Model Is Worth Naming

It is still useful to talk about "plugins" conceptually when the extension is discovered and attached by configuration rather than imported directly in code.

Typical cases:

-   reporters selected by config
-   baseline adapters
-   benchmark metric collectors
-   custom assertions selected by config

The same openness should make it straightforward for third parties to build:

-   IDE integrations
-   MCP servers
-   remote execution coordinators
-   type-test adapters
-   mutation-testing adapters
-   browser-runtime adapters
-   accessibility or compliance fixtures
-   interaction-transcript collectors for transports such as HTTP or browser
    requests

The concept should therefore allow both:

-   direct programmatic composition
-   config-driven plugin attachment
