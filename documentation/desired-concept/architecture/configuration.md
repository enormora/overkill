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
function calls. `runIfMain(import.meta, testNode, options?)` is the narrow
exception owned by `@overkill-dev/run` and lazily exposed by
`@overkill-dev/test`, because direct-file execution needs config loading,
profile matching, default reporters, and runner-owned facts. It loads config
from `process.cwd()` only when `import.meta.main` is true. Profile matching does
not select a reduced direct-execution mode. The matched profile remains the
execution contract.

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
- microtest coverage policy (outputs, source scope, thresholds, output path)
- resource usage policy and resource-budget thresholds (Node-first JavaScript
  engine heap, resident set, resident-set growth, and active-resource limits by
  profile)
- timing collection policy (`summary` by default, `precise` for detailed
  runner diagnostics)
- run-record persistence defaults per profile
- compact-history retention and maintenance policy
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
import { createLineReporter } from '@overkill-dev/test/reporters';

export const config = defineConfig({
    reporters: [ createLineReporter() ],
    profiles: {
        unit: {
            testFamily: 'microtest',
            files: {
                include: [ 'source/**/*.test.ts' ],
                exclude: [ 'source/integration-tests/**/*.test.ts' ]
            }
        },
        'backend-http': {
            testFamily: 'integration',
            retries: { maxAttempts: 3, artifacts: 'first-failure-and-final' },
            files: {
                include: [ 'source/integration-tests/http/**/*.test.ts' ]
            }
        }
    }
});
```

`retries` is integration-only. `maxAttempts` must be a positive safe integer
and counts the initial attempt. Omitted retry policy normalizes to `null`.
Artifact retention defaults to `first-failure-and-final`; alternatives are
`last-failure-and-final` and `all`. The resolved policy is frozen in
`RunFacts.execution.retries`, including direct-file execution.

This should be a thin typed wrapper, not a mandatory DSL.

CLI usage may auto-discover a root `overkill.config.ts` because the CLI is the
human project entry point. Direct package usage does not auto-discover that
file:

```ts
import { loadConfig, run } from '@overkill-dev/run';

const config = await loadConfig({
    configPath: 'overkill.config.ts',
    cwd: process.cwd()
});

await run({ config, cwd: process.cwd(), engine: { kind: 'default' }, request });
```

Callers that already have policy in memory pass it directly:

```ts
import { run, normalizeConfig } from '@overkill-dev/run';
import { defineConfig } from '@overkill-dev/test/config';

const config = defineConfig({
    profiles: {
        unit: {
            testFamily: 'microtest',
            files: {
                include: [ 'source/**/*.test.ts' ]
            },
            coverage: {
                outputs: [ 'text', 'lcov' ],
                sources: {
                    mode: 'all',
                    include: [ 'source/**/*.ts' ],
                    exclude: [ 'source/**/*.test.ts' ]
                },
                thresholds: { lines: 90 }
            },
            resourceUsage: {
                measure: true,
                budgets: {
                    javaScriptEngineHeapBytes: 128000000,
                    residentSetBytes: 512000000,
                    residentSetGrowthBytesPerSecond: 50000000,
                    activeResourceCount: 40
                },
                samplingIntervalMilliseconds: 100
            },
            execution: {
                maxConcurrency: 5,
                processModel: 'in-process',
                scheduling: 'concurrent'
            },
            timeouts: {
                softMilliseconds: 500,
                hardMilliseconds: 1000
            },
            runRecords: {
                persist: 'on-demand'
            }
        }
    },
    history: {
        detailedRunLimit: 20,
        successfulArtifactRunLimit: 5,
        failingArtifactRetentionDays: 7,
        runSummaryLimit: 500,
        runSummaryRetentionDays: 90,
        staleIdentityRetentionDays: 90,
        observationsPerIdentity: 20,
        automaticMaintenanceBudgetMilliseconds: 100,
        lockTimeoutMilliseconds: 5000,
        staleLockMilliseconds: 120000
    }
});

await run({
    config: normalizeConfig(config),
    cwd: process.cwd(),
    engine: { kind: 'default' },
    request: { ...request, coverage: true, profile: 'unit' }
});
```

`resourceUsage.measure: true` enables run-level diagnostic measurement for the
profile. `resourceUsage.budgets` are thresholds and therefore require measurement.
Omitting `resourceUsage.budgets` records usage without requesting enforcement.

Top-level `reporters` are the project fallback for runner profiles. When the
selected profile defines `reporters`, that list replaces the top-level list for
the run instead of merging with it. If neither the selected profile nor the
top-level config defines reporters, the CLI supplies its default line reporter.

Important ownership split:

- configuration defines persistent project policy
- CLI chooses per-run intent and may discover the project configuration file
- programmatic `RunRequest` values choose the same per-run intent without
  going through CLI parsing
- programmatic APIs require an explicit `NormalizedConfig` value; loading a file is a
  separate `loadConfig(...)` call

Coverage policy is available only on `testFamily: 'microtest'` profiles. The
configuration type rejects it on other profile families. `outputs` defaults to
`['v8', 'lcov']`, `sources` defaults to loaded runtime files, thresholds default
to disabled, and `outputDir` defaults to the per-run runtime-state directory.

The config API uses command-independent types: `Config` is authored policy,
`NormalizedConfig` has validated defaults, and `LoadedConfig` adds `configPath`.
`normalizeConfig(config)` validates in-memory policy without filesystem access.
`loadConfig(request)` uses the same normalization with file-origin context.
Programmatic run and list calls accept `NormalizedConfig`; they do not load files.
An in-memory config has no file origin, so `coverage.outputDir` requires loading
from a config file.

The internal shared config module owns schemas, defaults, validation, snapshots,
and profile file evaluation. Commands derive selected profiles, discovered
files, and effective reporters from the complete registry. They do not filter
benchmark profiles out of project policy. `runIfMain` preserves profile
ambiguity errors and rejects a sole benchmark match instead of using microtest
fallback.

So, for example:

- `--profile <name>` chooses which runner profile to use for this run
- `--coverage` requests coverage for this run and is valid only with a
  microtest profile
- `--measure-resource-usage` chooses per-run diagnostic resource usage
  measurement
- `--resource-budget <name=value>` chooses per-run resource-budget overrides
  and enables resource usage measurement
- `--timings` requests precise runner timing collection for this run
- `--record` requests a detailed run record and compact-history update for
  this run
- `run({ profile: 'unit', coverage: true })` expresses the same coverage
  intent through `@overkill-dev/run`
- an optional global assertion budget policy lives in configuration because
  it is centrally enforced suite policy rather than per-test authoring
- resource-budget defaults live in configuration because they describe suite
  policy; per-run overrides are allowed for intentionally heavy runs and must
  be visible in failure messages
- microtest `coverage` policy lives on the selected profile because source
  scope, outputs, thresholds, and output are persistent project policy;
  presence of that policy does not activate coverage
- programmatic microtest `execution: { mode: 'serial' }` strengthens scheduling
  for one invocation without changing configured process model or other policy;
  `mode: 'profile-default'` retains profile scheduling

Timing policy follows the same split. `profiles.<name>.timings.collection`
sets the project default for that profile. `--timings` and programmatic
`RunRequest` values may upgrade one run to precise timing collection without
changing project policy.

Run-record policy follows the same split. `profiles.<name>.runRecords.persist`
sets whether that profile persists records by default. The default is
`'on-demand'`, so ordinary microtest runs stay on the hot path. `--record` and
programmatic `RunRequest` values may persist one run without changing project
policy. Active workflows such as debug retention, coverage artifacts, and
history-backed selection may require persistence regardless of the profile
default.

Top-level `history` policy owns retention, compact-history sizing, lock
timeouts, stale-lock handling, and automatic maintenance budgets. It is global
because pruning and compact history operate on the shared runtime-state
directory rather than on one selected profile.

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
- benchmark configuration uses named profiles with `testFamily: 'benchmark'`;
  benchmark commands select those profiles through `overkill bench`

The only configuration-oriented CLI flag should be `--config <path>` to pick
the configuration file location explicitly when discovery is not enough.

The runner should not search for `overkill.unit.config.ts`,
`overkill.integration.config.ts`, `overkill.browser.config.ts`, or similar
suite-family files. Those names look convenient, but they create unclear
precedence and make the final policy harder to explain in `RunFacts`.
Use profiles for ordinary and optional runtime families instead:

```ts
export const config = defineConfig({
    reporters: [ createLineReporter() ],
    profiles: {
        'unit-fast': {
            testFamily: 'microtest',
            files: {
                include: [ 'source/**/*.test.ts' ],
                exclude: [ 'source/integration-tests/**/*.test.ts' ]
            },
            execution: {
                maxConcurrency: 5,
                processModel: 'in-process',
                scheduling: 'concurrent'
            }
        },
        'backend-http': {
            testFamily: 'integration',
            files: {
                include: [ 'source/integration-tests/http/**/*.test.ts' ],
                exclude: []
            },
            execution: {
                hostProcess: { kind: 'direct' },
                maxConcurrency: 5,
                maxWorkers: 4,
                processModel: 'worker-pool',
                scheduling: 'concurrent',
                workerLifecycle: 'fresh-worker-per-unit',
                workDistribution: { mode: 'file' },
                assignmentPolicy: 'case-count-balanced',
                dispatchPolicy: 'dynamic-lease'
            }
        },
        'cli-cold-start': {
            testFamily: 'benchmark',
            files: {
                include: [ 'source/**/*.bench.ts' ],
                exclude: []
            }
        }
    }
});
```

`execution.maxConcurrency` is a positive safe integer applied per executor.
It defaults to `5`. Use `'unlimited'` to preserve unbounded concurrent
admission. Serial scheduling always admits one case at a time.

Benchmark profiles share the project registry with ordinary profiles.
`overkill run` and `overkill list` reject selected benchmark profiles and direct
callers to `overkill bench`. A microtest profile named `benchmark` remains valid.
Benchmark profiles configure `testFamily`, `files`, `execution`, `reporters`,
`attachments`, `resourceUsage`, `timings`, and `timeouts`. Current runner
integration supports isolated serial execution with one lane and hedging off.
Collection, soft, and hard timeouts default to 5000, 40000, and 60000 ms;
soft must not exceed hard, and hard must not exceed 60000 ms. Concurrent work
groups are rejected until measurement strategy and calibration establish safe
parallel placement.
Benchmark commands accept explicit `--profile <name>` selection or infer the
sole benchmark profile in the complete registry when omitted. Zero or multiple
benchmark profiles require explicit selection. Path operands do not influence
profile inference.

Direct `NormalizedConfig` values can choose worker-pool host shape with
`execution.hostProcess`. Project configuration files do not expose that key
until the configuration schema has a stable policy for which Node/V8 arguments
are acceptable in persistent project policy.

Worker-pool profiles may set `execution.maxWorkers` to a positive safe integer.
It caps automatic sizing and explicit `--workers N` requests. Work constraints
may resolve fewer executor lanes.

Profile names are project-owned strings. First-party config validates that a
profile name is non-empty and contains only letters, numbers, dots,
underscores, and hyphens. Names such as `backend-http`, `ui.integration`, and
`unit_fast` are valid. Spaces, slashes, backslashes, and punctuation outside
that set are rejected.

Configured profile file discovery uses one of two shapes.

Simple profiles use top-level include and exclude globs:

```ts
files: {
    include: [ 'source/**/*.test.ts' ],
    exclude: [ 'source/**/*.slow.test.ts' ]
}
```

Profiles that need named discovery buckets use `sets` instead:

```ts
files: {
    sets: {
        integration: {
            include: [ 'source/integration/**/*.test.ts' ],
            exclude: [ 'source/integration/**/*.slow.test.ts' ]
        },
        unit: {
            include: [ 'source/unit/**/*.test.ts' ]
        }
    }
}
```

`include` is required for every include/exclude policy and `exclude` defaults
to `[]`. `files.sets` is mutually exclusive with top-level `include` and
`exclude`; the union of non-overlapping set matches is the profile's
discovered file set. Every configured set must match at least one file before
per-run path narrowing. A file matched by more than one set is an invalid
request.

Set names are project-owned strings with the same character rules as profile
names: letters, numbers, dots, underscores, and hyphens. The name `benchmark`
is valid for both profiles and file sets; names never select behavior.

Patterns are interpreted relative to the run cwd. Absolute patterns, parent
segments, blank patterns, and negated patterns are rejected. Overkill uses
Node's glob support with the separate `exclude` option, so negated patterns are
not part of the public config language.

When a run has no path operands, the selected profile's `files` policy
discovers candidate test modules. Explicit file operands bypass top-level
include/exclude discovery. When the profile uses `files.sets`, each explicit
file must match exactly one set. Directory operands do not define new globs;
they filter the selected profile's discovered file set and cannot be mixed
with file operands.

Important distinction:

- configuration files define project policy
- ordinary CLI selection and run-intent flags such as `--file`, `--title`,
  `--id`, `--seed`, or `--shard` are still valid because they are not a
  second configuration channel; they are one run request against that
  policy

Configuration files are TS modules exporting a named `config` value. CLI
discovery and explicit `loadConfig(...)` calls import them via the same
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
policy, and benchmark configuration. Optional packages start with typed imported
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
- programmatic configuration loading is explicit through `loadConfig(...)`
- programmatic `run(...)` and `resolveRun(...)` accept an already resolved
  configuration value and do not auto-load files
- suite-family differences are runner profiles in one project policy, not
  separate fixed-path config files
- higher layers may contribute configuration domains even when the runner
  owns the top-level loading step
- the surface should stay small and orchestration-focused
- custom assertion references are imported values, not root configuration
