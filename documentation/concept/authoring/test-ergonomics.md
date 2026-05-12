# Test Ergonomics

## Purpose

This document captures the small set of first-party ergonomics mechanics
that are justified by repeated testing pain rather than by novelty.

The goal is not to make long tests fashionable. The goal is to remove the
repeated choreography that makes ordinary tests longer than they need to be.

## Naming In Examples

The documentation examples should prefer `case` as the injected test context
parameter:

```ts
test('loads user', async (case) => {
    case.require.defined(loadUser);
    case.assert.equal(await loadUser('42'), 'Ada');
    return case.assert.done();
});
```

Why `case`:

-   more meaningful than `t`
-   shorter than `testContext`
-   does not require inline destructuring by default
-   avoids awkward names like `test.test`

Users can still choose other parameter names locally.

## Design Rule

Ergonomics helpers should exist only when they remove choreography that
repeats across many real tests.

The strongest candidates are:

-   dependency-injected test harnesses
-   interaction transcripts
-   generated-case macros
-   small async-control helpers

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
    loadConfig: () => testDouble().resolves('the-config'),
    buildAndPublishAll: () => testDouble().resolves(Result.ok([])),
    log: () => testDouble(),
}, (parts) => {
    return {
        subject: createCommandLineInterfaceRunner({
            configLoader: { load: parts.loadConfig },
            publisher: { buildAndPublishAll: parts.buildAndPublishAll },
            log: parts.log,
        }),
        ...parts,
    };
});

test('passes dry-run by default', async (case) => {
    const harness = runnerHarness.create();

    await harness.subject.run(['publish']);

    case.assert.equal(harness.buildAndPublishAll.callCount, 1);
    case.assert.deepEqual(harness.buildAndPublishAll.firstCall.args[1], {
        dryRun: true,
    });
    return case.assert.done();
});
```

### Why A Harness Mechanic Is Justified

This pattern is common enough to justify first-party support:

-   default doubles
-   sparse override support
-   returned subject plus handles
-   interaction assertions on the handles

That is broad enough to be a first-party concept rather than a local style.

### Advanced Shape

`defineHarness(...)` should also support function-based harnesses for cases
that need richer setup, React render helpers, or async assembly.

Example direction:

```ts
const renderAccountPage = defineHarness(async (overrides) => {
    const loadAccount = overrides.loadAccount ?? testDouble().resolves(account);
    const rendered = await render(<AccountPage loadAccount={loadAccount} />);

    return {
        rendered,
        loadAccount,
    };
});
```

The important part is not the exact overload list. The important part is:

-   object form for common dependency harnesses
-   function form for advanced or async harnesses
-   no hidden container behavior

## Interaction Transcripts

Another repeated pattern is flattening calls or emitted events into ordered
tuples and asserting the resulting transcript.

Overkill should support generic transcript recording rather than
framework-specific emitter helpers only.

### Function Recording

```ts
const log = recordCalls(writeLine);

writeLine('hello');
writeLine('world');

case.assert.deepEqual(log.entries, [
    ['hello'],
    ['world'],
]);
```

### Generic Subscription Recording

```ts
const states = recordSink((record) => {
    return store.subscribe((state) => {
        record('state', state);
    });
});
```

### Node-Style Event Emitter

```ts
const events = recordEvents(emitter, {
    subscribe(record) {
        const onStart = () => record('start');
        const onDone = (payload) => record('done', payload);

        emitter.on('start', onStart);
        emitter.on('done', onDone);

        return () => {
            emitter.off('start', onStart);
            emitter.off('done', onDone);
        };
    },
});
```

### DOM EventTarget

```ts
const events = recordEvents(button, {
    subscribe(record) {
        const onClick = (event) => record(event.type);
        button.addEventListener('click', onClick);
        return () => button.removeEventListener('click', onClick);
    },
});
```

The concept should be:

-   one transcript model
-   multiple adapters
-   no assumption that every source is a Node `EventEmitter`

## Generated-Case Macros

Overkill already prefers macros. One useful extension is macros that expand
into multiple concrete test cases at once.

This is especially justified for:

-   schema field matrices
-   parser cases
-   reusable law or contract checks

Example direction:

```ts
const schemaValidationCases = defineGeneratedCases([
    missingField('name'),
    undefinedField('name'),
    wrongType('age', 'number'),
]);

const schemaContract = generatedCaseMacro(
    'schema contract',
    schemaValidationCases,
    (case) => {
        return case.parameters.schemaValidationCase.run(
            case.parameters.schema,
            case,
        );
    },
);

export default suite('schemas', [
    schemaContract('user schema', userSchema),
    schemaContract('pet schema', petSchema),
]);
```

The important shape is not the helper names. It is that a generated-case
macro can be defined once and then applied repeatedly to different subjects
without re-spelling the same case matrix in every test file.

That means the first-party concept should support both:

-   one-off expansion for a local matrix
-   reusable higher-order macros that expand into several concrete tests for
    each subject they are applied to

This should still be a macro-oriented model, not a competing
parameterization philosophy.

The callback model should stay consistent with table cases:

-   ordinary tests use one `case` parameter
-   generated/parameterized cases also use one `case` parameter
-   generated input is carried under `case.parameters`, not flattened into
    the top-level case namespace

### Stack Traces Matter

Generated cases should preserve meaningful failure locations and names.

That means:

-   generated tests must have strong explicit names
-   helper failures should point back to the user-authored macro callsite
    where practical
-   the first-party concept should care about stack quality, not only about
    case expansion

This matters especially for schema, parser, and law-style generated cases,
where failures must still point back to the meaningful authored callsite.

## Async-Control Helpers

This does not justify a huge concurrency toolkit. It does justify a small
set of queue-control helpers.

Recommended helpers:

-   `case.flushAsync()`
-   `case.microtasks()`
-   `case.immediate()`

Suggested semantics:

-   `case.microtasks()` drains the current microtask queue once. Use it when
    the code under test schedules follow-up work with `Promise.resolve()`,
    `queueMicrotask`, or an already-resolved async continuation.
-   `case.immediate()` yields one event-loop turn. Use it when the code under
    test crosses a macrotask boundary (`setImmediate`, message channel,
    stream callback, next-turn event dispatch) and a microtask flush is not
    enough.
-   `case.flushAsync()` is the bounded "settle what is already in flight"
    helper. It repeatedly yields through the relevant queue boundaries until
    the currently scheduled async work has drained, or until a small safety
    limit is hit so the helper cannot spin forever on a live loop.

These are useful because they do **not** require global time monkey
patching or a mandatory production-side clock abstraction.

They solve the repeated “yield just enough to observe the intermediate state”
dance found in controller, state-machine, and lock tests.

Typical use:

-   `microtasks()` for promise-chains and "one more await" state updates
-   `immediate()` for observer/event-loop handoff where work lands on the
    next turn rather than the current microtask queue
-   `flushAsync()` for queue-driven components where the test wants the
    currently-triggered cascade to settle before asserting

This should stay intentionally small. The first-party concept does not need
an exhaustive scheduler DSL; it needs a few helpers that replace ad-hoc
`await Promise.resolve()` and `await new Promise(setImmediate)` littered
through otherwise straightforward tests.

## `inFlight(...)`

The spawned-async pattern is real, but it should stay small and advanced.

Recommended direction:

```ts
test('logs fire-and-forget rejection', async (case) => {
    const run = case.inFlight(() => executor.execute(asyncFunction));

    await run.rejects({ message: 'error' });

    case.assert.equal(logger.error.callCount, 1);
    return case.assert.done();
});
```

The important promise:

-   start now
-   inspect or assert later
-   avoid manual promise temp-variable choreography

This helper should stay narrowly scoped and clearly documented as advanced.

## What Overkill Should Not Add Here

Overkill should **not** add:

-   a large first-party step/scenario DSL
-   a broad fake-time abstraction that assumes production-side clock handles
-   generic snapshot ergonomics for microtests
-   one-off helpers for every local testing idiom found in one codebase

The ergonomics surface should stay small and only cover patterns that repeat
across many tests.

## Settled Direction

The current concept should preserve room for:

-   `defineHarness(...)`
-   transcript recording with generic subscription adapters
-   generated-case macros
-   `flushAsync()` / `microtasks()` / `immediate()`
-   `inFlight(...)`

These are the ergonomics helpers that belong in the first-party concept.
