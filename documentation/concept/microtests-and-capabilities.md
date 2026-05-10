# Microtests And Capabilities

## Definition

A **microtest** is a test that runs under a strict capability model by
default, is expected to be deterministic and locally scoped, and is
optimized for the fastest feedback loop.

The defining property is the capability boundary, not size or speed. Size
and speed are _consequences_ of the boundary: a test denied filesystem
writes, network access, child processes, and addons cannot accidentally
become an integration test or a slow test.

A test is a microtest if and only if it runs in a microtest _capability
profile_. Two tests with identical bodies but different profiles are
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

-   prevention of _accidental_ I/O, network access, and process spawning
-   detection of accidental impurity early enough to remediate
-   keeping a hostile dependency from being able to silently change the
    test's observable behavior through environmental side effects

If stronger isolation is needed (untrusted code, multi-tenant CI), the
appropriate tool is a container, a VM, or a Linux user namespace, not the
microtest profile.

## Capability Defaults

The closed enumeration of capabilities Overkill recognises:

```ts
type Capability =
    | 'fs-read' // filesystem reads
    | 'fs-write' // filesystem writes
    | 'net' // any network access
    | 'child-process' // spawning subprocesses
    | 'worker' // creating worker threads
    | 'addon' // loading native addons
    | 'wasi' // WASI imports
    | 'process-exit'; // calling process.exit
```

This is the type used in `Metadata.capabilities` (see
`metadata-and-selection.md`) and across the doc set. New capabilities
require an explicit addition to this enumeration; the runner does not
recognise free-form strings.

Strict microtest mode denies, by default:

-   filesystem reads outside what Node needs to load the test program
    (`fs-read` denied except for the loader's needs)
-   filesystem writes (`fs-write` denied except for runner-owned
    escape hatches; see below)
-   network access (`net` denied)
-   child processes (`child-process` denied)
-   worker threads unless explicitly required by the runner (`worker`
    denied)
-   addons (`addon` denied), WASI (`wasi` denied), and similar escape
    hatches
-   `process.exit` (treated as a runner error if the test calls it;
    `process-exit` capability denied)
-   `console.*` usage is reported as a microtest violation when
    strict console diagnostics are enabled. `console.*` is **not**
    listed as a capability above because Node's permission model does
    not cover it; the boundary is enforced through runtime
    observability, not permission flags.

The first enforcement mechanism is Node's permission model (Node 20+):

-   `--permission`
-   `--allow-fs-read`
-   `--allow-fs-write`
-   `--allow-net`
-   `--allow-child-process`
-   `--allow-worker`

Source: <https://nodejs.org/docs/latest-v20.x/api/permissions.html#file-system-permissions>

How Overkill applies these flags:

-   **Path-scoped grants.** `--allow-fs-write=<path>` allows writes
    only to the listed paths (repeated flags or comma-separated;
    glob wildcards supported). The runner uses absolute paths.
-   **Non-existent directories require an explicit wildcard.** If a
    granted directory doesn't exist at spawn time (e.g. a fresh
    coverage or run-record directory), the path must end in `/*`
    or Node will only allow writing the directory entry itself,
    not files inside it.
-   **Permissions do not inherit.** Per Node's docs, "the model does
    not inherit to a child node process or a worker thread." Each
    Overkill worker is spawned as a fresh Node process with its own
    `--permission` flags; the parent overkill process does not need
    to run under the permission model itself.
-   **Capability isolation requires `child_process`.** Worker threads
    share the parent's permission set; subprocesses can each have
    their own. Microtest workers are therefore separate Node
    processes (see `composition-order.md` § Execution-Time
    Wrapping).
-   **Launch path is irrelevant.** `npx overkill ...`, direct
    invocation, and any other launcher all work identically — the
    runner spawns workers explicitly with the right flags;
    inheritance is not assumed.

Caveats `console.*` and symbolic links:

-   `console.*` is not covered by the permission model. Strict
    microtest handling of `console.*` relies on runtime
    observability, not on permission flags.
-   Symbolic links are followed even when they escape granted paths.
    The runner resolves granted paths and refuses to start workers
    if any component is a symlink to outside the run record. The
    Node docs warn: "Relative symbolic links may allow access to
    arbitrary files and directories."

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

The runner enforces that these directories are the only paths writable
under microtest profile, and surfaces unexpected writes as diagnostics.

If future runner-owned caches are added, they should be documented as their
own explicit write exceptions rather than assumed here by default.

Baseline and snapshot workflows belong to higher-layer families, not to the
strict microtest profile.

## Per-Test Versus Per-Process Capabilities

Node's permission model is process-wide. Capabilities cannot be tightened
or relaxed per individual test running in the same process.

This means:

-   tests that share a worker share its capability set
-   if two tests need different capabilities, they must run in different
    workers or processes
-   the orchestrator routes tests by their declared capabilities; tests
    with incompatible declarations are scheduled to separate workers

Capability declarations are _intersected_ down the suite tree (a child
cannot extend the parent's permissions; it can only narrow them).

## Capability Handles As The Language-Level Boundary

The Node permission model is the OS-level seat belt. The
`capability-handles.md` pattern adds a language-level boundary: a
microtest's runtime object is a typed bag of effect handles, and the test cannot
perform effects whose handles it did not receive.

Two layers of defense, complementary:

-   Node permission model — denies the _low-level_ OS access
-   Handle composition — denies the _typed_ effect surface

A microtest written against a narrow injected runtime such as
`{ clock, random }` literally cannot perform other effects through that
runtime, because the language types do not let it.

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
    profile, and fails on observed `console.*` usage
-   `micro-supervised` — same denials, plus subprocess supervision for
    crash-only recovery
-   `micro-with-coverage` — micro-strict with a narrow exception for
    coverage writes; runs single-threaded (see `coverage.md`)
-   `micro-supervised-with-coverage` — supervised mode + coverage
    write exception; also single-threaded
-   `integration-local` — allows FS write within a per-test temp dir,
    loopback net, child process
-   `benchmark-process` — integration-local plus single-worker
    serialization

These are conceptual profiles. Implementation details (exact flag set,
exact temp-dir layout) are runner-internal.

Modern Node diagnostics channels provide built-in `console.log`,
`console.info`, `console.debug`, `console.warn`, and `console.error`
observability. That makes strict console policy plausible without directly
patching `console.*` itself. It is still a form of instrumentation and may
carry some overhead, so profiles should keep it explicit.

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
    may kill the disposable test process or worker if it wedges. _This
    requires subprocess isolation_, since worker threads inherit the
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
