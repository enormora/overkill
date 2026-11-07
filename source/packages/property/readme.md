# `@overkill-dev/property`

Property test authoring. Included in `@overkill-dev/test` through its
`@overkill-dev/test/property` subpath.

## Authoring

`property({ title, generator, test })` creates one property-family `TestCase`,
usable directly or inside `suite(...)`. Its callback receives the generated
value and a property-local assertion scope, and returns an `AssertionResult`.

`withProperties(body)` wraps an ordinary test body with typed
`scope.forall(generator, body)` authoring. Nested invocations stay inside the
enclosing case; they never register runtime subtests. Unconfigured rewrapping preserves the
original declaration; configured rewrapping is rejected during collection. Base test scopes have no `forall` method.

Generator values are owned by Overkill. Custom generators compose its fluent
`map`, `flatMap`, `filter`, and `withCodec` surfaces. Sampling callbacks and
unbranded objects are not generators.
Their private runtime symbol and shared declaration identity remain compatible
across leaf and standard package copies.

## Trial execution

Supply required examples as pure synchronous factories that return fresh inputs:

```ts
property({
    title: 'user names remain nonempty',
    generator: user,
    examples: [ () => ({ name: 'Ada', age: 37 }) ],
    test(value, sample) {
        sample.assert.true(value.name.length > 0);
        return sample.assert.collect();
    }
});
```

Factories can reconstruct class instances and graphs with shared references.
Nested examples use `scope.forall({ generator, examples, test })`.
Await each invocation before starting another. Overlap and unfinished calls fail
the scope contract after admitted work finishes cleanup.

Each trial receives fresh assertions, assertion plans, cleanup registrations,
and cancellation state. Cleanup completes before the next trial starts. Each
invocation counts as one assertion in the enclosing case. Different property
cases retain ordinary runner parallelism.

## Generators

Import `gen` from either property entry point:

```ts
import { gen } from '@overkill-dev/test/property';

const user = gen.record({
    name: gen.string({ minLength: 1, maxLength: 64 }),
    age: gen.integer({ min: 0, max: 120 })
});

const indexed = gen
    .array(user, { minLength: 1, maxLength: 10 })
    .flatMap((users) =>
        gen.record({
            users: gen.constant(null).map(() => users),
            index: gen.integer({ min: 0, max: users.length - 1 })
        })
    );
```

| Constructor                                | Domain                                                                  |
| ------------------------------------------ | ----------------------------------------------------------------------- |
| `boolean()`                                | Both boolean values                                                     |
| `integer({ min, max })`                    | Inclusive safe-integer bounds                                           |
| `number()`                                 | IEEE doubles, including NaN, infinities, and signed zero                |
| `number({ min, max })`                     | Inclusive finite bounds                                                 |
| `bigint({ min, max })`                     | Inclusive bigint bounds                                                 |
| `string()`, `string(bounds)`               | UTF-16 code units, including lone surrogates                            |
| `bytes()`, `bytes(bounds)`                 | Owned Uint8Array storage                                                |
| `constant(value)`                          | A scalar singleton: null, undefined, boolean, number, bigint, or string |
| `array(element)`, `array(element, bounds)` | Arrays of the element domain                                            |
| `tuple(...elements)`                       | Heterogeneous tuples                                                    |
| `record(fields)`                           | All declared fields, including an empty record                          |
| `choice(...alternatives)`                  | At least one alternative                                                |
| `recursive({ leaf, branch, maxDepth })`    | Bounded leaf-plus-expansion composition                                 |

Length bounds require both `minLength` and `maxLength`. Without bounds,
containers use `0..maxSize`. Effective maxima are capped by collected
`maxSize`; declared minima are preserved. A cap below the minimum exhausts
the domain. Numeric bounds are explicit for integers and bigints.
Malformed bounds fail at construction.

Record declarations use plain objects or objects with a null prototype.
Fields must be own enumerable string data properties; accessors are rejected.

`map` reapplies its pure transformation to source shrink candidates.
`flatMap` regenerates dependent domains under each changed source.
`filter` rejects invalid candidates during generation and shrinking, with
bounded rejection. Callback errors remain errors. Custom generators return
these compositions without supplying a separate shrinker.

`maxSize` caps each declared string, byte array, and array independently.
It does not inspect arbitrary transformed output graphs; pure mappings may
expand their source. Work limits bound generator traversal.

```ts
type Tree = { readonly left: Tree; readonly right: Tree; } | null;

const tree = gen.recursive<Tree>({
    leaf: gen.constant(null),
    branch: (child) => gen.record({ left: child, right: child }),
    maxDepth: 4
});
```

A leaf has recursive depth zero. Every branch expansion consumes one level.
The effective depth also obeys the collected `maxDepth`, including while
shrinking. Constructors snapshot options and components; callbacks remain
deferred until execution.

`withCodec(codec)` attaches codec metadata to the complete generated input
without running its callbacks. Filtering preserves the attachment. Mapping,
dependent composition, and structural constructors clear inherited attachments;
attach the complete output's codec afterward. Inputs are encoded and decoded before each trial body. The body receives the
original generated input. Codec failures stop execution before a property failure;
after failure they preserve the failure and mark its capture as unavailable.

Use `defineCodec({ name, version, previousDecoders, encode, decode })` for custom
inputs. Callbacks must be synchronous and pure. Encode the complete input into
supported graph data; decode must validate that data and restore its behavior and
promised aliases. Attaching a codec never invokes callbacks.

Built-in graph JSON preserves cycles, aliases, sparse arrays, numeric special
values, bigint, plain and null-prototype records, dates, regex state, maps, sets,
and fixed binary buffers and views. Functions, symbols, proxies, accessors,
nonstandard descriptors, extra built-in properties, Buffer, and shared,
resizable, or detached buffers require an explicit custom codec. Each capture
records separate transport and input-codec versions. Reads select the exact stored
transport and codec version. Custom codecs support their current version and
versions declared in `previousDecoders`. Unsupported identities and decoder
failures are errors, without fallback. Captures always write the current format
and codec version. Reading never re-encodes an input.

Explicit migration decodes the stored input, re-encodes with the current writer,
and validates the result without modifying the source. Use `overkill corpus migrate`
or the runner's `migrateCorpus(...)` API to write a separate destination.

## Failure confirmation and shrinking

The first failure stops exploration. A fresh reconstruction confirms the original
failure before shrinking, including inputs without compatible shrink state.
Candidate search finishes with a fresh confirmation of the retained counterexample.
A passing or unrelated confirmation leaves the property failed, reports
non-reproducibility, and retains both observations. Such evidence is not a
reliably reproducing witness.

Total and shrink work limits include confirmation, candidate traversal, rejection,
reconstruction, repeated outputs, and body evaluation. Exhaustion retains the last
matching failure. Cleanup failures and supervision keep their native outcomes.
Supervised termination retains evidence already received through property progress
events; hard termination cannot guarantee child cleanup or undelivered evidence.

Evidence distinguishes exhausted search, exhausted work, and interruption. A
shrunk counterexample is not guaranteed to be globally minimal.

## Results and diagnostics

Each invocation exposes a structured summary through case results, attempt results,
`test-end`, and awaited `property-progress` snapshots. Summaries include phase
execution and rejection counts, total work, run and property seeds, trial positions,
input coverage, and exhaustive traversal state. Confirmation, shrinking, and direct
witness replay have separate counts. A discovered finite domain is not an exhausted
traversal. Historical records without summaries expose `null`, not zero counts.

Line, dot, and brief reporters print compact summaries for successful properties
as well as failures. Coverage observations outside accepted exploration or exhaustive
execution do not satisfy requirements. Non-reproducible failures remain failed and
cannot supply a confirmed regression witness. Progress surrounds each trial;
hard termination retains only snapshots already delivered.

## Current availability

Construction and collection are supported. They retain generator and callback
declarations without executing them. Property profiles resolve and validate policy during collection. Fluent generator
constructors and trial execution are supported. Examples run before bounded
automatic edges and new exploration. Only accepted exploration counts toward
`newTrials`; repeated accepted values count. Required examples run unless an
earlier failure stops the invocation. Work or generation exhaustion before
required checks complete produces an inconclusive outcome.

Disk-backed regression corpora are supported. Standalone witness replay and public phase diagnostics are supported. Direct engine execution requires resolved property policy;
`ExecuteOptions.propertyRun` supplies its run seed and project root; omitted
context defaults to seed zero and an unknown project root. Configured runner execution supplies the resolved run seed automatically.

The standard subpath exposes the same authoring functions and types as this
package. Property modules stay outside the root test import and ordinary
microtest startup.

## Profile policy

Configure a project-owned profile and select it with `overkill run --profile laws`:

```ts
import { defineConfig } from '@overkill-dev/test/config';

export const config = defineConfig({
    profiles: {
        laws: {
            testFamily: 'property',
            files: { include: [ 'test/**/*.property.ts' ] },
            property: { newTrials: 200, maxWork: 20_000 }
        }
    }
});
```

Properties use microtest-like capability restrictions. Resource descriptors,
authored capture controls, retries, and code coverage are rejected. The default
execution is supervised and concurrent, with a 1 s soft timeout and 2 s hard
timeout. In-process execution supports best-effort diagnostics without hard
termination. Process usage policy uses the ordinary `processUsage` surface.

`property({ title, generator, test, settings })` and
`withProperties(body, settings)` override exploration defaults. All nested
`forall` calls inherit the wrapper's collected policy. Settings cannot change
capabilities, timeout policy, or process budgets. Limits must be finite safe
integers; unknown settings and configured rewrapping fail during collection,
even when selection would exclude the declaration.

| Setting               | Default |
| --------------------- | ------: |
| `newTrials`           |     100 |
| `maxSize`             |     100 |
| `maxDepth`            |      10 |
| `maxAutomaticEdges`   |     100 |
| `maxExhaustiveValues` |   1,000 |
| `maxWork`             |  10,000 |
| `maxShrinkWork`       |   1,000 |
| `maxLabels`           |     100 |
| `maxRetainedInputs`   |     100 |

`newTrials`, `maxWork`, `maxLabels`, and `maxRetainedInputs` must be positive.
Other limits permit zero. Exploration settings may exceed profile defaults;
timeouts and process budgets remain profile-owned. The total work budget
covers every phase, including generation, reconstruction, rejections,
duplicate processing, confirmations, and body evaluations. Shrink work also
consumes total work. Each invocation has its own total-work ledger; nested
invocations share the enclosing case's timeout and supervision. Confirmation and shrinking have separate accounting and do not count as new trials.

### Exhaustive domains and input coverage

Small enumerable domains run exhaustively when discovery completes within
`maxExhaustiveValues`. That limit bounds both candidate discovery and retained
domain entries; `maxRetainedInputs` bounds retained search inputs. Partial
discovery falls back to sampling without changing the sampling random stream.
Discovery consumes total work. Empty domains remain inconclusive.

Declare invocation-local `coverage: [{ label: 'positive', minimumPercent: 20 }]`
on `property(...)` or object-form `scope.forall(...)`. Observe inputs with
`sample.cover('positive', value > 0)`. Each label counts at most once per trial;
repeated observations combine with OR and missing observations count as false.
Percentages are finite values from 0 through 100. Labels are unique and nonblank.

Coverage counts accepted exploration trials or distinct exhaustive values using
Node deep strict equality. Examples, corpus inputs, and automatic edges have
separate observations and cannot satisfy requirements. Unmet requirements stay
inconclusive even after exhaustive completion. Trial observers expire after
cleanup. Coverage labels are bounded by `maxLabels` per invocation.

### Targeted exploration

Call `sample.target('distance', -distance)` to guide subsequent exploration
toward smaller distances. Scores must be finite numbers; larger scores win.
Repeated calls for one label use the trial maximum. Missing observations
supply no score. Labels must be nonblank strings. Targeting and coverage share
`maxLabels`, including declared coverage labels. Observers expire after cleanup.

Only passing new exploration trials supply guidance. Corpus inputs, examples,
and automatic edges do not seed the search. Exhaustive traversal is unchanged.
Search alternates fresh generation with mutations of retained generation choices,
regenerating through the original generator to preserve its domain.
`maxRetainedInputs` bounds per-label champions and `maxWork` bounds search work.
Failing to improve a score never invalidates completed passing trials; required
coverage remains a separate condition.

### First-failure shrinking

Generation stops at the first failure. Shrinking preserves the first failed
assertion in recording order, or the body error when no assertion failed.
Identity uses assertion kind and source location, or error type and throw
location. Messages and input values do not affect matching.

Call `sample.failureKey('round-trip')` to supply a semantic identity for a
trial. Keys must be nonblank; repeated identical keys are allowed. Conflicting
keys fail the trial contract. Assertion failures and body errors stay distinct.

The original input is reconstructed and checked before shrinking. Disagreement
keeps the original failure and reports non-reproducibility. Unrelated failures
remain diagnostics. Recipe inputs shrink only when the generator supports
context-free shrinking. Missing identity or shrink state retains the failure.

Case results, attempt results, and completion events expose nullable
`property` evidence with original and retained input previews and diagnostics.
Previews use bounded diagnostic serialization and cannot serve as replay inputs.
Cleanup and execution failures keep their native outcomes. Budget exhaustion
retains established failures. Results describe shrunk counterexamples without
claiming global minimality.

## Regression corpora

Property profiles accept `corpus.checkedIn`, an array of project-relative JSON
files or directories. Checked-in entries replay before the local cache, examples,
automatic edges, and new exploration. Entries use the versioned property witness
envelope. Test execution never changes checked-in entries.

Use `overkill corpus inspect <path>` to inspect witnesses or cache indexes,
`overkill corpus promote <path> --to <destination>` to promote a witness,
and `overkill corpus migrate <path> --to <destination>` for explicit migration.
Select a cache entry with `--entry <id>`. Promotion and migration show a decoded
preview before creating a new destination and reject existing files.
Custom codecs use `--codec <module>` and optional `--codec-export <name>`.
The runner exposes the same operations through `inspectCorpus(...)`,
`promoteWitness(...)`, and `migrateCorpus(...)`.

Confirmed replayable failures are saved automatically beneath
`runtimeStateDir/corpus`, separately for each profile. `corpus.localCache`
defaults to `maxEntries: 1000`, `maxBytes: 67108864`, and
`maxEntryBytes: 1048576`. Old entries are evicted to satisfy both count and byte
limits. Oversized inputs are diagnosed instead of cached. Cache write failures
are runner errors; malformed or incompatible local entries are diagnosed and
skipped. Incompatible checked-in entries fail the run.

Decoded regressions run even after generator bounds change. Total-work limits
and normal supervision still apply. Input-only entries are confirmed without
shrinking; changing a generator never silently retires a checked-in entry.
Confirmation uses existing shrink-work limits, so `maxShrinkWork: 0` prevents
automatic caching of new failures.

Confirmed failures also produce native witness artifacts under
`runtimeStateDir/witnesses/<run-id>/`. The runner persists their run record,
and human reporters print a replay command. Passing properties and unconfirmed
failures do not create witness artifacts. Witnesses use the standard attachment
limits, with explicit omissions for oversized inputs; local cache limits remain
independent. Witness write failures fail the run while preserving failure evidence.

Nested object-form `scope.forall({ key, generator, test })` accepts a nonblank
key, unique within its enclosing case, to retain target identity when source
locations change. Without a key, identity uses location and occurrence.
Missing checked-in targets fail the enclosing case. Local target mismatches
produce diagnostics.

Witness files use the engine-owned version-1 envelope.
`parseWitnessFile(value)` from `@overkill-dev/engine` validates parsed JSON and
returns a property or simulation witness, throwing `ZodError` for invalid
envelopes or unsupported envelope versions. It does not decode inputs or execute
replay. Producer-specific payload compatibility is validated separately.

## Witness replay

Run `overkill replay-witness <path> --profile <name>` to execute a saved property
input. The profile may be omitted when exactly one property profile exists.
Replay executes the target once, without corpus trials, examples, generation,
confirmation, or shrinking. It accepts retained inputs outside current generator
bounds, subject to total-work limits and normal execution supervision.

Nested witnesses execute the enclosing case normally, including setup, other
property calls, and cleanup. Only the identified invocation receives the saved
input. Stable keys take precedence over source location and occurrence. Missing,
duplicate, or unreached targets produce replay errors. Replay restores only the
target input; surrounding randomness and corpus contents follow current policy.

The current declaration supplies the input codec. Unsupported formats and codecs
fail explicitly. Replay reports the current outcome, so a previously failing
input may pass after a fix. A single replay does not confirm a new cached witness.

## Generator previews

`sampleGenerator(generator, { seed, count, size, depth })` returns a readonly
array of fresh samples. Supply a bigint seed and nonnegative safe-integer limits.
The same request reproduces the stream independently of runner randomness.
Zero count invokes no generator callbacks; repeated values remain valid samples.

Preview uses the generator's size, depth, rejection, and reconstruction contracts
with a fixed 10,000-unit work budget. It returns exactly the requested count or
throws RangeError on domain or work exhaustion. Callback errors propagate.
The returned array is shallow-frozen; generated values remain mutable.
Preview does not execute property bodies, codecs, corpus replay, or shrinking.
Traversal bounds cannot interrupt arbitrary callback code or cap mapped allocations.

## Metamorphic relations

`relation({ transform, run, check })` returns a property body for either
`property({ title, generator, test })` or `scope.forall(generator, body)`:

```ts
property({
    title: 'sorting ignores input order',
    generator: gen.array(gen.integer({ min: -100, max: 100 })),
    test: relation({
        transform: (values) => values.toReversed(),
        run: (values) => values.toSorted(),
        check({ original, transformed }, sample) {
            sample.assert.deepEqual(original.output, transformed.output);
            return sample.assert.collect();
        }
    })
});
```

All callbacks support promises. Each trial awaits transformation, the original
operation, the transformed operation, then the check, sequentially. The operation
and check receive the same property sample scope. Cleanup finishes after the trial.
Cancellation is checked before each callback; callback errors retain native body-error handling.

Observations contain each actual input and output after execution. There is no
cloning: authors provide independent branches when mutation needs isolation.
Shrinking, confirmation, corpus replay, and witness replay reconstruct the original
input and rerun the relation. The enclosing property owns settings, examples,
coverage, codecs, and its single assertion boundary.

## Integration validation

Run `npx just test-property-integration` with the Node version selected by
`package.json`. This covers generator contracts, historical codecs, corpus
policies, nested witness replay, and supervised execution.

Workload measurements use isolated `--expose-gc` processes with seed 42,
size limits 8 and 64, and depth limits 2 and 5. Candidate production,
reconstruction, rejection, and evaluation counts are separate from total work.
JSON reports are written to `target/property-measurements/`.
Forced-GC checkpoints every 128 work units and at completion report the maximum
observed live heap above baseline. This is a checkpoint estimate of retained
memory, not an exact allocation peak or a machine-independent performance gate.

## Reconstructing trial inputs

`sample.reconstructInput()` returns the original trial input as a fresh graph,
including after the body mutates its input. It uses retained generation recipes
or stored-input decoding, preserving aliases and cycles within each graph.
Reconstruction charges the active work budget, honors cancellation, and is
unavailable after the trial closes. `PropertySampleScope<Value>` types its result;
existing unparameterized scope annotations retain an `unknown` result.
