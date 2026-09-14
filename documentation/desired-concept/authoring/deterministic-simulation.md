# Deterministic Simulation Testing

## Position

Deterministic simulation testing should remain a first-class Overkill concept,
but not as an Overkill-owned application architecture.

Overkill should not prescribe one dependency-injection style, one runtime
object shape, or one simulator implementation. Instead, it should provide
first-class support for **simulation-aware resources and runtimes**:

- tests may attach resources created from simulation definitions
- resources declare execution requirements and replay metadata
- failures capture seeds, scenarios, and witnesses in a standard shape
- the same simulator can also be used outside tests for manual or
  exploratory runs

This is the important distinction. The simulator belongs to the application or
an adapter package. Overkill owns the resource and runner integration around it.

## Why This Matters

Deterministic simulation is one of the few techniques that makes
time-sensitive, stateful, or distributed bugs reliably reproducible. A single
seed can reproduce:

- timing-sensitive logic bugs
- races and ordering bugs
- random-input dependent failures
- flaky third-party-service behavior
- state-machine bugs that only appear after long sequences of events

This does not require a fully virtualized universe or a hypervisor. In many
real TypeScript systems, the most useful deterministic simulation is much more
pragmatic:

- a virtual clock
- seeded randomness
- one or more deterministic local services
- named scenario presets
- explicit replay metadata

## Important Constraint

Overkill cannot force an application to be simulation-friendly.

Deterministic simulation only works when the system under test already has some
seam where the runtime can be swapped:

- explicit dependency injection
- configurable base URLs
- runtime factories
- adapter registration
- runtime bootstrapping

If a codebase hardcodes globals, ambient services, and production-only network
destinations everywhere, Overkill cannot make that code deterministically
simulatable by itself.

## What Overkill Should Own

Overkill should own the runner-facing integration surface:

- simulation-aware resource descriptors
- structured seed handling
- witness capture and replay metadata
- scenario identity and reporting
- execution requirements contributed by simulation resources

Overkill should _not_ own:

- a mandatory `World` pattern
- predefined app-level service handles
- one official simulator implementation for all apps
- hidden monkey-patching as the default strategy
- a `withSimulation(...)` test wrapper in `@overkill-dev/test`

## Simulation Definitions, Not Built-In Worlds

The clean concept is a generic simulation definition plus resource adapters.
`@overkill-dev/simulation` owns generic simulation vocabulary, finite scenario
catalogs, and server definitions that can also be launched outside a test run.
`@overkill-dev/resources` owns the resource adapters that turn those
definitions into runner-visible descriptors.

A simulation definition declares:

- its name
- its finite scenario catalog
- any seed and replay metadata it can provide
- any manual or exploratory launch surface when relevant

Illustrative shape:

```ts
type SimulationDefinition<Scenarios extends string> = {
    readonly name: string;
    readonly scenarios: Readonly<Record<Scenarios, SimulationScenario>>;
};

type ScenarioKeyOf<Simulation> = Simulation extends SimulationDefinition<infer Scenario>
    ? Scenario
    : never;
```

This keeps Overkill DI-agnostic. A simulator may be:

- in-process with injected handles
- a spawned local HTTP service
- a worker-hosted state machine
- a browser or multi-process harness

Overkill only needs enough metadata for resource adapters, typed scenario
bindings, reporting, and replay.

## Scenarios As First-Class Presets

Many deterministic systems benefit from named **scenarios**: stable, speaking
presets of multiple simulation options.

Examples:

- `default`
- `error`
- `logged-in`
- `empty-basket`
- `slow-upstream`
- `payments-500`

A scenario is not just one flag. It is a reviewed preset that may bundle:

- seed defaults
- fixture data
- service behavior
- latency/fault behavior
- authentication/session state
- third-party API responses

Scenarios are valuable because they give teams a shared vocabulary for common
states and failures. They also improve artifact identity and replay:

- failing run: `checkout > uses fallback totals [scenario=payments-500]`
- witness includes both `seed` and `scenario`
- manual reproduction can launch the same scenario directly

## External Deterministic Services Are A Real Simulation Pattern

Deterministic simulation should not be limited to in-process fake clocks or
mocked modules.

A more realistic pattern is:

- spawn a local deterministic server
- point the app at it by swapping the base URL
- route real HTTP requests through that server
- choose behavior through a scenario key such as `default` or `error`

The same broad idea also applies to other protocols and service shapes:

- local WebSocket services
- deterministic queue consumers or publishers
- spawned worker or process harnesses
- protocol-specific simulators that are not HTTP at all

That model has several advantages:

- it exercises real service boundaries
- it avoids module interception
- it works well for integration and browser-style tests
- it can often be used for manual exploratory runs too

Overkill should therefore treat **simulation via deterministic local
services** as a first-class pattern, not as an edge case.

## Simulated HTTP Servers

HTTP is the first server shape Overkill should make easy, but the generic
simulation package must not become HTTP-only.

`@overkill-dev/simulation` should expose `defineSimulatedHttpServer(...)`.
Its core handler shape is fetch-style:

```ts
type SimulatedHttpHandler<Scenario extends string> = (
    request: Request,
    scenario: { readonly key: Scenario }
) => Response | Promise<Response>;
```

`@overkill-dev/resources` should expose
`createSimulatedHttpServerResource(...)`. That adapter turns the simulated
HTTP server definition into a resource descriptor. It owns `listen`, teardown,
host, port, and the exposed `baseUrl`. By default it binds to `127.0.0.1` with
`port: 0`, so the operating system assigns an unused port atomically. The
adapter can still expose URL builders for path-prefix, query, header, or
cookie scenario routing when the scenario is request-routed.

## Scenario Timing

Only runner-visible scenarios are declared in descriptors. A scenario is
runner-visible when it affects planning, cache identity, global binding,
filtering, reporting, or replay metadata.

Two scenario timing modes are in scope:

- `request-routed`: the resource can serve multiple scenarios from the same
  acquired handle. The scenario affects the exposed handle, URL builder, or
  request construction. It does not affect the resource acquisition cache key.
- `acquire`: the scenario changes startup or acquired state. The scenario is
  part of the acquisition context, disposal context, and resource acquisition
  cache key.

For `shared-per-worker` resources, acquire-time scenarios are cached per worker
and per scenario key. If an app server depends on a simulated API URL during
`acquire`, the API scenario must also be acquire-time for that graph. The
runner must not pretend a body-time scenario can reconfigure an already
acquired dependent resource.

## What A Test Might Look Like

The preferred public entry shape should be a resource-backed runtime, not a
new test primitive. In other words:

- simulation belongs in runtime/resource composition
- tests still look like ordinary tests
- runtime descriptors make runner-visible scenarios explicit before scheduling
- handles may expose body-time scenario methods when the scenario does not
  affect scheduling or acquisition

```ts
import { test } from '@overkill-dev/test';
import { withRuntime } from '@overkill-dev/test/resources';
import {
    createSimulatedHttpServerResource,
    defineRuntime
} from '@overkill-dev/resources';
import { defineSimulatedHttpServer } from '@overkill-dev/simulation';

const apiSimulation = defineSimulatedHttpServer({
    name: 'api',
    scenarios: {
        default: { title: 'default responses' },
        'payments-500': { title: 'payment service fails' }
    },
    handle(request, scenario) {
        return scenario.key === 'payments-500'
            ? Response.json({ error: 'upstream failed' }, { status: 500 })
            : Response.json({ status: 'ok' });
    }
});

const apiServer = createSimulatedHttpServerResource(apiSimulation);

const apiRuntime = defineRuntime({
    name: 'api',
    dimensions: {},
    resources: { server: apiServer },
    requirements: []
});

export const testNode = test(
    'checkout handles upstream 500s',
    withRuntime(apiRuntime.scenario({ api: 'payments-500' }), async (scope) => {
        const baseUrl = scope.runtimes.api.server.baseUrl;

        scope.assert.equal(await checkoutAgainst(baseUrl), 'fallback');
        return scope.assert.collect();
    })
);
```

Custom resource handles may also expose scenario methods that are just normal
typed handle API. The runner does not need to understand every body-time
scenario choice:

```ts
type ApiScenario = ScenarioKeyOf<typeof apiSimulation>;

type ApiServerHandle = {
    readonly baseUrl: string;
    readonly scenarioUrl: (scenario: ApiScenario, path: string) => string;
};
```

The important point is that the public shape stays:

- resource-backed runtime first
- planning-visible scenarios explicit on runtime descriptors
- non-microtest `test(...)` body inside that wrapper

That gives Overkill enough metadata to plan, report, and replay the run
without inventing a second test primitive just for simulation.

## Manual And Exploratory Simulation

Simulation should not be test-only.

If a deterministic runtime is genuinely useful, teams should also be able to
launch it manually for exploratory work:

- open the app against a deterministic local backend
- reproduce a bug from a captured seed and scenario
- inspect logs, traces, and state transitions interactively

That is another reason Overkill should not own the simulator itself. The
simulator should be usable outside the test runner; Overkill then integrates
with that runtime for automation, reporting, and replay.

## Seeds, Witnesses, And Replays

When a simulation-aware run fails, Overkill should capture structured replay
metadata when the resource provides it.

Minimum useful metadata:

- simulation name
- resource name
- scenario key
- seed
- runtime version
- simulation-specific witness payload

Not every simulator will use the same witness format. Overkill should
standardize the envelope, not the internals of every simulator.

## Execution Requirements

Simulation resources may contribute execution requirements just like other
runtime layers.

Typical needs:

- serial execution
- one worker per spawned service
- fixed ports or port-allocation coordination
- artifact directories
- longer startup or shutdown budgets

The runner should not guess these rules. The resource declares them; Overkill
resolves them alongside the rest of the run plan.

## Relationship To Capability Handles

Capability handles remain one valid implementation style for simulation, but
they are not the only one and must not be mandatory.

Possible implementations:

- DI + capability handles
- configurable service factories
- local deterministic services behind HTTP, WebSocket, or another protocol
- custom framework runtime adapters

So the right relationship is:

- capability handles are one useful simulation-friendly pattern
- simulation support in Overkill must stay broader than capability handles

## What This Catches

Even without a full virtualized universe, simulation-aware runtimes can catch
bugs that plain example tests miss:

- error-path handling against third-party APIs
- session-state and workflow bugs
- timing-sensitive logic around retries or deadlines
- randomness-dependent behavior
- failures that only show up when several runtime knobs move together

The scenario concept is especially useful here because many real teams do not
need infinite random universes first. They need a small, explicit library of
reproducible operational situations.

## Reasonable Scope

The concept should stay ambitious but grounded.

Strong near-term direction:

1. simulation definitions and resource adapters
2. scenario-aware artifact identity and reporting
3. seed/witness/replay envelope
4. support for local deterministic services and base-URL swapping
5. resource-backed runtime authoring for both in-process and local-service
   simulation
