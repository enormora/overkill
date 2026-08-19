# Configuration

## Purpose

This document defines the configuration concept for Overkill.

The goal is a low configuration surface with a clear split between:

- engine-level programmatic options
- higher-level runner or package configuration

Overkill should not grow a second programming model in configuration.

## Core Rule

`@overkill-dev/engine` is API-only.

It does not need:

- configuration files
- file discovery rules
- project-root conventions
- loader magic

Engine consumers configure it directly through ordinary TypeScript values and
function calls. The engine-owned `runIfMain(import.meta, testNode, options?)`
helper follows that rule: its third argument is execution options such as
reporters and run facts, not project configuration.

## Higher-Level Configuration

Higher-level packages may support configuration files, but configuration
remains optional.

That means:

- configuration loading belongs above the engine, in `@overkill-dev/run`
- higher layers may contribute configuration domains even when they do not
  own file discovery
- direct programmatic composition stays first-class
- programmatic callers never get file loading unless they call a loading API
  themselves
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
- resource usage policy and resource-budget thresholds (Node-first JavaScript
  engine heap, resident set, resident-set growth, and active-resource limits by
  profile)
- optional global assertion budget policy
- mutation integration
- type-test integration
- browser or benchmark package wiring
- runtime-state directory (`runtimeStateDir`, default `.overkill`) - root for run records, witnesses, fuzzing/property corpus, debug-mode artifacts, and other runtime-owned outputs

Configuration should avoid becoming the place where test logic lives.

One important distinction: `@overkill-dev/run` may be the place that loads,
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
import { defineConfig } from '@overkill-dev/test/config';
import { lineReporter } from '@overkill-dev/test/reporters';

export default defineConfig({
    include: [ 'source/**/*.test.ts' ],
    reporters: [ lineReporter() ],
    coverage: {
        formats: [ 'text', 'lcov' ]
    }
});
```

This should be a thin typed wrapper, not a mandatory DSL.

CLI usage may auto-discover a root `overkill.config.ts` because the CLI is the
human project entry point. Direct package usage does not auto-discover that
file:

```ts
import { loadRunConfig, run } from '@overkill-dev/run';

const config = await loadRunConfig({
    configPath: 'overkill.config.ts',
    cwd: process.cwd()
});

await run({ config, request });
```

Callers that already have policy in memory pass it directly:

```ts
import { run } from '@overkill-dev/run';
import { defineConfig } from '@overkill-dev/test/config';

const config = defineConfig({
    include: [ 'source/**/*.test.ts' ],
    profiles: {
        microtest: {
            coverage: {
                formats: [ 'text', 'lcov' ]
            },
            measureResourceUsage: true,
            resourceBudgets: {
                javaScriptEngineHeapBytes: 128000000,
                residentSetBytes: 512000000,
                residentSetGrowthBytesPerSecond: 50000000,
                activeResourceCount: 40
            },
            resourceUsageSamplingIntervalMilliseconds: 100
        }
    }
});

await run({ config, request });
```

`measureResourceUsage: true` enables run-level diagnostic measurement for the
profile. `resourceBudgets` are thresholds and therefore require measurement.
Omitting `resourceBudgets` records usage without requesting enforcement.

Important ownership split:

- configuration defines persistent project policy
- CLI chooses per-run intent and may discover the project configuration file
- programmatic `RunRequest` values choose the same per-run intent without
  going through CLI parsing
- programmatic APIs require an explicit `RunConfig` value; loading a file is a
  separate `loadRunConfig(...)` call

So, for example:

- `--profile <name>` chooses which runner profile to use for this run
- `--coverage` chooses whether this run collects coverage
- `--measure-resource-usage` chooses per-run diagnostic resource usage
  measurement
- `--resource-budget <name=value>` chooses per-run resource-budget overrides
  and enables resource usage measurement
- `run({ profile: 'microtest', coverage: true })` should express the same
  intent directly through `@overkill-dev/run`
- an optional global assertion budget policy lives in configuration because
  it is centrally enforced suite policy rather than per-test authoring
- resource-budget defaults live in configuration because they describe suite
  policy; per-run overrides are allowed for intentionally heavy runs and must
  be visible in failure messages
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
- unit, integration, browser, and type-test differences normally live as
  named profiles in that one policy file, not as separate convention files
- benchmark policy lives in the standard `benchmark` configuration domain
  because benchmark execution uses the `overkill bench` namespace

The only configuration-oriented CLI flag should be `--config <path>` to pick
the configuration file location explicitly when discovery is not enough.

The runner should not search for `overkill.unit.config.ts`,
`overkill.integration.config.ts`, `overkill.browser.config.ts`, or similar
suite-family files. Those names look convenient, but they create unclear
precedence and make the final policy harder to explain in `RunFacts`.
Use profiles for ordinary and optional runtime families instead:

```ts
export default defineConfig({
    profiles: {
        microtest: {
            include: [ 'source/**/*.test.ts' ],
            execution: { mode: 'worker-pool' }
        },
        integration: {
            include: [ 'source/integration-tests/**/*.test.ts' ],
            execution: { mode: 'process-per-file' }
        }
    },
    benchmark: {
        include: [ 'source/**/*.bench.ts' ],
        execution: { mode: 'serial' }
    }
});
```

Benchmark policy is a standard top-level configuration domain because
benchmark execution uses `overkill bench`, not `overkill run --profile
benchmark`.

Important distinction:

- configuration files define project policy
- ordinary CLI selection and run-intent flags such as `--file`, `--name`,
  `--id`, `--seed`, or `--shard` are still valid because they are not a
  second configuration channel; they are one run request against that
  policy

Configuration files are TS modules exporting a default configuration value. CLI
discovery and explicit `loadRunConfig(...)` calls import them via the same
loader pipeline as test files (Node type stripping). No JSON or YAML schema;
types over schema.

Where package-level configuration exists, it should extend the root
configuration through typed composition rather than by inventing unrelated
ad-hoc precedence rules.

## Relationship To Packages

Configuration belongs above the engine. `@overkill-dev/run` owns configuration
file loading APIs, CLI discovery, and cross-package merging/validation.
Standard-stack packages may still contribute their own configuration domains
where that matches project policy, such as reporters, coverage, baseline
policy, and benchmark policy. Optional packages start with typed imported
values such as profile factories, runtime/resource factories, reporters,
baseline adapters, or authoring helpers rather than adding package-owned
top-level config keys by default. The detailed package-boundary matrix lives in
[Package Architecture](./package-architecture.md).

## Custom Assertions Are Lexical Imports

Custom assertions should not live in root runner configuration. Assertion
references are ordinary imported values used inside tests:

```ts
import { doubleUsage } from '@overkill-dev/doubles';

test('publishes once', (scope) => {
    scope.assert(doubleUsage.calledOnceWith, harness.publish, [ expected ]);
    return scope.assert.collect();
});
```

The root configuration still owns orchestration. The engine owns assertion
recording, counting, `require` short-circuiting, and result normalization.
Custom assertion availability is lexical, not configuration-driven.

## Configuration Versus Plugins

Configuration may attach extensions, but this does not require a heavy plugin
runtime.

The concept should favor:

- direct imports in JS/TS configuration
- stable package contracts
- shallow registration objects
- typed factories for optional-package profiles, runtimes, reporters, and
  adapters

That is enough for:

- reporters
- baseline adapters
- benchmark metric collectors
- type-test adapters
- mutation integrations

Installing a package does not mutate the CLI, trigger package-name discovery,
or widen top-level configuration through module augmentation in the current
concept.

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
- CLI configuration discovery lives above the engine, in `@overkill-dev/run`
- standard users import `defineConfig(...)` from `@overkill-dev/test/config`
- programmatic configuration loading is explicit through `loadRunConfig(...)`
- programmatic `run(...)` and `resolveRun(...)` accept an already resolved
  configuration value and do not auto-load files
- suite-family differences are runner profiles in one project policy, not
  separate fixed-path config files
- higher layers may contribute configuration domains even when the runner
  owns the top-level loading step
- the surface should stay small and orchestration-focused
- custom assertion references are imported values, not root configuration
