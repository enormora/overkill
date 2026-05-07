# Deterministic Simulation Testing

## Position

Deterministic simulation testing should remain a first-class Overkill concept,
but not as an Overkill-owned application architecture.

Overkill should not prescribe one dependency-injection style, one runtime
object shape, or one simulator implementation. Instead, it should provide first-class
support for **simulation-aware runtimes**:

-   tests may declare that they run under a specific simulation adapter
-   adapters declare execution requirements and replay metadata
-   failures capture seeds, scenarios, and witnesses in a standard shape
-   the same simulator can also be used outside tests for manual or
    exploratory runs

This is the important distinction. The simulator belongs to the application or
an adapter package. Overkill owns the _testing integration_ around it.

## Why This Matters

Deterministic simulation is one of the few techniques that makes
time-sensitive, stateful, or distributed bugs reliably reproducible. A single
seed can reproduce:

-   timing-sensitive logic bugs
-   races and ordering bugs
-   random-input dependent failures
-   flaky third-party-service behavior
-   state-machine bugs that only appear after long sequences of events

This does not require a fully virtualized universe or a hypervisor. In many
real TypeScript systems, the most useful deterministic simulation is much more
pragmatic:

-   a virtual clock
-   seeded randomness
-   one or more deterministic local services
-   named scenario presets
-   explicit replay metadata

## Important Constraint

Overkill cannot force an application to be simulation-friendly.

Deterministic simulation only works when the system under test already has some
seam where the runtime can be swapped:

-   explicit dependency injection
-   configurable base URLs
-   runtime factories
-   adapter registration
-   runtime bootstrapping

If a codebase hardcodes globals, ambient services, and production-only network
destinations everywhere, Overkill cannot make that code deterministically
simulatable by itself.

## What Overkill Should Own

Overkill should own the runner-facing integration surface:

-   simulation-aware execution profiles
-   structured seed handling
-   witness capture and replay metadata
-   scenario identity and reporting
-   execution requirements contributed by simulation adapters

Overkill should _not_ own:

-   a mandatory `World` pattern
-   predefined app-level service handles
-   one official simulator implementation for all apps
-   hidden monkey-patching as the default strategy

## Simulation Adapters, Not Built-In Worlds

The clean concept is a generic simulation adapter contract.

An adapter declares:

-   how to install the simulation runtime
-   what execution strategy it needs
-   what seed and scenario metadata it uses
-   how to capture witness or replay information
-   how to expose manual or exploratory launch modes when relevant

Illustrative shape:

```ts
type SimulationAdapter = {
    readonly name: string;
    readonly executionRequirements?: ExecutionRequirement[];
    start(options: { seed?: bigint; scenario?: string; signal: AbortSignal }): Promise<SimulationSession>;
};

type SimulationSession = {
    readonly runtimeMetadata: {
        seed?: bigint;
        scenario?: string;
        endpoint?: URL;
    };
    witness?(): Promise<unknown>;
    stop(): Promise<void>;
};
```

This keeps Overkill DI-agnostic. A simulator may be:

-   in-process with injected handles
-   a spawned local HTTP service
-   a worker-hosted state machine
-   a browser or multi-process harness

Overkill only needs the generic contract.

## Scenarios As First-Class Presets

Many deterministic systems benefit from named **scenarios**: stable, speaking
presets of multiple simulation options.

Examples:

-   `default`
-   `error`
-   `logged-in`
-   `empty-basket`
-   `slow-upstream`
-   `payments-500`

A scenario is not just one flag. It is a reviewed preset that may bundle:

-   seed defaults
-   fixture data
-   service behavior
-   latency/fault behavior
-   authentication/session state
-   third-party API responses

Scenarios are valuable because they give teams a shared vocabulary for common
states and failures. They also improve artifact identity and replay:

-   failing run: `checkout > uses fallback totals [scenario=payments-500]`
-   witness includes both `seed` and `scenario`
-   manual reproduction can launch the same scenario directly

## External Deterministic Services Are A Real Simulation Pattern

Deterministic simulation should not be limited to in-process fake clocks or
mocked modules.

A more realistic pattern is:

-   spawn a local deterministic server
-   point the app at it by swapping the base URL
-   route real HTTP requests through that server
-   choose behavior through a scenario key such as `default` or `error`

The same broad idea also applies to other protocols and service shapes:

-   local WebSocket services
-   deterministic queue consumers or publishers
-   spawned worker or process harnesses
-   protocol-specific simulators that are not HTTP at all

That model has several advantages:

-   it exercises real service boundaries
-   it avoids module interception
-   it works well for integration and browser-style tests
-   it can often be used for manual exploratory runs too

Overkill should therefore treat **simulation via deterministic local
services** as a first-class pattern, not as an edge case.

## What A Test Might Look Like

The `withRuntime` and `simulation` helpers shown below are illustrative
sketches; they are listed as placeholders in `types-index.md`.
`SimulationAdapter` and `SimulationSession` *are* canonical (see the
section above and the types index).


In-process style:

```ts
test(
    'queue stays consistent under the deterministic runtime',
    withRuntime(simulation(myAppSim, { seed: 42n, scenario: 'default' }), async ({ t }) => {
        // ...
    }),
);
```

Local-service style:

```ts
test(
    'checkout handles upstream 500s',
    withRuntime(simulation(deterministicApi, { scenario: 'payments-500' }), async ({ t, runtime }) => {
        const baseUrl = runtime.endpoint;
        // App under test talks to the deterministic service over real HTTP.
    }),
);
```

The common idea is not the exact helper name. The important thing is that the
runtime is explicitly declared, and Overkill sees enough metadata to plan,
report, and replay it.

## Manual And Exploratory Simulation

Simulation should not be test-only.

If a deterministic runtime is genuinely useful, teams should also be able to
launch it manually for exploratory work:

-   open the app against a deterministic local backend
-   reproduce a bug from a captured seed and scenario
-   inspect logs, traces, and state transitions interactively

That is another reason Overkill should not own the simulator itself. The
simulator should be usable outside the test runner; Overkill then integrates
with that runtime for automation, reporting, and replay.

## Seeds, Witnesses, And Replays

When a simulation-aware run fails, Overkill should capture structured replay
metadata when the adapter provides it.

Minimum useful metadata:

-   adapter name
-   scenario key
-   seed
-   runtime version
-   adapter-specific witness payload

Not every simulator will use the same witness format. Overkill should
standardize the envelope, not the internals of every simulator.

## Execution Requirements

Simulation adapters may contribute execution requirements just like other
runtime layers.

Typical needs:

-   serial execution
-   one worker per spawned service
-   fixed ports or port-allocation coordination
-   artifact directories
-   longer startup or shutdown budgets

The runner should not guess these rules. The adapter declares them; Overkill
resolves them alongside the rest of the run plan.

## Relationship To Capability Handles

Capability handles remain one valid implementation style for simulation, but
they are not the only one and must not be mandatory.

Possible implementations:

-   DI + capability handles
-   configurable service factories
-   local deterministic services behind HTTP, WebSocket, or another protocol
-   custom framework runtime adapters

So the right relationship is:

-   capability handles are one useful simulation-friendly pattern
-   simulation support in Overkill must stay broader than capability handles

## What This Catches

Even without a full virtualized universe, simulation-aware runtimes can catch
bugs that plain example tests miss:

-   error-path handling against third-party APIs
-   session-state and workflow bugs
-   timing-sensitive logic around retries or deadlines
-   randomness-dependent behavior
-   failures that only show up when several runtime knobs move together

The scenario concept is especially useful here because many real teams do not
need infinite random universes first. They need a small, explicit library of
reproducible operational situations.

## Reasonable Scope

The concept should stay ambitious but grounded.

Strong near-term direction:

1.  simulation-aware runtime adapter contract
2.  scenario-aware artifact identity and reporting
3.  seed/witness/replay envelope
4.  support for local deterministic services and base-URL swapping
5.  optional in-process simulation helpers where they fit

More speculative territory:

-   a fully virtualized scheduler
-   virtual filesystems and transports as first-party packages
-   exhaustive interleaving exploration
-   a universal Overkill simulation runtime

Overkill should stay open to those ideas without pretending they are required
for the first serious version of deterministic simulation support.
