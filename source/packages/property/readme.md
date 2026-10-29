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
attach the complete output's codec afterward. Codec execution follows in the
codec milestone.

## Failure confirmation and shrinking

The first failure stops exploration. Shrinking confirms a fresh reconstruction
before searching, and confirms the retained counterexample after search completes.
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

## Current availability

Construction and collection are supported. They retain generator and callback
declarations without executing them. Property profiles resolve and validate policy during collection. Fluent generator
constructors and trial execution are supported. Examples run before bounded
automatic edges and new exploration. Only accepted exploration counts toward
`newTrials`; repeated accepted values count. Required examples run unless an
earlier failure stops the invocation. Work or generation exhaustion before
required checks complete produces an inconclusive outcome.

Disk-backed regression corpora, codec execution, witness replay,
and public phase diagnostics follow in their respective milestones. Direct engine execution requires resolved property policy;
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
