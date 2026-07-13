# Capability Handles

## Position

Mocking is the testing technique Overkill most wants to avoid normalizing. It
hides where effects come from, makes refactoring brittle, requires
module-graph patches that conflict with capability-restricted microtests, and
produces tests that look pure but secretly mutate global registries between
runs.

This doc proposes one promising replacement pattern: **capability handles**
— typed bags of effect-performing services passed explicitly into code, with
recording variants used in tests.

Important boundary: this is a user-architecture pattern Overkill should
support well, not a required Overkill programming model.

Another important boundary: consumer production code should not need to
import Overkill packages. So even though this document describes the
pattern, it does **not** imply a first-class `@overkill/world` package in
the current concept.

It is heavily influenced by Haskell's `IO` separation, ZIO's `R` environment,
PureScript's `Effect`/`Aff`, Elm's `Cmd`/`Sub` model, and ports of those ideas
to Scala (cats-effect, ZIO), F# (Eff), and TypeScript (`effect`, `fp-ts`,
`@effect/io`).

## The Core Idea

Effects are not implicit globals. They are typed values passed in. The
illustrative `User`, `UserInput`, `Saved` types are placeholders for an
application's own domain types; the handle types (`Clock`, `Random`,
`FileSystem`, `HttpClient`, `Logger`) are sketched in [Types Index](../reference/types-index.md).

```ts
type AppRuntime = {
    readonly clock: Clock;
    readonly random: Random;
    readonly fs: FileSystem;
    readonly http: HttpClient;
    readonly log: Logger;
};

async function saveUser(runtime: AppRuntime, input: UserInput): Promise<Saved> {
    const id = await runtime.random.uuid();
    const at = runtime.clock.now();
    await runtime.fs.write(`users/${id}.json`, JSON.stringify({ ...input, id, at }));
    runtime.log.info(`saved ${id}`);
    return { id, at };
}
```

The function is testable without mocking, monkey patching, or module-graph
intervention. To test, pass a different runtime object.

## Recording Handles As The Canonical Test Variant

Instead of mocks, tests can use _recording_ implementations of the relevant
handles:

```ts
import { suite, test } from '@overkill/test';

export const spec = suite('saveUser', [
    test('records the effect transcript', async (case) => {
        const runtime = recordingRuntime({
            clock: virtualClock('2026-01-01T00:00:00Z'),
            random: seededRandom(0xc0ffee),
            fs: memoryFs({ 'users/_template.json': '{}' }),
            http: stubHttp({ 'GET /users/1': { status: 200, body: { id: 1 } } }),
        });

        await saveUser(runtime, { name: 'Ada' });

        case.assert.deepEqual(runtime.recorded(), [
            { kind: 'random.uuid' },
            { kind: 'clock.now' },
            { kind: 'fs.write', path: 'users/<uuid>.json', body: '...' },
            { kind: 'log.info', msg: 'saved <uuid>' },
        ]);
        return case.assert.done();
    }),
]);
```

Key properties:

- handles are typed values, not modules patched at runtime
- the recording is structured data, asserted with normal equality
- determinism is built in: `virtualClock` and `seededRandom` reproduce
  bit-for-bit
- the test reads as a transcript: input + runtime → output + effect log
- no `jest.mock`, no `vi.spyOn`, no patching, no restore registry

## Why This Is Better Than Mocking

### Refactoring stays local

A mock of `import { fetch } from './lib'` breaks when `lib` is renamed or the
import is moved. A handle passed as a parameter breaks only if the function
signature actually changes.

### Determinism is the path of least resistance

A module mock has to be carefully reset between tests. A handle is a fresh
object per test by construction. There is no shared mutable mock registry.

### Capability boundaries become visible

A function that takes an explicit runtime object declares its effect surface in
its signature. A
function that mutates implicit globals does not. Code review reads better,
and refactors that drop a no-longer-needed effect remove a parameter rather
than orphaning a module mock.

### Composes with capability-restricted microtests

Microtests run with no filesystem or network access. A runtime object whose handles
are in-memory simulators satisfies that constraint. Module-mocking patterns
_require_ the runner to allow `node:fs` access (to load the original) and
some form of patch hook into the loader. Handles work even under
`--permission`.

### One pattern, many effect kinds

Mocks come in flavors: `jest.fn`, `jest.mock`, `jest.spyOn`,
`vi.mocked(...)`, manual mocks in `__mocks__/`. Handles have one shape:
"object with methods, swap implementation."

## What A Handle Looks Like

A handle is a small interface with explicit method signatures:

```ts
type Clock = {
    now(): Date;
    monotonic(): bigint;
    sleep(ms: number, signal?: AbortSignal): Promise<void>;
};

type Random = {
    uuid(): string;
    integer(min: number, max: number): number;
    bytes(length: number): Uint8Array;
    pick<T>(xs: ReadonlyArray<T>): T;
};

type Logger = {
    debug(msg: string, fields?: Fields): void;
    info(msg: string, fields?: Fields): void;
    warn(msg: string, fields?: Fields): void;
    error(msg: string, fields?: Fields): void;
};
```

These are interfaces, not classes. Production builds them from
`performance.now()`, `crypto.randomUUID()`, `pino`, etc. Tests build them
from virtual clocks, seeded PRNGs, and recording loggers.

This does **not** mean Overkill must ship a first-party world package or
predefined application runtime.
The current concept direction is:

- document the pattern clearly
- make custom handles easy to author
- keep Overkill itself on the testing side of the production/test boundary

This is _not_ a service-locator. There is no global lookup. The handles are
parameters. A test in microtest profile can construct a runtime with only
`Clock` and `Random` and refuse to provide the others.

## Recording Variants

A recording handle does two things:

1. Implements the interface (in-memory, deterministic).
2. Records every invocation as a typed event in an in-memory log.

```ts
type RecordedEvent =
    | { kind: 'clock.now'; at: bigint; }
    | { kind: 'random.uuid'; produced: string; }
    | { kind: 'fs.write'; path: string; bytes: number; contentHash: string; }
    | { kind: 'log.info'; msg: string; fields?: Fields; }
    | { kind: 'http.request'; method: string; url: string; bodyHash?: string; };

type RecordingRuntime = AppRuntime & {
    recorded(): ReadonlyArray<RecordedEvent>;
    snapshot(): RuntimeSnapshot;
    restore(snapshot: RuntimeSnapshot): void;
};
```

Tests assert on `recorded()` directly. Reporters can attach the recording to
a failed test as a structured artifact. Replays use `snapshot`/`restore` to
reproduce a runtime state. Test debug mode (see [Test Debug Mode](./debug-mode.md)) aggregates `RecordedEvent` arrays into the
per-test debug artifact so the same data is available for any test —
not only failing ones — when the mode is on.

## Splittable Random For Determinism Under Parallelism

If two tests share a single `Random` handle and execute in parallel, their
draws interleave non-deterministically. The fix borrowed from Haskell
`splitmix` is **splittable** PRNGs: every `Random` has a `split()` method
that derives two statistically independent generators from the parent.

```ts
type Random = {
    uuid(): string;
    integer(min: number, max: number): number;
    bytes(length: number): Uint8Array;
    pick<T>(xs: ReadonlyArray<T>): T;
    split(): readonly [Random, Random];
};
```

Each test receives a child generator split from the run seed. Failures report
the root seed; replays reproduce bit-for-bit even under parallel execution.
SplitMix is small, well understood, and has a TypeScript implementation in
under 200 lines.

This becomes the foundation for the property-testing package family later.

## Cross-References

### `@overkill/doubles`

This is the canonical home for the handles ↔ doubles boundary; [Doubles](./doubles.md)
links here rather than restating it.

The two concepts serve different shapes:

- capability handles model **collaborators with multiple methods** — full
  effect interfaces such as `Clock` with `now`/`sleep`/`monotonic`,
  `HttpClient` with `request`/`fetch`, `Logger` with `info`/`warn`. A
  recording handle covers the whole interface; a test asserts on the
  structured event log.
- `testDouble()` models **single-function doubles** passed explicitly —
  application-specific service interfaces, callback parameters,
  higher-order function arguments. Not part of the standard handle set,
  and not worth a whole interface.

They compose. A handle's method can be a `testDouble()` for fine-grained
per-call control: a test might use an injected runtime object for standard
effects and `testDouble()` for one application-specific function-shaped
collaborator. Both refuse module-graph patching; both prefer explicit
injection.

The boundary, in one line: is this an effect on the standard list, or a
domain-specific function? Handles for the former, doubles for the
latter.

`@overkill/doubles` remains the primary Overkill concept for test
doubles. Capability handles, if they become part of the ecosystem,
complement `testDouble()` rather than compete with it.

### Microtest Capabilities

Capability-restricted microtests deny FS, network, and child-process access
at the Node permission level. Capability handles complement this at the
language level: the microtest cannot construct a real `HttpClient` because
its injected runtime only contains the handles it asked for.

Two layers of defense:

- Node permission model — denies the _low-level_ OS access
- Handle composition — denies the _typed_ effect surface

A microtest that constructs a narrow runtime object such as `{ clock, random }`
literally cannot perform other effects through that object, because the
language types do not let it.

### Assertions And Results

See [Assertions And Results](./assertions-and-results.md).

A test that uses recording handles produces a structured effect log. In the
preferred high-level authoring style, the test asserts on that log through
the injected `case.assert` API:

```ts
case.assert.deepEqual(runtime.recorded(), expected);
return case.assert.done();
```

There is nothing to throw. The whole test reads as `(input, runtime) -> (output, effects, outcome)` — pure data, deterministic, machine-readable.

### Reproducibility

A `RuntimeSnapshot` captures the random seed, virtual clock state, FS image,
and HTTP stub set. A failing run can serialize the snapshot as a failure
artifact. The next run loads the snapshot and replays the test under
identical runtime state.

This is concrete reproducibility: not just "the same seed", but "the same
universe". Combine with the witness-replay pattern from property tests
(`*.witness.json`) and Overkill failures become almost trivially
reproducible.

## Anti-Pattern Caveats

Capability handles are not a religion. The following are _not_ required:

- you do not need to wrap pure data structures in handles — `lodash`-like
  utilities should remain ordinary functions
- you do not need to pass a runtime object through every function — most internals
  can stay pure and only the effect-performing edges take a handle
- you do not need a global "register a capability" container — that is
  exactly the service-locator pattern this doc rejects

A reasonable rule of thumb: any function that, in production, performs I/O,
reads time, generates randomness, or writes a log takes a handle. Functions
that only transform data do not.

## Performance

A handle is an object lookup and a method call. The overhead is single
nanoseconds. There is no proxy, no async indirection, no module-graph
rewiring.

Compared to module mocking — which forces the runner to control the loader,
manage a per-test patch state, and tear down between tests — handles are
strictly cheaper at runtime. They also keep the loader hooks discussed in
[Fast Feedback Loops](../architecture/fast-feedback-loops.md) simple.

## Current Stance

The current concept is intentionally narrow:

- Overkill documents capability handles as a valid and often good
  architecture pattern.
- Overkill does **not** currently ship a first-class `@overkill/world`
  package or first-party production-facing handle helpers.
- `testDouble()` remains the main official first-party tool for
  dependency replacement in tests.
- Explicit parameter passing is the preferred integration shape for
  microtests and deterministic simulation.
- `AsyncLocalStorage` may still be useful for legacy adapters or
  attribution, but it is not the primary capability-handle story.

Questions such as eager versus lazy recording, reusable scheduler handles,
or first-party helper packages are not part of the settled concept unless
the “no Overkill in consumer production code” rule is explicitly reopened.

## Influences

- Haskell `IO` separation — effects are visible in types
- ZIO `R` environment — effects are typed dependencies
- PureScript `Effect` / `Aff` — sync vs async effect distinction
- Elm `Cmd` / `Sub` — programs return effect descriptions
- `effect-ts` (TypeScript) — current state of the art for TS effect
  systems; useful idea donor even if Overkill prefers a lighter shape
- `splitmix` (Haskell) — splittable PRNGs

## Sources

- [Steele, Lea, Flood — Fast Splittable Pseudorandom Number Generators (OOPSLA 2014)](https://gee.cs.oswego.edu/dl/papers/oopsla14.pdf)
- [Effect-TS — documentation](https://effect.website)
- [ZIO Test — Why ZIO Test](https://zio.dev/reference/test/why-zio-test/)
- [The Elm Architecture](https://guide.elm-lang.org/architecture/)
- [PureScript — Effect and Aff documentation](https://pursuit.purescript.org/packages/purescript-effect)
