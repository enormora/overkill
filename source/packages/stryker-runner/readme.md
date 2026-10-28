# `@overkill-dev/stryker-runner`

Optional first-party Stryker `TestRunner` plugin for Node microtest profiles,
compatible with Stryker `10.0.0`. Stryker owns mutation planning, sandboxing,
parallelism, scores, thresholds, and campaign reports. Overkill owns test
execution, capability policy, and structured result translation.

## Quick Start

Use Node `^26.9.0`, matching the packages' engine requirement. Install the
standard distribution, the optional adapter, and the supported Stryker version:

```sh
npm install -D @overkill-dev/test @overkill-dev/stryker-runner @stryker-mutator/core@10.0.0
```

The adapter and Stryker are separate installations; the standard distribution
does not include them. Installing the adapter does not change ordinary runs.

This walkthrough uses ESM. Set the example project's package type explicitly
to avoid Node module-type warnings during supervised execution:

```sh
npm pkg set type=module
```

Create `source/calculator.ts`:

```ts
export function add(left: number, right: number): number {
    return left + right;
}
```

Create `source/calculator.test.ts`:

```ts
import { test } from '@overkill-dev/test';
import { add } from './calculator.ts';

export const testNode = test('adds numbers', (scope) => {
    scope.assert.equal(add(2, 3), 5);

    return scope.assert.collect();
});
```

Create `overkill.config.ts`, or reuse your existing Node microtest profile:

```ts
import { defineConfig } from '@overkill-dev/test/config';

export const config = defineConfig({
    profiles: {
        microtest: {
            testFamily: 'microtest',
            files: { include: [ 'source/**/*.test.ts' ] },
            timeouts: { collectionMilliseconds: 30_000 }
        }
    }
});
```

This profile uses the ordinary defaults: supervised processes and concurrent
scheduling. Mutation invocations preserve the process model and run cases
serially. The explicit collection budget allows instrumented imports time to
load; the adapter preserves it along with the profile's case timeouts. You do
not need a separate mutation profile.

Create `stryker.config.mjs`:

```js
export default {
    testRunner: 'overkill',
    plugins: [ '@overkill-dev/stryker-runner' ],
    mutate: [
        'source/**/*.ts',
        '!source/**/*.test.ts'
    ],
    coverageAnalysis: 'perTest'
};
```

Run ordinary tests, then start the mutation campaign:

```sh
npx overkill run
npx stryker run
```

The adapter discovers `overkill.config.ts` and infers the sole microtest
profile. Stryker reports mutant outcomes and logs the campaign seed for
[reproduction](#seeds-and-reproduction). For an existing project, adjust
`mutate` to target production code and exclude all test-definition helpers.

## Reference

- [Adapter Configuration](#adapter-configuration)
- [Execution Overrides](#execution-overrides)
- [Coverage Modes](#coverage-modes)
- [Seeds And Reproduction](#seeds-and-reproduction)
- [Results And Selection](#results-and-selection)
- [Process Guarantees And Reused State](#process-guarantees-and-reused-state)
- [Reporting And Persistence](#reporting-and-persistence)
- [Advanced Lifecycle And Sandbox Behavior](#advanced-lifecycle-and-sandbox-behavior)

## Adapter Configuration

Adapter settings live under Stryker's `overkill` key. Unknown settings and
invalid values are rejected.

| Setting | Accepted Value | Default |
| ------- | -------------- | ------- |
| `configPath` | Nonblank string or `null` | `null`, normal config discovery |
| `profile` | One profile name or `null` | `null`, infer the sole eligible profile |
| `paths` | Array of nonblank file or directory paths | `[]`, use profile discovery |
| `freshState` | Boolean | `false` |
| `seed` | Nonnegative decimal integer string without leading zeros, except `'0'` | Generated and logged by Stryker initialization |
| `artifactPersistence` | `'off'`, `'failures'`, or `'all'` | `'off'` |

For example, to select an existing custom profile, add this property to the
Stryker configuration:

```js
overkill: {
    configPath: 'overkill.config.ts',
    profile: 'unit-fast',
    paths: [],
    freshState: false
}
```

### Profile Inference And Discovery

Omit `configPath` or set it to `null` for normal Overkill config discovery from
the Stryker worker's cwd. Omit `profile` or set it to `null` to infer the sole
microtest profile in the normalized registry. The built-in `microtest` fallback
counts: adding a custom microtest profile normally requires an explicit name.
An explicitly configured `microtest` profile replaces that fallback.

`paths` supplies explicit files or directory filters using ordinary runner
discovery rules. It defaults to `[]`. Initialization requires discovered files;
without a config discovery policy, provide explicit files through `paths`.

Unknown names, non-microtest profiles, absent eligible profiles, ambiguous
inference, and malformed settings fail before discovery or test imports.
Browser-oriented integration profiles and multi-profile selections are rejected.
Other profile families may coexist in the project registry. Profile names do not
determine eligibility. Incompatible test nodes are checked during collection.

## Execution Overrides

Initialization freezes a public runner policy with explicit serial scheduling,
ordinary V8 coverage disabled, and baseline updates disabled. Microtest profiles
have no Overkill retry policy. Discovery, loaders, capability restrictions,
process usage policies, timeouts, and the configured process model are preserved.
The original profile remains unchanged; the command records the override as
`request.execution: { mode: 'serial' }`.

The effective scheduling is exposed as `RunFacts.execution.scheduling`.
Stryker, rather than Overkill, parallelizes mutants.

## Coverage Modes

Set Stryker's top-level `coverageAnalysis`, separately from `overkill`:

| Mode | Returned Mutant Coverage | Case Selection |
| ---- | ------------------------ | -------------- |
| `'perTest'` | Per-case counters | Narrow when the requested cases include every recorded covering case |
| `'all'` | Aggregate counters | Full eligible suite |
| `'off'` | None | Full eligible suite |

`perTest` is the normal optimized mode. These are Stryker counters, separate
from ordinary V8 coverage, which remains disabled in every mode.

Reads outside an active case, including import-time reads, count as static
coverage. Static coverage or uncertain attribution widens valid filters to the
complete dry-run catalog, preserving its original file restrictions. The adapter never
infers `NoCoverage`. Missing or malformed counter transport, incomplete
test results, unknown IDs, duplicate IDs, and explicit-empty filters return
`Error`. A test that touches no instrumented code needs no counter bucket.
Stryker can still classify genuinely uncovered mutants from complete coverage.

Stryker's explicit `ignoreStatic` setting retains its runtime-only behavior for
hybrid mutants and its own handling of static mutants. Otherwise recorded
import-time hits require static activation before user imports. Existing reload
checks reject a loaded graph that cannot perform that activation safely.
Fallback keeps Stryker's deadline and bail policy. The dry-run coverage mode is
fixed with the campaign baseline and retained across worker replacements.

## Seeds And Reproduction

`overkill.seed` accepts a nonnegative decimal string, for example `'42'`.
Stryker applies a generated schema default before distributing configuration;
dry runs, mutants, workers, replacements, and fresh hosts use that same seed.
The adapter logs it through Stryker during initialization. Supply the logged
value explicitly to reproduce ordering. Multiple programmatic campaigns in one
Node process may share the generated schema default. Worker settings require the
coordinator-resolved seed and never substitute another seed when it is missing.

To reproduce a campaign, add the logged value to the Stryker configuration:

```js
overkill: { seed: '42' }
```

Case seeds derive from the campaign seed and stable executable identity,
independently of selection and scheduling. A number such as `42`, a negative
string, or a string such as `'01'` is invalid. The seed reproduces ordering
and derived case seeds; it does not reset external state or persistent caches.

## Results And Selection

| Observation | Result |
| ----------- | ------ |
| Normal dry run | Individual successes, failures, and intentional skips, with stable IDs and durations in milliseconds |
| Dry-run timeout or infrastructure failure | `Timeout` or `Error`; campaign stops without a mutation score |
| Safely attributed eligible-case assertion, body, test-contract, or policy failure | `Killed`, with killing IDs and failure diagnostics |
| All selected runnable cases pass | `Survived`, with the actual executed count |
| Case timeout, invocation deadline, or verified hit-limit guard | `Timeout` |
| Loading, collection, cleanup, infrastructure, transport, reporter, or persistence failure | `Error` |
| Inconclusive outcome, uncertain attribution, catalog drift, unexpected skip, or incomplete delivery | `Error` |

Result precedence is `Error > Timeout > Killed > Survived`. A cleanup timeout
or a later timeout with `disableBail` overrides an earlier kill. Independent
cleanup or infrastructure failures override both. Earlier confirmed failures
remain in diagnostics. A verified hit-limit guard during cleanup is timeout
evidence rather than an independent cleanup failure.

Dry-run cleanup failures preserve affected IDs and complete case failure lists
alongside runner diagnostics, and do not publish a baseline. Safely attributed
policy violations that kill a mutant include permission denials, forbidden
console output, async leaks, uncaught exceptions, and unhandled rejections.
Serial execution alone never proves ownership. Cleanup errors remain errors
even when retained beneath a policy verdict.

After a confirmed kill, the adapter stops admitting cases unless Stryker sets
`disableBail`. It finishes admitted work, cleanup, observer shutdown, and result
delivery before returning. Intentional early stopping does not create missing
result errors. Stryker owns score policy and its treatment of timeouts and errors.

### Stable Identity And Exact Selection

Test IDs encode the complete structured work identity, including parameter keys
and distinct resource-free runtime variants. Authored suite and case titles
remain identity components, with suite segments kept separate. Rendered names
and source line or column positions do not determine IDs.
File origins use project-relative paths with forward slashes. Absolute sandbox
paths, dot segments, and separator aliases normalize to the same origin;
origins outside the sandbox or naming its root fail. Existing canonical IDs
retain their encoding. Regenerate cached Stryker reports if they contain IDs
derived from noncanonical path spellings.

Every invocation validates the complete eligible catalog, selection metadata,
and intentional skips before narrowing. Reused execution validates its retained
plan without reimporting modules. Unknown or duplicate IDs, catalog drift,
unexpected skips, and empty mutant filters return `Error`. The adapter expands
Stryker's sandbox file filters. The baseline retains the original file restriction,
including eligible files that initially contain no cases. Later cases in those
files are catalog drift when execution collects again.

Repeated dry runs validate the original file restriction, coverage mode, and
catalog before case execution. They cannot replace the original campaign
baseline. Intentional skips remain in dry-run results; a mutant selection with
no runnable cases after coverage fallback executes nothing and returns `Error`.

## Process Guarantees And Reused State

The execution session runs serial cases in the selected profile's process
model. `freshState` defaults to `false`: in-process execution retains its collected
plan and transitive module state inside Stryker's reusable plugin worker. Suites
must support repeated execution. Persistent memoization, singleton state, and
caches populated during collection or a dry run can hide runtime mutations.

A surviving plugin worker remains reusable after a case timeout, leak, or
unattributed error. Each invocation closes its scopes, native observations, and
instrumentation bookkeeping before returning. Registered cleanups run once under
the originating attempt's policy, even when an observable interruption leaves
the body pending. Later body settlement cannot repeat cleanup or alter results.
Leaked work and module state can remain; late or ambiguously owned observations
are run errors rather than failures of the next case.

A hanging cleanup keeps the invocation pending for Stryker's deadline enforcement.
Stryker also handles dead workers and required environment reloads. The adapter
does not retire a surviving worker or enable fresh state automatically. Forced
process termination may prevent remaining cleanup.

Set `freshState: true` to start a new invocation process, collect the complete
eligible plan, and execute the requested selection for every invocation. This
resets transitive ESM and CommonJS modules, globals, and process-local mutable
state at the cost of startup and collection. It does not reset files, databases,
or external services. In-process permission enforcement remains best effort.
Supervised profiles already use one fresh restricted child per invocation;
`freshState` adds no extra host or stronger permissions there.

| Profile Process Model | `freshState` | Execution Boundary | `reloadEnvironment` |
| --------------------- | ------------ | ------------------ | ------------------- |
| `in-process` | `false` | Reused Stryker plugin worker | `false` |
| `in-process` | `true` | Fresh invocation host | `true` |
| `supervised-process` | Either | Fresh restricted test child, without an extra host | `true` |

Stryker replaces reused workers for requested reloads and static-mutant
transitions. Direct reload requests against an already loaded native ESM graph
return `Error`. Static activation precedes configuration revalidation and test
imports; runtime activation follows unmutated collection.

For an in-process profile with cache-dependent results, add this property to
Stryker's configuration:

```js
overkill: { freshState: true }
```

For example, a singleton memoized during the dry run can return its cached
answer without evaluating a mutated function. The mutant can survive in a
reused graph despite recorded dry-run coverage. Fresh execution recomputes it.
Stryker's `maxTestRunnerReuse: 1` is not a substitute: its counter counts mutant
runs, so the first mutant can still reuse dry-run state.

Native in-process exit observation cannot prevent termination or guarantee a
returned result; abort and arbitrary process signaling remain observation gaps.
A supervised child must deliver a valid completion result, even if it exits with
code zero. Unexpected termination is an execution error, not evidence of a kill.
Stryker owns plugin-worker crash and deadline recovery. Freshness changes module
lifetime, not these process-model permission guarantees.

## Reporting And Persistence

Stryker owns campaign output and reports. Mutation invocations suppress all
ordinary Overkill reporters, including configured custom reporters, and collect
structured adapter results in memory while retaining test-policy checks.

By default, Overkill writes no results, run records, duration history, artifacts,
or reports during mutation invocations. Stryker's sandbox and campaign reports
remain governed by Stryker's own configuration.

Diagnostic persistence is opt-in through `overkill.artifactPersistence`:

| Value | Available Evidence Retained |
| ----- | --------------------------- |
| `'off'` | None; the default |
| `'failures'` | Failed dry runs, killed mutants, timeouts, and execution errors |
| `'all'` | Failed invocations, successful dry runs, and surviving mutants |

Add this property to the Stryker configuration:

```js
overkill: { artifactPersistence: 'failures' }
```

Evidence is retained from the whole invocation. Invocations without diagnostic
evidence create no files.

Files live under the launch project's configured `runtimeStateDir` (default
`.overkill`), outside the disposable Stryker sandbox:

```text
<runtimeStateDir>/mutation/<campaign>/<invocation>/diagnostics.json
```

Each document includes the campaign and invocation identities, mutant identity
when applicable, campaign seed, profile, native failure outcomes, and delivered
artifacts or transcripts. Case and work identities remain structural and
project-relative. File-backed attachments are copied beside the document.
Workers and replacements share the campaign identity; each invocation has a
unique identity. These files survive Stryker sandbox cleanup.

Persistence preserves existing production limits and truncation metadata. It
does not enable capture, debug recording, capabilities, ordinary reports, run
records, or history maintenance. Unattached transcript objects are not recorded.
Forced termination can prevent delivery or writing; only evidence available to
a surviving owner can be retained. Serialization, delivery, copy, and write
failures return infrastructure errors, preserving earlier case diagnostics.

## Advanced Lifecycle And Sandbox Behavior

### Frozen Policy

Each plugin worker requests policy once from a fresh, unmutated process owned
by Stryker's main process. It imports user configuration and its dependencies,
discovers files, and returns immutable policy data. It imports no tests or
custom engines. It is terminated and reaped after success, failure, or disposal.
User configuration does not enter the plugin worker's execution graph during
initialization.
Repeated initialization shares one result, including failures. Replacement
workers resolve policy independently.

### Mutation Targets And Sandbox Paths

Stryker owns mutation selection. Exclude configuration, test definitions,
definition helpers such as macros and suite fragments, and adapter code through
`mutate`, while keeping those files available in the sandbox. Use mutation
exclusions rather than `ignorePatterns`, which removes files from the sandbox.
Prefer a production-only include, with exclusions where production and test
definitions share directories. For example, add `'!source/test-support/**'`
to `mutate` when that directory contains your definition helpers.

Initialization rejects targets overlapping the loaded config entry, discovered
test modules, or the executing adapter directory. Boolean targets and mutation
ranges are both checked. Imported definition helpers require project-owned
exclusions; initialization does not import tests or build an import graph to
classify them. Installed adapter code is normally outside Stryker's targets.

The plugin captures the launch cwd during loading, before Stryker changes the
worker cwd. Original absolute `configPath` and `paths` inputs are rebased to
sandbox copies; relative and already-sandboxed paths remain sandbox-local.
Missing copies fail without loading originals. File identities remain canonical
project-relative paths across sandbox names and replacement workers.

Mutation policy carries an additional native module boundary. Configuration
dependencies and test imports must resolve inside the sandbox or trusted
installed dependency and bootstrap roots. Absolute project imports and symlinks
escaping those roots fail before evaluation. Shared roots overlapping original
project files are rejected; load the adapter from a separate installed package.
The same boundary applies during config revalidation and both runner process
models without widening capability permissions or resetting module caches.

Execution hosts revalidate file-backed configuration before collecting tests.
Changes to authoritative discovery, loader declarations, selection, permissions,
execution, or resources fail even when test identities would remain unchanged.
Reporters, valid unrelated profiles, disabled coverage settings, and overridden
scheduling do not affect the comparison.

### Campaign Coordination

An automatic IPC receiver in Stryker's main process retains the original dry-run
catalog and coverage across workers and replacements. No additional dry run,
reporter, launcher, or disk manifest is required. Fresh invocation hosts and
supervised children belong to that main process. Worker disconnects cancel
their execution and reap the children. The receiver uses Stryker `10.0.0`'s
worker marker and generated schema defaults; its sockets do not keep Node alive.

### Instrumentation And Observation

Counters retain their object identity across reused invocations. Test attribution
includes awaited cleanup. Infrastructure errors take precedence over timeouts
and confirmed kills; swallowed hit-limit exceptions still return `Timeout`.
Each invocation clears prior counters before collection. Activation, test identity,
hit-limit state, and the activation environment variable are cleared on exit,
including partial setup failures. Reset failures still attempt independent cleanup
and return `Error` if state cannot be cleared; retained runtime objects are never
replaced to recover. Detached result counters remain available after cleanup.

Every invocation gets fresh scopes, observers, cleanup, and results. Failed
collection remains cached in reused mode; fresh mode can collect again on the
next invocation. Fresh hosts terminate before their invocation settles.

Console, permission, uncaught-error, rejection, and async-leak checks remain
active through test cleanup. Bootstrap, logging, transport, and lifecycle
checkpoints have infrastructure ownership. Native observations close before
results return to Stryker, including on errors and cancellation. Unknown or
late observations remain execution errors; they never establish a mutant kill.

### Deadlines And Disposal

The earlier applicable profile case timeout or Stryker invocation deadline wins.
One monotonic invocation budget covers lazy initialization, policy resolution,
collection, execution, cleanup, and campaign result delivery. IPC carries remaining
durations; Unix clock changes do not alter enforcement. Explicit `init()` has no
invented invocation timeout.

Invocation deadlines and supervised case watchdogs return `Timeout`. Internal
checkpoints retain confirmed case failures when forced termination prevents final
result delivery. Independent cleanup, instrumentation reset, or transport failures
still return `Error`. A verified Stryker hit-limit guard thrown during cleanup is
a timeout rather than an independent cleanup failure.

Timeout cancellation targets the current operation. Adapter-owned resolvers,
fresh hosts, and supervised children are terminated and reaped before settlement.
Stryker supervises reused plugin workers, including synchronous infinite loops;
the adapter does not add a process boundary to reused in-process execution.

Disposal closes admission immediately. It cancels and awaits supervised child
termination, terminates fresh invocation hosts, or awaits active reused
in-process work without terminating Stryker's worker.
