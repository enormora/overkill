# Microtests And Capabilities

## Definition

A **microtest** is a test that runs under a strict capability model by
default, is expected to be deterministic and locally scoped, and is
optimized for the fastest feedback loop.

The defining property is the capability boundary, not size or speed. Size
and speed are *consequences* of the boundary: a test denied filesystem
writes, network access, child processes, and addons cannot accidentally
become an integration test or a slow test.

A test is a microtest if and only if it runs in a microtest *capability
profile*. Two tests with identical bodies but different profiles are
different tests.

See `glossary.md` for the canonical term definitions.

## Goal

The goal is to catch accidental impurity and hidden coupling early, and to
keep the microtest tier fast enough to run constantly during development.

It is **not** to claim a secure sandbox against malicious code.

## Threat Model

Out of scope for the microtest capability model:

-   defense against malicious test code (a malicious test can corrupt the
    runner's own state, exfiltrate data via permitted channels, or
    exhaust CPU)
-   defense against compromised dependencies (the dependency loaded into
    the test process has the same authority the test does)
-   defense against the runner itself being malicious
-   container or VM-level isolation

In scope:

-   prevention of *accidental* I/O, network access, and process spawning
-   detection of accidental impurity early enough to remediate
-   keeping a hostile dependency from being able to silently change the
    test's observable behavior through environmental side effects

If stronger isolation is needed (untrusted code, multi-tenant CI), the
appropriate tool is a container, a VM, or a Linux user namespace, not the
microtest profile.

## Capability Defaults

Strict microtest mode denies, by default:

-   filesystem reads outside what Node needs to load the test program
-   filesystem writes (except runner-owned escape hatches; see below)
-   network access
-   child processes
-   worker threads unless explicitly required by the runner
-   addons, WASI, and similar escape hatches
-   `process.exit` (treated as a runner error if the test calls it)

The first enforcement mechanism is Node's permission model:

-   `--permission`
-   `--allow-fs-read`
-   `--allow-fs-write`
-   `--allow-net`
-   `--allow-child-process`
-   `--allow-worker`

Source: <https://nodejs.org/api/permissions.html>

## Important Limitation

Node explicitly describes the permission model as a "seat belt" model and
notes that it is not a security boundary against malicious code. The docs
also note bypass caveats such as alternative file access routes and
inherited file descriptors.

Overkill repeats that distinction clearly. The threat model section above
makes it explicit.

## Runner-Owned Escape Hatches

Some writes are necessary for the runner itself to function. These are
narrow, runner-owned, and explicit in configuration and diagnostics:

-   coverage output directory (when coverage is enabled)
-   baseline update directory (only in explicit update mode)
-   strip cache (`~/.cache/overkill/strip/`)
-   V8 startup snapshot cache (`~/.cache/overkill/snapshots/`)
-   per-test temp directory (`os.tmpdir() + /overkill-<run-id>/<test-id>/`)
    when the profile permits it (integration profile, not microtest)

The runner enforces that these directories are the only paths writable
under microtest profile, and surfaces unexpected writes as diagnostics.

## Per-Test Versus Per-Process Capabilities

Node's permission model is process-wide. Capabilities cannot be tightened
or relaxed per individual test running in the same process.

This means:

-   tests that share a worker share its capability set
-   if two tests need different capabilities, they must run in different
    workers or processes
-   the orchestrator routes tests by their declared capabilities; tests
    with incompatible declarations are scheduled to separate workers

Capability declarations are *intersected* down the suite tree (a child
cannot extend the parent's permissions; it can only narrow them).

## Capability Handles As The Language-Level Boundary

The Node permission model is the OS-level seat belt. The
`capability-handles.md` pattern adds a language-level boundary: a
microtest's `World` is a typed bag of effect handles, and the test cannot
perform effects whose handles it did not receive.

Two layers of defense, complementary:

-   Node permission model — denies the *low-level* OS access
-   Handle composition — denies the *typed* effect surface

A microtest written against `@overkill/world` and asking only for
`{ clock, random }` literally cannot perform other effects, because the
language types do not let it.

## Coverage Exception

Current Node V8 coverage still writes coverage reports to disk through
`NODE_V8_COVERAGE` and `v8.takeCoverage()`. That means strict microtest
mode needs a narrow exception when coverage collection is enabled.

Conceptually:

-   microtests remain side-effect-restricted
-   coverage output is a runner-owned escape hatch
-   writes are limited to a dedicated coverage artifact directory
-   the exception is explicit in configuration and diagnostics

Sources:

-   <https://nodejs.org/api/v8.html>
-   <https://nodejs.org/dist/latest/docs/api/cli.html#node_v8_coveragedir>

## Runner Profiles

Standard capability profiles (see `glossary.md`):

-   `micro-strict` — denies almost everything; the default microtest
    profile
-   `micro-supervised` — same denials, plus subprocess supervision for
    crash-only recovery
-   `micro-with-coverage` — micro-strict with a narrow exception for
    coverage writes
-   `integration-local` — allows FS write within a per-test temp dir,
    loopback net, child process
-   `benchmark-process` — integration-local plus single-worker
    serialization

These are conceptual profiles. Implementation details (exact flag set,
exact temp-dir layout) are runner-internal.

## In-Source Microtests

Microtests can live inside production source files, gated by
`if (import.meta.test) { ... }` or an equivalent sentinel:

```ts
// source/users.ts
export function buildUser(name: string) {
    return { name: name.trim() };
}

if (import.meta.test) {
    test('strips whitespace', ({ assert }) =>
        assert.equal(buildUser('  Ada  ').name, 'Ada'));
}
```

The runner's loader strips the `if (import.meta.test) { ... }` block in
production builds and registers the inner tests when in test mode. Native
Node type stripping makes this nearly free; combined with tests-as-values
the tests are exported alongside production code as inert data when test
mode is off.

Native Node 25 already supports `import.meta.main` for self-running
source files; Overkill's loader extends the convention with
`import.meta.test` for the test-mode sentinel.

In-source microtests inherit the file's profile by default. They can also
declare metadata like any other test.

## Hang Detection And Forced Termination

Distinguish between:

-   leak detection after a test finishes
-   soft timeout detection while a test is still making progress
-   hard forced termination of a hung test

These are not equivalent.

For example:

-   never-closing servers, timers, ports, or listeners are detectable as
    leftover resources via `process._getActiveHandles()` snapshots
-   a `while (true)` loop in the current thread is not reliably
    recoverable without an external isolation boundary

That means strict microtest mode does not promise hard hang recovery if
it runs in-process. If Overkill wants force-quit behavior, that is
attached to execution modes that already use a worker or subprocess
boundary.

Concept direction:

-   in-process microtests: allow soft timeouts and optional resource-leak
    diagnostics, but do not promise hard recovery from CPU-bound hangs
-   supervised microtests: allow crash-only supervision, where a watchdog
    may kill the disposable test process or worker if it wedges. *This
    requires subprocess isolation*, since worker threads inherit the
    parent's permissions and can be CPU-stuck without parent recourse.
-   isolated integration, browser, or benchmark modes: allow a supervisor
    to terminate a stuck worker or process

This preserves the low-overhead microtest path while still allowing
stronger guarantees in isolated execution profiles.

Crash-only supervision is acceptable in supervised profiles because
"runner terminated with hard timeout" is still better than a permanently
wedged run. The tradeoff is that partial in-memory state, cleanup, and
reporting continuity must be treated as disposable.

## Why Not Hooks

Once microtests rely on hidden setup hooks, their capability guarantees
become harder to reason about. Explicit context and runner-owned profiles
align better with the microtest definition.

Hooks also fight the capability boundary: a `beforeEach` that touches the
filesystem to set up a fixture either fails under strict capability
denials or quietly opens up the boundary. Either way, the microtest
contract becomes muddier.

Test macros (`tests-as-values.md` § macros) are the recommended reuse
mechanism instead.

## Connection To Other Docs

-   `capability-handles.md` — language-level capability boundary
    complementing the OS-level one
-   `runtime-behavior.md` — process-wide consequences of the capability
    profile
-   `fast-feedback-loops.md` — fast microtest feedback loops are the
    motivation for the strict profile
-   `tests-as-values.md` — microtests as data; macros instead of hooks
-   `results-not-exceptions.md` — returned outcomes mean less stack-walk
    overhead in the success path
-   `glossary.md` — canonical definitions of capability profile, runner
    profile, microtest

## Sources

-   [Node permissions](https://nodejs.org/api/permissions.html)
-   [Node V8 coverage](https://nodejs.org/api/v8.html)
-   [Node `NODE_V8_COVERAGE`](https://nodejs.org/dist/latest/docs/api/cli.html#node_v8_coveragedir)
-   [Vitest in-source testing](https://vitest.dev/guide/in-source)
-   [Rust `#[cfg(test)] mod tests`](https://doc.rust-lang.org/book/ch11-03-test-organization.html)
