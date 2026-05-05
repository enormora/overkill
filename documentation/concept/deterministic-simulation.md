# Deterministic Simulation Testing

## Position

Deterministic simulation testing (DST) is the most ambitious testing
technique Overkill should keep within architectural reach. It is the only
known way to make distributed-systems and stateful-async bugs reliably cheap
to reproduce: every failure ships with a seed that re-derives the bug
exactly, and time is dilated so days of execution fit in seconds.

Overkill is not a hypervisor and cannot be Antithesis. But the *kernel* of
DST is fully realisable in process-local TypeScript: virtualize every
non-deterministic primitive, drive the system from a single seed, and replay
the witness on failure. This doc captures what a JS-test-runner-shaped DST
layer looks like.

## Background

Pioneered by FoundationDB's Flow simulator (2010s); the public exemplar
today is TigerBeetle's `vopr` ("Viewstamped Operation Replicator"), which
runs ~2 millennia of distributed-system runtime per day in CI. Antithesis
sells the same idea as a deterministic hypervisor built on FreeBSD `bhyve`.
WarpStream applied it to a full SaaS Kafka clone in 2025. Resonate,
RisingWave, S2.dev, and CockroachLabs all run their own variants.

The technique applies far below distributed systems. Any code with
concurrency, time, randomness, or external I/O benefits. JS code with
`async/await`, Promises, microtask scheduling, timers, workers, and
`SharedArrayBuffer` qualifies.

## What "Virtualize Everything" Means

A DST layer replaces all non-deterministic primitives with deterministic
simulators driven by a single seed:

-   **Time** — `Date.now`, `performance.now`, `setTimeout`, `setInterval`,
    `process.hrtime`, `queueMicrotask`, `process.nextTick`. All return
    values from a logical clock that advances when the simulator decides.
-   **Randomness** — `Math.random`, `crypto.getRandomValues`,
    `crypto.randomUUID`. Reseeded from the run seed; results are
    deterministic.
-   **Scheduling** — Promise microtask order, async task ordering, worker
    message order. The simulator owns the queue and chooses the next task
    using a seeded policy.
-   **Filesystem** — `fs.read`, `fs.write`, etc. backed by an in-memory
    image with deterministic ordering of concurrent operations.
-   **Network** — `fetch`, `http.request`, sockets, replaced by an
    in-memory transport with controllable latency and partitions.
-   **Crypto** — hashes, signatures: real algorithms, fed deterministic
    randomness when needed.

This is exactly the capability-handle pattern from `capability-handles.md`,
generalised to every effect a test might encounter.

## What "Single Seed" Means

The whole world is parameterised by one `bigint` seed. From that seed:

-   the splittable PRNG is initialised
-   per-component PRNGs are split off the parent
-   scheduling decisions consult the PRNG
-   network latency and partition events consult the PRNG
-   fault injections (dropped messages, slow disks) consult the PRNG

Two runs of the same test with the same seed produce bit-for-bit identical
behaviour. A failing run records its seed; replaying with the same seed
reproduces the failure.

## What A Test Looks Like

```ts
import { simulate } from '@overkill/sim';

test('queue stays consistent under partitions', simulate({
    seed: 'auto',          // or pin a specific bigint
    timeBudget: '10s',     // logical time to simulate
    faults: { dropRate: 0.1, partitionProb: 0.05, clockSkewMs: 50 },
}, async ({ world, world: { net, fs, log }, model }) => {
    const cluster = await startCluster(world, { nodes: 5 });
    await cluster.put('a', '1');
    await world.advance('1s');                  // logical-time fast-forward
    net.partition([0, 1], [2, 3, 4]);          // cause a partition
    await cluster.put('a', '2', { from: 0 });
    await world.advance('5s');
    net.heal();
    await world.advance('2s');
    const value = await cluster.get('a', { from: 4 });
    return assert.equal(value, '2');
}));
```

Properties:

-   no real time elapses
-   no real network is involved
-   the test runs in milliseconds even though it simulates seconds
-   the same seed produces the same outcome every time
-   a failing seed is a complete reproduction

## Where DST Sits In The Architecture

Likely package home: `@overkill/sim` — a separate first-party family,
roughly parallel to `@overkill/bench`. It depends on `@overkill/world`
(capability handles) for the standard handle interfaces and on
`@overkill/random` for splittable PRNG.

DST is not a microtest concern by default. It is closer in spirit to a
benchmark or property-test family: dedicated authoring shape, dedicated
execution profile, dedicated reporter integration.

For the runner contract:

-   a simulated test contributes the same `TestNode` shape (it is just a
    test), but its `run` function expects a simulated world rather than the
    ordinary one
-   execution requirements include single-process and serial execution to
    avoid contaminating measurements with real-time scheduling jitter
-   on failure, the seed and the recorded transcript become a structured
    failure artifact (witness)

## What Needs To Be Built

Concrete pieces, in dependency order:

1.  **Splittable PRNG** — SplitMix-style. ~150 lines of TS. Single source of
    truth for all randomness in the simulation.
2.  **Logical clock** — monotonic, advances only when `world.advance(n)` is
    called or when the scheduler runs all due timers. Implements `now`,
    `monotonic`, `sleep`, `setTimeout`, `setInterval`, `queueMicrotask`,
    `process.nextTick`.
3.  **Scheduler** — owns the microtask and macrotask queues. On each step,
    consults the PRNG for ordering decisions; runs one task; advances
    logical time as needed. This is the hard part.
4.  **Virtual filesystem** — in-memory image; supports the subset of `fs`
    methods Overkill agrees to support; deterministic ordering of
    concurrent ops.
5.  **Virtual network** — in-memory transport with explicit latency model,
    drop probability, partition control, and Fetch / `http.request` shim.
6.  **Fault injection layer** — stochastic policies driven by the PRNG;
    `world.faults.dropRate(0.1)` etc.
7.  **Witness format** — a JSON shape with `{ seed, time-budget, faults,
    eventLog, finalSnapshot }` that re-runs the same outcome.
8.  **Reporter integration** — failure artifacts include the witness,
    pretty-printed event log, and a recommended replay command.

## The Hard Part: Scheduling

JavaScript's microtask queue is ordinarily V8-managed. Inside a simulation
the runner needs to control it.

Strategies:

-   **Async hooks taming**: `node:async_hooks` lets the simulator observe
    every async resource creation. Combined with a custom scheduler
    function that resolves Promises in a controlled order, the simulator
    owns scheduling for code that runs inside a marked context.
-   **Continuation-style transformation**: write tested code on top of a
    structured-concurrency primitive (e.g. `Effection` v3) whose runtime
    is the scheduler. Tests run the same code with the simulation
    runtime swapped in. This is heavy, but elegant — and aligns with
    "platform-first" if structured concurrency standardises further.
-   **Explicit yield-point API**: code under test calls `await
    world.yield()` at key points; the simulator decides what runs next.
    This is simple but invasive.
-   **`AsyncLocalStorage` context with patched timers**: the simulator
    installs its own `setTimeout` / `setInterval` / `queueMicrotask` /
    `Promise` resolvers within an `AsyncLocalStorage` scope; calls outside
    the scope use the real platform. Pragmatic; what most JS test fakers
    already do for timers.

The recommendation is the AsyncLocalStorage-scoped approach for the first
iteration: it works with arbitrary code, requires no rewrite of the SUT,
and aligns with the platform-first stance. The yield-point or
structured-concurrency variants stay open as future directions for tighter
control.

## What DST Catches That Property Tests Don't

Plain property tests randomise *inputs*. DST randomises *the universe*.
Bugs that DST has historically caught:

-   message reordering between distributed nodes
-   clock skew triggering tie-break races
-   dropped writes during partition heal
-   GC pause coinciding with a deadline
-   concurrent retries causing duplicate side effects
-   out-of-order disk writes corrupting recovery
-   timeout scaling on slow CI machines

Most of these are invisible to example or property tests because they
require *interleavings*, not just *inputs*. DST explores interleavings.

## Connection To Other Concepts

-   `capability-handles.md` — DST is "all handles, all the time". The
    standard recording handles in `@overkill/world` are the entry point;
    DST adds the scheduler and fault layers on top.
-   `tests-as-values.md` — a DST test is a `TestNode` with a `run` function
    that takes the simulated world. No special engine support needed.
-   `results-not-exceptions.md` — DST shines when the test returns a
    structured outcome including the recorded event log, because diffs
    against expected logs are the most useful failure mode.
-   `reproducibility.md` — DST is the strongest possible form of
    reproducibility: not just deterministic ordering, but deterministic
    everything. The witness format extends `reproducibility.md`'s
    "reproducible run intent" to "reproducible run".
-   `failure-artifacts.md` — witnesses are first-class artifacts; the
    failure-artifact identity model already accommodates them.
-   `microtests-and-capabilities.md` — DST is *not* a microtest profile.
    Microtests stay cheap; DST tests are an opt-in heavier mode.
-   `benchmarking.md` — DST and benchmarks share the "single-worker, serial
    execution, isolated process" needs but are otherwise distinct.

## Connection To Property-Based Testing

DST is not the same as property-based testing, but they compose:

-   property test: "for all inputs, P(f(input))"
-   DST test: "for all interleavings, the system stays consistent"
-   DST + property test: "for all inputs and all interleavings, P holds"

The natural shape is `forall` over inputs *and* `simulate` over schedules.
Both consume seeds; both produce witnesses. Overkill should treat them as
two coordinates of the same family.

## Reasonable Scope For The First Iteration

DST in full generality is an enormous project. A staged plan that delivers
incremental value:

1.  Stage 1 — virtual clock and scheduler that supports `setTimeout`,
    `setInterval`, `queueMicrotask`, `process.nextTick`, plus seeded
    `Math.random` / `crypto.randomUUID`. This alone replaces 80% of "fake
    timers" usage and makes time-sensitive tests deterministic.
2.  Stage 2 — virtual filesystem and HTTP transport. Useful for the large
    majority of test suites that touch FS/HTTP.
3.  Stage 3 — fault injection over the virtual transports.
4.  Stage 4 — witness/replay artifacts and reporter integration.
5.  Stage 5 — explicit interleaving exploration (random schedule
    enumeration) and partition / clock-skew primitives.

Stages 1 and 2 are accessible enough to ship without massive investment and
already deliver a step-change improvement over `vi.useFakeTimers` + `nock`.

## Risks And Caveats

-   **Native code escapes the simulation.** Code that calls into native
    addons (`better-sqlite3`, `node-pty`, etc.) bypasses the virtual
    layer. Document this clearly. DST tests should consume the database
    via a handle, not directly.
-   **Scheduler completeness is hard.** The first iteration will not catch
    every interleaving. That is fine: it should still be strictly better
    than today's tests, and improvements ship incrementally.
-   **`AsyncLocalStorage` has overhead.** Not enough to matter for tests,
    but worth measuring against the fast-feedback budget.
-   **Performance is bounded by simulation cost.** A 10-second logical
    simulation may take 100ms or 5s of real time depending on event
    density. Always faster than waiting for real time, often slower than a
    pure unit test. Position DST as an integration-replacement, not a
    microtest.
-   **No security claim.** As with `microtests-and-capabilities.md`, this
    is a correctness tool, not a sandbox.

## Influences

-   FoundationDB Flow simulator
-   TigerBeetle `vopr` and `Vörtex`
-   Antithesis deterministic hypervisor
-   WarpStream's deterministic SaaS testing
-   Hermit (Meta) and rr (Linux) — Linux-only but close cousins
-   Hypothesis Stateful (Python) — small-scale DST-like model checking

## Sources

-   [TigerBeetle — VOPR docs](https://github.com/tigerbeetle/tigerbeetle/blob/main/docs/internals/vopr.md)
-   [TigerBeetle — Tale of Four Fuzzers (Nov 2025)](https://tigerbeetle.com/blog/2025-11-28-tale-of-four-fuzzers/)
-   [Antithesis — How It Works](https://antithesis.com/product/how_antithesis_works/)
-   [WarpStream — Deterministic Simulation Testing for our entire SaaS](https://www.warpstream.com/blog/deterministic-simulation-testing-for-our-entire-saas)
-   [Building open-source Antithesis](https://databases.systems/posts/open-source-antithesis-p1)
-   [Hermit (Meta)](https://github.com/facebookexperimental/hermit)
-   [rr — record/replay debugger](https://rr-project.org/)
-   [Effection v3 — structured concurrency for JavaScript](https://github.com/thefrontside/effection)
