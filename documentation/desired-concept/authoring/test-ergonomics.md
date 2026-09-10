# Test Ergonomics

## Purpose

This document captures the small set of first-party ergonomics mechanics
that are justified by repeated testing pain rather than by novelty.

The goal is not to make long tests fashionable. The goal is to remove the
repeated choreography that makes ordinary tests longer than they need to be.

## Naming In Examples

The documentation examples should prefer `scope` as the injected test scope
parameter:

```ts
test('loads user', async (scope) => {
    scope.require.defined(loadUser);
    scope.assert.equal(await loadUser('42'), 'Ada');
    return scope.assert.collect();
});
```

Why `scope`:

- more meaningful than `t`
- short enough for repeated assertion calls
- does not require inline destructuring by default
- avoids awkward names like `test.test`

Users can still choose other parameter names locally.

## Design Rule

Ergonomics helpers should exist only when they remove choreography that
repeats across many real tests.

The strongest candidates are:

- dependency-injected test harnesses
- interaction transcripts
- reusable multi-case macros
- small async-control helpers

This does **not** justify a broad step/scenario DSL for ordinary
first-party tests.

## Harnesses

The strongest repeated pattern is dependency-harness boilerplate: default
doubles, sparse overrides, and a returned system under test plus assertion
handles.

Overkill should support a first-party `defineHarness(...)` concept.

### Basic Shape

```ts
const runnerHarness = defineHarness({
    loadConfig: () => testDouble.resolves<() => Promise<string>>('the-config'),
    buildAndPublishAll: () => testDouble.resolves<() => Promise<Result<readonly unknown[]>>>(Result.ok([])),
    log: () => testDouble()
}, (parts) => {
    return {
        subject: createCommandLineInterfaceRunner({
            configLoader: { load: parts.loadConfig },
            publisher: { buildAndPublishAll: parts.buildAndPublishAll },
            log: parts.log
        }),
        ...parts
    };
});

test('passes dry-run by default', async (scope) => {
    const harness = runnerHarness.create();

    await harness.subject.run([ 'publish' ]);

    scope.assert.equal(harness.buildAndPublishAll.interactionCount, 1);
    scope.assert.deepEqual(harness.buildAndPublishAll.firstInteraction.arguments[1], {
        dryRun: true
    });
    return scope.assert.collect();
});
```

### Why A Harness Mechanic Is Justified

This pattern is common enough to justify first-party support:

- default doubles
- exact sparse override support
- returned subject plus handles
- interaction assertions on the handles

That is broad enough to be a first-party concept rather than a local style.

Object-form overrides replace final part values, not factories. When a part
is overridden, its default factory is not called for that `create()` call.
Object-form part factories are ordinary value factories; promise values are
not awaited by the harness helper.

### Advanced Shape

`defineHarness(...)` should also support function-based harnesses for cases
that need richer setup, React render helpers, or async assembly.

Example direction:

```ts
const renderAccountPage = defineHarness(async (overrides: {
    readonly loadAccount?: () => Promise<Account>;
}) => {
    const loadAccount = overrides.loadAccount ?? testDouble.resolves<() => Promise<Account>>(account);
    const rendered = await render(<AccountPage loadAccount={loadAccount} />);

    return {
        rendered,
        loadAccount
    };
});
```

The important part is not the exact overload list. The important part is:

- object form for common dependency harnesses
- function form for advanced or async harnesses
- sparse overrides checked by TypeScript
- no hidden container behavior

## Interaction Transcripts

Another repeated pattern is flattening calls or emitted events into ordered
tuples and asserting the resulting transcript.

Overkill should support generic transcript recording rather than
framework-specific emitter helpers only.

### Manual Recording

```ts
const log = createTranscript<readonly [kind: 'line', value: string]>();

log.record('line', 'hello');
log.record('line', 'world');

scope.assert(transcriptUsage.exactly, log, [
    [ 'line', 'hello' ],
    [ 'line', 'world' ]
]);
```

### Test-Double Recording

```ts
const log = createTranscript<readonly [kind: 'line', value: string]>();
const writeLine = log.sink<(value: string) => void>('line');

writeLine('hello');
writeLine('world');

scope.assert(transcriptUsage.exactly, log, [
    [ 'line', 'hello' ],
    [ 'line', 'world' ]
]);
scope.assert(doubleUsage.calledOnceWith, writeLine, [ 'hello' ]);
```

The sink returned by `transcript.sink(...)` is still a test double. Its call
history and the transcript entries are separate observations and reset
independently.

### Generic Subscription Recording

```ts
const states = recordSink<readonly [kind: 'state', value: State]>((record) => {
    return store.subscribe((state) => {
        record('state', state);
    });
});
```

`recordAsyncSink(...)` is the same shape for subscriptions whose cleanup is
asynchronous. Sync and async cleanup are intentionally separate so a test does
not accidentally skip a pending teardown.

### Event Sources

```ts
const events = recordSink<readonly ['start'] | readonly ['done', Payload]>((record) => {
    const onStart = () => record('start');
    const onDone = (payload) => record('done', payload);

    emitter.on('start', onStart);
    emitter.on('done', onDone);

    return () => {
        emitter.off('start', onStart);
        emitter.off('done', onDone);
    };
});
```

The concept should be:

- one transcript model
- typed tuple entries
- manual recording, test-double recording, and generic subscription adapters
- no assumption that every source is a Node `EventEmitter`

## Reusable Multi-Case Macros

Overkill already prefers macros. Ordinary macros are already powerful enough
to expand into multiple concrete test cases at once, because a macro may
return a whole suite tree rather than only one test.

This is especially justified for:

- schema field matrices
- parser cases
- reusable law or contract checks

Example direction:

```ts
import { defineMacro, suite, test } from '@overkill-dev/test';

const schemaValidationCases = [
    missingField('name'),
    undefinedField('name'),
    wrongType('age', 'number')
];

const schemaContract = defineMacro((title, schema) =>
    suite(title, [
        ...schemaValidationCases.map((schemaValidationCase, index) =>
            test(schemaValidationCase.title ?? `case ${index + 1}`, (scope) => {
                return schemaValidationCase.run(schema, scope);
            })
        )
    ])
);

export const testNode = suite('schemas', [
    schemaContract('user schema', userSchema),
    schemaContract('pet schema', petSchema)
]);
```

The important ergonomic point is that a reusable macro can define a
canonical case family once and then apply it repeatedly to different
subjects without re-spelling the same matrix in every test file.

Canonical macro, table, generated-case naming, and callsite semantics live
in [Tests As Values](./tests-as-values.md). This doc only keeps the
ergonomic justification for using macros to remove repeated local
choreography.

- generated tests must have strong explicit names
- helper failures and definition-site data should point back to the
  user-authored macro application callsite where practical
- the first-party concept should care about stack quality, not only about
  case expansion

This matters especially for schema, parser, and law-style generated suites,
where failures must still point back to the meaningful authored callsite.

## Async-Control Helpers

This does not justify a huge concurrency toolkit. It does justify a small
set of queue-control helpers.

Recommended helpers:

| Helper                     | Use when                                                                                                    | Does not                                                            |
| -------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `scope.drainMicrotasks()`  | The code under test schedules already-resolved Promise continuations or `queueMicrotask` work.              | Advance timers, immediates, streams, or other event-loop turns.     |
| `scope.yieldToNextTurn()`  | The code under test hands work to the next Node turn, such as `setImmediate` or a next-turn event dispatch. | Drain an open-ended async cascade.                                  |
| `scope.settleAsyncWork()`  | A finite queue-driven cascade should reach its observable steady state before the assertion.                | Prove global quiescence or wait for declared background operations. |
| `scope.startInFlight(...)` | A background operation must start now and be asserted later.                                                | Hide unobserved or still-pending work at test end.                  |
| `scope.cleanup(...)`       | Test-owned resources need deterministic async teardown.                                                     | Register teardown after cleanup has started.                        |

Semantics:

- `scope.drainMicrotasks()` drains the current microtask queue once. Use it
  when the code under test schedules follow-up work with
  `Promise.resolve()`, `queueMicrotask`, or an already-resolved async
  continuation.
- `scope.yieldToNextTurn()` yields one event-loop turn. Use it when the
  code under test crosses a macrotask boundary and a microtask flush is not
  enough.
- `scope.settleAsyncWork()` is the bounded "settle the currently-triggered
  cascade" helper. It alternates microtask and next-turn checkpoints a small
  fixed number of times, then stops so a live loop cannot spin forever.
- `scope.startInFlight(...)` starts a Promise-returning operation now and
  returns a handle with `wait()` and `rejects(...)`. The task must settle and
  must be observed before the test ends.
- `scope.cleanup(...)` registers teardown callbacks. Registration is
  synchronous; the callback itself may be async. Cleanups run after the test
  body, after `scope.signal` is aborted, and in reverse registration order.

These are useful because they do **not** require global time monkey
patching or a mandatory production-side clock abstraction.

They solve the repeated “yield just enough to observe the intermediate state”
dance found in controller, state-machine, and lock tests.

Typical use:

- `drainMicrotasks()` for promise chains and "one more await" state updates
- `yieldToNextTurn()` for observer/event-loop handoff where work lands on
  the next turn rather than the current microtask queue
- `settleAsyncWork()` for queue-driven components where the test wants the
  currently-triggered cascade to settle before asserting

Examples:

```ts
test('publishes a deferred state change', async (scope) => {
    const store = createStore();

    store.setName('Ada');
    await scope.drainMicrotasks();

    scope.assert.equal(store.snapshot().name, 'Ada');
    return scope.assert.collect();
});
```

```ts
test('notifies subscribers on the next turn', async (scope) => {
    const events: string[] = [];
    const bus = createBus();

    bus.subscribe((event) => events.push(event));
    bus.publish('saved');

    await scope.yieldToNextTurn();

    scope.assert.deepEqual(events, [ 'saved' ]);
    return scope.assert.collect();
});
```

```ts
test('settles a finite retry cascade', async (scope) => {
    const worker = createRetryingWorker({ failuresBeforeSuccess: 2 });

    worker.start();
    await scope.settleAsyncWork();

    scope.assert.equal(worker.status(), 'ready');
    return scope.assert.collect();
});
```

This should stay intentionally small. The first-party concept does not need
an exhaustive scheduler DSL; it needs a few helpers that replace ad-hoc
`await Promise.resolve()` and `await new Promise(setImmediate)` littered
through otherwise straightforward tests.

## `startInFlight(...)`

The spawned-async pattern is real, but it should stay small and advanced.

Recommended direction:

```ts
test('logs fire-and-forget rejection', async (scope) => {
    const run = scope.startInFlight(() => executor.execute(asyncFunction));

    await run.rejects({ message: 'error' });

    scope.assert.equal(logger.error.interactionCount, 1);
    return scope.assert.collect();
});
```

The important promise:

- start now
- inspect or assert later
- avoid manual promise temp-variable choreography

This helper should stay narrowly scoped and clearly documented as advanced.
It should not merge with `settleAsyncWork()`: a test that starts background
work has a different authoring obligation than a test that only needs to
cross queue boundaries.

## What Overkill Should Not Add Here

Overkill should **not** add:

- a large first-party step/scenario DSL
- a broad fake-time abstraction that assumes production-side clock handles
- generic snapshot ergonomics for microtests
- one-off helpers for every local testing idiom found in one codebase

The ergonomics surface should stay small and only cover patterns that repeat
across many tests.

## Settled Direction

The current concept should preserve room for:

- `defineHarness(...)`
- transcript recording with generic subscription adapters
- reusable multi-case macros
- `settleAsyncWork()` / `drainMicrotasks()` / `yieldToNextTurn()`
- `startInFlight(...)`
- `cleanup(...)`

These are the ergonomics helpers that belong in the first-party concept.
