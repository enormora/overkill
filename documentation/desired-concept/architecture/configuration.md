# Configuration

## Purpose

This document defines the configuration concept for Overkill.

The goal is a low configuration surface with a clear split between:

- engine-level programmatic options
- higher-level runner or package configuration

Overkill should not grow a second programming model in configuration.

## Core Rule

`@overkill/engine` is API-only.

It does not need:

- configuration files
- file discovery rules
- project-root conventions
- loader magic

Engine consumers configure it directly through ordinary TypeScript values and
function calls.

## Higher-Level Configuration

Higher-level packages may support configuration files, but configuration
remains optional.

That means:

- configuration loading belongs above the engine, in `@overkill/run`
- higher layers may contribute configuration domains even when they do not
  own file discovery
- direct programmatic composition stays first-class
- no project should be forced to adopt a configuration file for small setups

The first-party default should be JavaScript or TypeScript configuration
rather than custom formats.

## Scope Of Configuration

Configuration should mainly cover orchestration and package wiring:

- test discovery
- named profile definitions
- reporter selection
- baseline policy (paths, write directory, explicit update behavior,
  no environment-based write gate)
- coverage policy (formats, thresholds, include/exclude, output paths)
- optional global assertion budget policy
- mutation integration
- type-test integration
- browser or benchmark package wiring
- runtime-state directory (`runtimeStateDir`, default `.overkill`) — root for run records, witnesses, fuzzing/property corpus, debug-mode artifacts, and other runtime-owned outputs

Configuration should avoid becoming the place where test logic lives.

One important distinction: `@overkill/run` may be the place that loads,
merges, and validates configuration files, but it is not the semantic owner of
every key. Browser, benchmark, assertion, baseline, or type-test packages
may each contribute their own configuration surface above the engine. The
runner's job is to assemble those surfaces into one coherent configuration
entry point, not to collapse every higher-layer concept into "runner
configuration."

## Low-Surface Philosophy

Overkill should prefer:

- a few clear top-level keys
- explicit programmatic registration for advanced cases
- good defaults

Overkill should avoid:

- deeply nested option forests
- dozens of one-off booleans
- configuration-only features that cannot also be expressed
  programmatically
- CLI-only features that cannot also be expressed through the public
  programmatic API on the owning package
- opaque framework behavior hidden behind configuration

## Recommended File Story

The first-party shape is:

```ts
import { defineConfig } from '@overkill/run';
import { createLineReporter } from '@overkill/reporter-line';

export default defineConfig({
    include: [ 'source/**/*.test.ts' ],
    reporters: [ createLineReporter() ],
    coverage: {
        formats: [ 'text', 'lcov' ]
    }
});
```

This should be a thin typed wrapper, not a mandatory DSL.

Important ownership split:

- configuration defines persistent project policy
- CLI chooses per-run intent
- programmatic `RunRequest` values choose the same per-run intent without
  going through CLI parsing

So, for example:

- `--profile <name>` chooses which runner profile to use for this run
- `--coverage` chooses whether this run collects coverage
- `run({ profile: 'microtest', coverage: true })` should express the same
  intent directly through `@overkill/run`
- an optional global assertion budget policy lives in configuration because
  it is centrally enforced suite policy rather than per-test authoring
- `coverage.formats`, `coverage.thresholds`, `coverage.include`, and
  `coverage.outputDir` live in configuration because they describe how
  coverage behaves once activated

## Configuration Layering

Project policy should come from configuration files, not from overlapping
configuration channels.

Canonical shape:

- one root `overkill.config.ts` defines project policy
- in a monorepo, package-level configuration files may extend that root
  policy where the workspace concept genuinely needs per-package differences
- built-in defaults fill gaps, but there is no second user-level
  configuration layer and no parallel environment-variable configuration
  surface

The only configuration-oriented CLI flag should be `--config <path>` to pick
the configuration file location explicitly when discovery is not enough.

Important distinction:

- configuration files define project policy
- ordinary CLI selection and run-intent flags such as `--file`, `--name`,
  `--id`, `--seed`, or `--shard` are still valid because they are not a
  second configuration channel; they are one run request against that
  policy

Configuration files are TS modules exporting a default configuration value.
The runner imports them via the same loader pipeline as test files (Node type
stripping). No JSON or YAML schema; types over schema.

Where package-level configuration exists, it should extend the root
configuration through typed composition rather than by inventing unrelated
ad-hoc precedence rules.

## Relationship To Packages

Configuration belongs above the engine. `@overkill/run` owns configuration
file loading, discovery, and cross-package merging/validation. Higher-level
packages may still contribute their own configuration domains such as browser
wiring, benchmark metric collectors, baseline policy, or type-test
adapters. The detailed package-boundary matrix lives in
[Package Architecture](./package-architecture.md).

## Assertion Registration Belongs To The Engine Assertion Context

Custom assertion registration should not live in root runner configuration. It
changes what the injected engine assertion context exposes, so it belongs to
engine-level assertion setup instead.

The root configuration still owns orchestration. The engine-owned assertion
context owns what `case.assert` and `case.require` expose.

Example direction:

```ts
import { defineCompositeAssertion } from '@overkill/assert';
import type { TestDouble } from '@overkill/doubles';

const calledOnceWith = defineCompositeAssertion(
    'calledOnceWith',
    <TArg>(check, sut: TestDouble<[TArg], unknown>, expected: TArg) => {
        return check.group([ check.calledOnce(sut), check.calledWith(sut, expected) ]);
    }
);
```

That resulting assertion surface may then be re-exposed by higher-level
authoring layers, but registration itself does not belong to runner config
or to `@overkill/test`.

## Configuration Versus Plugins

Configuration may attach extensions, but this does not require a heavy plugin
runtime.

The concept should favor:

- direct imports in JS/TS configuration
- stable package contracts
- shallow registration objects

That is enough for:

- reporters
- baseline adapters
- benchmark metric collectors
- type-test adapters
- mutation integrations

## What Configuration Should Not Do

Configuration should not become the place for:

- imperative test setup logic
- hidden global fixture injection
- implicit authoring-style switches
- runner-only versions of features that have no programmatic equivalent

If a feature cannot be explained through the public API, it is probably too
magical for configuration too.

## Settled Direction

- engine configuration is programmatic only
- higher-level configuration files are optional
- JS/TS configuration is preferred
- configuration loading and discovery live above the engine, in
  `@overkill/run`
- higher layers may contribute configuration domains even when the runner
  owns the top-level loading step
- the surface should stay small and orchestration-focused
- custom assertion registration belongs to the engine-owned assertion
  context, not root
  configuration
