# Microtests And Capabilities

## Definition

In Overkill, a microtest is not only a small test. It is a test that runs under a stricter capability model by default.

That distinction matters because “small unit test” often becomes meaningless once it can freely read files, touch the network, spawn helpers, and mutate hidden shared state.

## Goal

The goal is to catch accidental impurity and hidden coupling early.

It is **not** to claim a secure sandbox against malicious code.

## Capability Defaults

Strict microtest mode should deny, by default:

-   filesystem reads outside what Node needs to load the test program
-   filesystem writes
-   network access
-   child processes
-   worker threads unless explicitly required by the runner
-   addons, WASI, and similar escape hatches

The likely first enforcement mechanism is Node’s permission model:

-   `--permission`
-   `--allow-fs-read`
-   `--allow-fs-write`
-   `--allow-net`
-   `--allow-child-process`
-   `--allow-worker`

Source:

-   <https://nodejs.org/api/permissions.html>

## Important Limitation

Node explicitly describes the permission model as a “seat belt” model and notes that it is not a security boundary against malicious code. The docs also note bypass caveats such as alternative file access routes and inherited file descriptors.

Overkill should repeat that distinction clearly.

## Coverage Exception

Current Node V8 coverage still writes coverage reports to disk through `NODE_V8_COVERAGE` and `v8.takeCoverage()`. That means strict microtest mode needs a narrow exception if coverage collection is enabled.

Conceptually:

-   microtests remain side-effect-restricted
-   coverage output is a runner-owned escape hatch
-   writes should be limited to a dedicated coverage artifact directory
-   that exception should be explicit in configuration and diagnostics

Sources:

-   <https://nodejs.org/api/v8.html>
-   <https://nodejs.org/dist/latest/docs/api/cli.html#node_v8_coveragedir>

## Runner Profiles

Overkill should likely expose capability profiles rather than one giant configuration surface.

Examples:

-   `micro-strict`
-   `micro-supervised`
-   `micro-with-coverage`
-   `integration-local`
-   `benchmark-process`

These are conceptual profiles, not implementation details.

## Hang Detection And Forced Termination

Overkill should distinguish between:

-   leak detection after a test finishes
-   soft timeout detection while a test is still making progress
-   hard forced termination of a hung test

These are not equivalent.

For example:

-   never-closing servers, timers, ports, or listeners may be detectable as leftover resources
-   a `while (true)` loop in the current thread is not reliably recoverable without an external isolation boundary

That means strict microtest mode should not promise hard hang recovery if it runs in-process. If Overkill wants force-quit behavior, that should be attached to execution modes that already use a worker or subprocess boundary.

Recommended concept direction:

-   in-process microtests: allow soft timeouts and optional resource-leak diagnostics, but do not promise hard recovery from CPU-bound hangs
-   supervised microtests: allow crash-only supervision, where a watchdog may kill the disposable test process or worker if it wedges
-   isolated integration, browser, or benchmark modes: allow a supervisor to terminate a stuck worker or process

This preserves the low-overhead microtest path while still allowing stronger guarantees in isolated execution profiles.

Crash-only supervision is acceptable in these supervised profiles because “runner terminated with hard timeout” is still better than a permanently wedged run. The tradeoff is that partial in-memory state, cleanup, and reporting continuity must be treated as disposable.

## Why Not Hooks

Once microtests rely on hidden setup hooks, their capability guarantees become harder to reason about. Explicit context and runner-owned profiles align better with the microtest definition.
