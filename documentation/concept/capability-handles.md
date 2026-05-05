# Capability Handles

## Position

Mocking is the testing technique Overkill most wants to avoid normalizing. It
hides where effects come from, makes refactoring brittle, requires
module-graph patches that conflict with capability-restricted microtests, and
produces tests that look pure but secretly mutate global registries between
runs.

This doc proposes the canonical replacement: **capability handles** — typed
bags of effect-performing services passed explicitly into code, with
recording variants used in tests.

It is heavily influenced by Haskell's `IO` separation, ZIO's `R` environment,
PureScript's `Effect`/`Aff`, Elm's `Cmd`/`Sub` model, and ports of those ideas
to Scala (cats-effect, ZIO), F# (Eff), and TypeScript (`effect`, `fp-ts`,
`@effect/io`).

## The Core Idea

Effects are not implicit globals. They are typed values passed in:

```ts
type World = {
    readonly clock: Clock;
    readonly random: Random;
    readonly fs: FileSystem;
    readonly http: HttpClient;
    readonly log: Logger;
};

async function saveUser(world: World, input: UserInput): Promise<Saved> {
    const id = await world.random.uuid();
    const at = world.clock.now();
    await world.fs.write(`users/${id}.json`, JSON.stringify({ ...input, id, at }));
    world.log.info(`saved ${id}`);
    return { id, at };
}
```

The function is testable without mocking, monkey patching, or module-graph
intervention. To test, pass a different `World`.

## Recording Handles As The Canonical Test Variant

Instead of mocks, Overkill supplies *recording* implementations of the
standard handles:

```ts
const world = recordingWorld({
    clock: virtualClock('2026-01-01T00:00:00Z'),
    random: seededRandom(0xc0ffee),
    fs: memoryFs({ 'users/_template.json': '{}' }),
    http: stubHttp({ 'GET /users/1': { status: 200, body: { id: 1 } } }),
});

const saved = await saveUser(world, { name: 'Ada' });

return assert.equal(world.recorded(), [
    { kind: 'random.uuid' },
    { kind: 'clock.now' },
    { kind: 'fs.write', path: 'users/<uuid>.json', body: '...' },
    { kind: 'log.info', msg: 'saved <uuid>' },
]);
```

Key properties:

-   handles are typed values, not modules patched at runtime
-   the recording is structured data, asserted with normal equality
-   determinism is built in: `virtualClock` and `seededRandom` reproduce
    bit-for-bit
-   the test reads as a transcript: input + world → output + effect log
-   no `jest.mock`, no `vi.spyOn`, no patching, no restore registry

## Why This Is Better Than Mocking

### Refactoring stays local

A mock of `import { fetch } from './lib'` breaks when `lib` is renamed or the
import is moved. A handle passed as a parameter breaks only if the function
signature actually changes.

### Determinism is the path of least resistance

A module mock has to be carefully reset between tests. A handle is a fresh
object per test by construction. There is no shared mutable mock registry.

### Capability boundaries become visible

A function that takes `World` declares its effect surface in its signature. A
function that mutates implicit globals does not. Code review reads better,
and refactors that drop a no-longer-needed effect remove a parameter rather
than orphaning a module mock.

### Composes with capability-restricted microtests

Microtests run with no filesystem or network access. A `World` whose handles
are in-memory simulators satisfies that constraint. Module-mocking patterns
*require* the runner to allow `node:fs` access (to load the original) and
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

The standard set Overkill should ship in `@overkill/world` (or a similar
package family):

-   `Clock` — wall and monotonic time, `sleep`
-   `Random` — UUIDs, integers, bytes, picks; backed by a SplitMix-style
    splittable PRNG so parallel and tree-shaped generation stay
    deterministic
-   `Logger` — structured logging with capture
-   `FileSystem` — `read`, `write`, `stat`, `glob`; in-memory variant for
    tests
-   `HttpClient` — Fetch-shaped; recording and stubbing variants
-   `Process` — `env`, `argv`, `exit`, signals
-   `Crypto` — hash, sign, verify, random bytes
-   `Database` — minimal query/exec; per-test in-memory variant when
    feasible

This is *not* a service-locator. There is no global lookup. The handles are
parameters. A test in microtest profile can construct a `World` with only
`Clock` and `Random` and refuse to provide the others.

## Recording Variants

A recording handle does two things:

1.  Implements the interface (in-memory, deterministic).
2.  Records every invocation as a typed event in an in-memory log.

```ts
type RecordedEvent =
    | { kind: 'clock.now'; at: bigint }
    | { kind: 'random.uuid'; produced: string }
    | { kind: 'fs.write'; path: string; bytes: number; contentHash: string }
    | { kind: 'log.info'; msg: string; fields?: Fields }
    | { kind: 'http.request'; method: string; url: string; bodyHash?: string };

type RecordingWorld = World & {
    recorded(): ReadonlyArray<RecordedEvent>;
    snapshot(): WorldSnapshot;
    restore(snapshot: WorldSnapshot): void;
};
```

Tests assert on `recorded()` directly. Reporters can attach the recording to
a failed test as a structured artifact. Replays use `snapshot`/`restore` to
reproduce a world state.

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

## Capabilities Beyond Effects: Authority Tokens

Some "capabilities" are not effect-performing handles but *authority tokens*
the runner grants. Examples:

-   `CoverageWriter` — permits writing to the coverage artifact directory
-   `BaselineUpdater` — permits updating baselines (only present in update
    mode)
-   `SnapshotCollector` — permits collecting snapshot output

Tokens are opaque branded types. Owning the token is the only way to access
the operation. The runner constructs and passes them; user code cannot forge
one. This is the "ocap" pattern — object capabilities — applied to the test
runner. It dovetails with the Node permission model (the seat belt) but adds
runner-level granularity that Node permissions cannot express.

## Connection To `@overkill/doubles`

The current doubles concept (see `doubles.md`) centers on `testDouble()` for
function doubles. Capability handles complement it:

-   handles model collaborators with several methods (clock, fs, logger)
-   `testDouble()` models single-function doubles passed explicitly
-   they compose: a handle's method can be a `testDouble()` for fine-grained
    per-call control

Recommendation: `@overkill/doubles` should remain the package for
function-level doubles. `@overkill/world` (or whatever the family becomes)
ships standard recording handles. Both refuse module-graph patching as a
matter of policy.

## Connection To Microtest Capabilities

Capability-restricted microtests deny FS, network, and child-process access
at the Node permission level. Capability handles complement this at the
language level: the microtest cannot construct a real `HttpClient` because
its `World` only contains the handles it asked for.

Two layers of defense:

-   Node permission model — denies the *low-level* OS access
-   Handle composition — denies the *typed* effect surface

A microtest that imports `@overkill/world/recording-only` and asks for
`{ clock, random }` literally cannot perform other effects, because the
language types do not let it.

## Connection To `assertions-and-results.md` And `results-not-exceptions.md`

A test that uses recording handles produces a structured effect log. The
returned-value assertion model lets the test assert on that log directly:

```ts
return assert.equal(world.recorded(), expected);
```

There is nothing to throw. The whole test reads as `(input, world) ->
(output, effects, outcome)` — pure data, deterministic, machine-readable.

## Connection To Reproducibility

A `WorldSnapshot` captures the random seed, virtual clock state, FS image,
and HTTP stub set. A failing run can serialize the snapshot as a failure
artifact. The next run loads the snapshot and replays the test under
identical world state.

This is concrete reproducibility: not just "the same seed", but "the same
universe". Combine with the witness-replay pattern from property tests
(`*.witness.json`) and Overkill failures become almost trivially
reproducible.

## Anti-Pattern Caveats

Capability handles are not a religion. The following are *not* required:

-   you do not need to wrap pure data structures in handles — `lodash`-like
    utilities should remain ordinary functions
-   you do not need to pass `World` through every function — most internals
    can stay pure and only the effect-performing edges take a handle
-   you do not need a global "register a capability" container — that is
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
`fast-feedback-loops.md` simple.

## Open Questions

-   should `@overkill/world` ship standard recording variants or only the
    interfaces, leaving recording to a separate package?
-   should the `recorded()` log be eagerly populated or lazily materialized?
    eager is simpler; lazy avoids cost in passing tests
-   how aggressively should Overkill push handles for *production* code? the
    pattern is more useful in tests, but it is most beneficial when the
    code itself is structured around handles to begin with — should
    Overkill ship companion guidance for production code, or stay a test
    library?
-   how do handles integrate with `AsyncLocalStorage`? a single ALS slot for
    the current world is one option; explicit parameter passing is the
    other; the recommendation is explicit passing for microtests and ALS
    for legacy code that cannot be threaded
-   when should virtualized `setTimeout` / microtask scheduling be part of
    the standard `Clock` handle, vs a separate `Scheduler` handle? probably
    separate, because most code does not need scheduler control

## Influences

-   Haskell `IO` separation — effects are visible in types
-   ZIO `R` environment — effects are typed dependencies
-   PureScript `Effect` / `Aff` — sync vs async effect distinction
-   Elm `Cmd` / `Sub` — programs return effect descriptions
-   `effect-ts` (TypeScript) — current state of the art for TS effect
    systems; useful idea donor even if Overkill prefers a lighter shape
-   Mark Miller's "object capabilities" — authority tokens
-   `splitmix` (Haskell) — splittable PRNGs

## Sources

-   [Steele, Lea, Flood — Fast Splittable Pseudorandom Number Generators (OOPSLA 2014)](https://gee.cs.oswego.edu/dl/papers/oopsla14.pdf)
-   [Effect-TS — documentation](https://effect.website)
-   [ZIO Test — Why ZIO Test](https://zio.dev/reference/test/why-zio-test/)
-   [The Elm Architecture](https://guide.elm-lang.org/architecture/)
-   [Mark Miller — Robust Composition (object capabilities)](http://www.erights.org/talks/thesis/markm-thesis.pdf)
-   [PureScript — Effect and Aff documentation](https://pursuit.purescript.org/packages/purescript-effect)
