# Configuration

## Purpose

This document defines the configuration concept for Overkill.

The goal is a low configuration surface with a clear split between:

-   engine-level programmatic options
-   higher-level runner or package configuration

Overkill should not grow a second programming model in configuration.

## Core Rule

`@overkill/engine` is API-only.

It does not need:

-   config files
-   file discovery rules
-   project-root conventions
-   loader magic

Engine consumers configure it directly through ordinary TypeScript values and
function calls.

## Higher-Level Configuration

Higher-level packages may support config files, but config remains optional.

That means:

-   `@overkill/test` and `@overkill/run` may read config files
-   direct programmatic composition stays first-class
-   no project should be forced to adopt a config file for small setups

The first-party default should be JavaScript or TypeScript config rather
than custom formats.

## Scope Of Configuration

Configuration should mainly cover orchestration and package wiring:

-   test discovery
-   runtime profiles
-   reporter selection
-   baseline policy (paths, write directory, CI opt-in env var)
-   coverage enablement
-   mutation integration
-   type-test integration
-   browser or benchmark package wiring
-   extension registration

Configuration should avoid becoming the place where test logic lives.

## Low-Surface Philosophy

Overkill should prefer:

-   a few clear top-level keys
-   explicit programmatic registration for advanced cases
-   good defaults

Overkill should avoid:

-   deeply nested option forests
-   dozens of one-off booleans
-   configuration-only features that cannot also be expressed
    programmatically
-   opaque framework behavior hidden behind config

## Recommended File Story

The likely first-party shape is:

```ts
import { defineConfig } from '@overkill/run';

export default defineConfig({
    include: ['source/**/*.test.ts'],
    reporters: ['line'],
    profile: 'microtest',
    coverage: false,
});
```

This should be a thin typed wrapper, not a mandatory DSL.

## Relationship To Packages

Configuration belongs above the engine.

Typical ownership:

-   `@overkill/engine`
    -   programmatic options only
-   `@overkill/test`
    -   high-level authoring helpers that may consume programmatic config
-   `@overkill/run`
    -   config file loading, discovery, orchestration defaults

## Custom Assertions

Custom assertions are a good example of where JavaScript or TypeScript
configuration is useful.

The current concept should allow projects to register additional assertion
vocabularies, especially domain-specific ones such as `Result` / `Maybe`
assertions.

Example direction:

```ts
import { defineConfig } from '@overkill/run';
import { maybeAssertions, resultAssertions } from './test/assertions';

export default defineConfig({
    assertions: [resultAssertions(), maybeAssertions()],
});
```

This should stay additive and explicit:

-   first-party assertions remain the baseline
-   custom assertions extend them
-   config wires them into the high-level test package or runner

## Configuration Versus Plugins

Configuration may attach extensions, but this does not require a heavy plugin
runtime.

The concept should favor:

-   direct imports in JS/TS config
-   stable package contracts
-   shallow registration objects

That is enough for:

-   reporters
-   baseline adapters
-   custom assertions
-   benchmark metric collectors
-   type-test adapters
-   mutation integrations

## What Configuration Should Not Do

Configuration should not become the place for:

-   imperative test setup logic
-   hidden global fixture injection
-   implicit authoring-style switches
-   runner-only versions of features that have no programmatic equivalent

If a feature cannot be explained through the public API, it is probably too
magical for configuration too.

## Settled Direction

-   engine configuration is programmatic only
-   higher-level config files are optional
-   JS/TS config is preferred
-   the surface should stay small and orchestration-focused
-   custom assertion registration is explicitly in scope
