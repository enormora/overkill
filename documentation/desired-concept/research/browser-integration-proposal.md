# Unified Browser Integration Proposal

## Status And Scope

Research notes from the browser product discussion, 2026-11-11. Canonical
concept documents define the public contracts; this file preserves alternatives
and rationale. The [landscape](./browser-testing-landscape.md) records prior art
and agreed product boundaries.

Browser execution, app automation, continuous app checks, simulation, and
performance share ordinary Overkill authoring and lifecycle contracts.

Breaking changes are permitted. Prefer changes that remove duplication or
make evidence accurate. Node-specific implementation restrictions are not
product requirements merely because they already exist.

## Shared Model And Required Changes

Keep `test`, `suite`, tables/macros, `benchmark`, `workload`, `withResource`,
`withResources`, `withRuntime`, runtime matrices, case/work/attempt identity,
assertions, results, artifacts, baselines, profiles, selection, and reporting.
No browser test family, alternate assertion system, browser-specific hooks,
second scenario system, or second benchmark engine is proposed.

| Concern                       | Existing owner                                        | Proposed extension                                                |
| ----------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------- |
| Browser execution             | Engine bodies and runner placement                    | Browser-compatible dependencies and placement adapter             |
| Browser/server/build lifetime | Resources and runtime graphs                          | Factories with explicit owner and consumer realms                 |
| Continuous app expectations   | Attempt lifecycle, checks, runtime policies           | Resource-owned observations and durable outcomes                  |
| Startup/scenarios             | Simulation definitions and resource bindings          | Optional HTML/configuration assembly with ordinary app assets     |
| Performance                   | Workloads, strategies, collectors, lifecycle, budgets | Runtime-aware clocks/collectors and semantic provenance           |
| Evidence                      | Transcripts, attachments, failure preparation         | Browser signals and finalization through supported closure events |

The engine does not interpret locators, DOM APIs, CDP, BiDi, axe, or Lighthouse.
Adapters own that interpretation. Runner placement owns imports, collection,
dispatch, cancellation, and transport. Resources cannot replace scheduling.

Three reusable extensions are justified: execution-realm compatibility,
resource-owned observations, and runtime-aware measurements. Process-output
and service-transcript checks also benefit from resource observations. Avoid
a universal policy DSL, event-processing framework, or new DI container.

Observed implementation gaps:

- Engine/resource observation uses Node `AsyncLocalStorage`; browser execution
  needs platform-specific dependencies behind the shared semantics.
- Resource wrappers import runner lifecycle machinery; descriptor serialization
  alone does not make their import graph browser-compatible.
- Resource acquisition/disposal, projections, scenarios, and failure collectors
  exist, but there is no durable asynchronous resource-check sink.
- Body assertion plans, requirement short-circuiting, and builder-return checks
  make that recorder unsuitable for asynchronous observer findings.
- `measurement-region.ts` uses Node timing and `node:util`; benchmark GC and
  cooldown are Node-oriented. Strategy unions are closed and collector start/
  stop are synchronous even for asynchronous preparation/completion.
- Metric provenance only contains collector/unit/coarse scope, insufficient
  for different browser targets, endpoints, and measurement methods.

## Browser Placements And Collection

### Browser-executed

Only integration and benchmark bodies use browser execution. Microtest/property
bodies never run in a browser runtime, even if they appear pure or provisioning
is external. Both browser modes can use host-owned collectors. The canonical
placement contract is in [Runtime Behavior](../architecture/runtime-behavior.md#browser-execution-and-placement).

D09 selects one host-loadable, browser-free logical catalogue by default, with
one collection browser available through explicit opt-in configuration. In the
default mode definitions/static imports must load without DOM/browser APIs.
Browser-only imports occur in executing bodies, where their module initialization
may use browser APIs normally. Host collection does not invoke that path.
Browser execution never serializes callback closures.

Expand runtime/browser/workload variants as planning metadata before final
runtime filtering, sharding, and placement. A browser matrix does not require
browser sessions during collection, nor simultaneous browser execution.
Scheduling controls later launch/concurrency/reuse. During execution, load the
definitions in the selected browser and validate the frozen catalogue/selected
identities before invoking bodies. Browser-only import failures may surface
later during browser preparation or execution.

Recommend the same deterministic logical catalogue in every realm/variant.
No case enumeration from DOM, current browser capabilities, network, clock, or
environment-dependent definition branches. Unsupported browser capabilities
produce explicit compatibility/skip/error outcomes rather than removing cases.
D22 covers this logical-catalogue contract; fine-grained skip semantics remain open.

Portable resource declarations must not statically import host-only factories
or browser-only implementations. Separate descriptor metadata from explicitly
referenced owner/consumer modules so `withRuntime` retains one definition rather
than duplicated test declarations. Existing inline Node-bearing resource imports
are not automatically portable; this may require a shared resource API change.
Do not promise that hiding a Node import inside an unused callback makes every
bundler accept it. D11/D21 must specify references, resolution, and type inference.

Default collection avoids the earlier bootstrap cycle: it reads declarations first;
selected execution then acquires browser/module-server/app resources through
the declared placement and dependency graph. Collection failures are setup
errors, not failures of a fabricated active test. The explicit browser opt-in
still needs its collection browser/module-server bootstrap declared before
browser-dependent definitions can be read.

Explicit opt-in: one designated browser collects a canonical catalogue, permitting
top-level browser imports but starting a browser for listing. Per-variant live
collection is needed only if variant-specific catalogues are intentionally
supported. Per-variant live collection is not the selected collection model.

Overkill owns the harness server and browser communication channel through a
first-party replaceable integration using existing transformation/server tooling.
Deliver the test's browser-loadable import graph/bootstrap as transformed ESM
or generated bundles. No application or prebuilt app is required: tests import
their dependencies, which may include application modules. Additional app
builds/servers are optional resources, not browser-execution prerequisites.
Preserve assets, project module
resolution, source maps, CSP/origin constraints, and version invalidation.
Native-input assistance uses a bounded adapter channel tied to the target,
session, and attempt, not a proxy of the whole host controller object.

### Host-driven Browser Automation

Ordinary integration bodies consume provider-native controller handles through
explicitly named integrations, as selected in D24. Overkill owns lifecycle,
guards, checks, measurements, results, and artifacts rather than a universal
locator/action DSL. Shared checks consume supported native targets via adapters.

Recommend Playwright initially. Evaluate its supported BiDi paths before adding
another client; a separate integration is justified by demonstrated capability
or endpoint gaps, not assumed necessary. Declare actual browser/controller/protocol versions and
individual capabilities for input, contexts, frames/popups, workers, interception,
event coverage, traces, screenshots, and advanced measurements.

Current upstream development source includes BiDi implementations and dedicated
tests. Firefox launch delegates selected `moz-` channels to its BiDi backend;
the Chromium BiDi path uses a CDP bridge. See the
[Firefox implementation](https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/server/firefox/firefox.ts),
[Chromium BiDi implementation](https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/server/bidi/bidiChromium.ts),
and [upstream BiDi tests](https://github.com/microsoft/playwright/blob/main/.github/workflows/tests_bidi.yml).
This source review does not establish the supported public API of a selected
release or attachment to arbitrary remote BiDi endpoints. Validate those exact
paths before promising them; do not depend on private imports or patches.

### Public API Boundary

D24 selects explicitly provider-native action/locator APIs. Overkill owns the
surrounding test contracts. The alternatives below explain that boundary;
a controller-independent action API is not the selected design.

| Design                              | Public promise                                                                               | Consequence                                                                          |
| ----------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Explicit native-client integrations | Each exposes its named client's API and behavior, such as Playwright or a BiDi client        | Native handles are appropriate; changing client can require test changes             |
| Controller-independent automation   | Overkill owns the public page/locator/action contract                                        | Wrap adapters; define waiting, input, navigation, error, and compatibility semantics |
| Split by use case                   | Hide launcher details for browser-local tests; use explicit integrations for host automation | Browser-local test portability does not imply portable host-controller code          |

Illustrative native integration body:

```ts
const page = scope.runtimes.browser.page;
await page.getByRole('button', { name: 'Pay' }).click();
await scope.assert(playwrightVisible, page.getByRole('alert'));
return scope.assert.collect();
```

The runtime and imported assertion deliberately belong to a Playwright
integration. Existing client behavior remains part of the contract.

A common page wrapper would require Overkill to specify locator strictness,
readiness/retry rules, navigation and popup races, frames/shadow DOM, timeouts,
focus/input behavior, errors, and compatibility across providers. Native APIs
retain those semantics with their existing provider rather than duplicating
that contract in Overkill.

Browser-executed tests can use DOM values and shared assertions independently
of the launcher. Their native-input bridge still needs an explicit public
contract for target identity, readiness, frames, navigation, and cancellation.
A small bridge is not semantically free. Provider/browser capabilities and
measurement support remain qualified even when test source stays unchanged.

Resources, guards, scenarios, metric results, and artifacts can be shared in
either design. A common page wrapper alone does not establish network isolation
or solve cache/service-worker enforcement. Native handles do not establish
portable assertion or waiting semantics merely because results look alike.

D24 establishes native APIs without cross-controller source compatibility.
Native provider identity must be prominent. Public packaging and the bounded
browser-local input contract still need concrete design.

### Remote Sessions

Control connection, app/asset/API reachability, and Overkill result transport
are separate checks. Advertise browser-reachable URLs, not bind addresses.
Reuse provider tunnels and networking infrastructure.

Fence commands/events by run, assignment, session, target/document, work, and
attempt where applicable. Reject stale/duplicate completion and catalog drift.
Reconnection does not authorize replay of side-effecting actions. Lost required
evidence leaves affected work incomplete and the run unsuccessful.

## Resources, Isolation, And Authoring

Recommend reusable browser-process resources and fresh context/session resources
per integration attempt. Pages/popups/workers belong to the session. Shared
immutable app assets need not be rebuilt, while mutable app/simulation state
follows declared scope. Retries have fresh sessions, expectations, and ledgers.

JSON projections may carry configuration or explicit remote references.
Separate host-owner modules from browser-consumer modules. Reject unsupported
cross-realm handles before execution; do not serialize functions or native
controller objects. Existing scopes retain their meanings across placements.

Illustrative authoring, not final adapter API:

```ts
export const testNode = suite('checkout', [
    test(
        'shows declined-payment recovery',
        withRuntime(
            checkoutRuntime.scenario({ payments: 'declined' }),
            async (scope) => {
                const { page } = scope.runtimes.browser;
                await page.goto(scope.runtimes.app.url);
                await page.getByRole('button', { name: 'Pay' }).click();
                await scope.assert(
                    visible,
                    page.getByRole('alert', { name: 'Payment declined' })
                );
                return scope.assert.collect();
            }
        )
    )
]);
```

`checkoutRuntime` is consumer composition; `visible` is a proposed imported
async assertion reference using existing assertion results and explicit
timeout/cancellation. No global `expect` or per-test listener boilerplate is
needed. Guards are declared on resource/runtime composition. Browser-local
bodies use the same constructors with compatible consumer values.

## Resource-Owned Observations

### General Contract

The canonical [Resource-Owned Checks And Observers](../architecture/package-architecture.md#resource-owned-checks-and-observers)
contract uses `withResourceChecks(resource, observer)`, composing like
`withFailureArtifacts`. It declares an observer, not browser-specific test hooks.

Observer implementations follow the same realm rules as D11 resources: reference
implementation modules for cross-realm execution; inline callbacks are limited
to compatible same-realm execution. Never serialize observer closures.

| Operation                  | Contract                                                                                      |
| -------------------------- | --------------------------------------------------------------------------------------------- |
| Install                    | After resource acquisition, before dependent acquisition or consumer admission                |
| Report check               | Durably record an authored resource expectation result                                        |
| Report observation failure | Preserve inability to observe/enforce as infrastructure evidence                              |
| Request stop               | Record cause first, then request cancellation and bounded retirement                          |
| Prepare live evidence      | Capture data requiring live handles before disposal                                           |
| Finalize                   | Close the interval, drain supported delivery, check missing expectations, freeze completeness |
| Dispose observer           | Release listener/infrastructure ownership exactly once                                        |

A post-acquisition observer cannot observe earlier acquisition effects. Browser
factories must create an unstarted context/session, install guards, then create
pages and invoke app startup. This is not retroactive protection for arbitrary
resource acquisition.

Adapters must implement allocation/start separation where available; launch,
persistent-profile, or connected-session modes may already contain active pages
and workers. Reject strict startup coverage for those modes unless an earlier
supported enforcement boundary already exists. An unstarted context is a
required property of the chosen factory, not an assumption about every client.

Use a durable ledger independent of resettable transcripts and body assertion
bookkeeping. Failed requirements, caught controller errors, early returns,
interruptions, and transcript resets cannot erase findings. Resource checks
must not alter authored assertion-plan counts or silently satisfy a required
authored assertion. Reuse check formatting/evaluation, not body recorder state.
Passing checks produce bounded summaries rather than an assertion per event.

Bind observations explicitly to attempt/lifetime ownership. A protocol callback's
host async context does not identify the source browser activity. Shared output
without causal attribution stays shared/run evidence. Late previous-attempt
events retain their source identity or become attribution-drift evidence; never
attach them to whichever sibling is active.

### Attempt Completion

The sequence below applies to fresh attempt-owned browser sessions. Shared
browser/server resources remain alive until their declared boundary ends.
Partition their causally attributable attempt ledgers from the resource-lifetime
ledger. Finalize an attempt's slice before its verdict without prematurely
closing the shared owner. Unattributed lifetime findings remain run evidence.

1. Validate policy/capabilities and acquire the empty session.
2. Install observations/interception before pages and application activity.
3. Execute the body while retaining findings continuously.
4. On fail-fast, stop new authored work and request bounded cancellation.
5. Run consumer cleanup; prepare provisional evidence needing live handles.
6. Dispose pages/context while observing their supported closure activity.
7. Drain the adapter's documented delivery/fence contract and finalize checks.
8. Preserve cleanup/transport/capture errors alongside earlier findings.
9. Promote evidence and publish the final attempt result once.

Stopping admission/author actions is separate from the observer's teardown
deadline. Aborting the test signal must not detach listeners before close-time
checks. Finalization and disposal use a fresh bounded cleanup signal. Hard
retirement needs an owner responsive outside the blocked browser/body thread;
in-process execution cannot promise preemption of an arbitrary synchronous loop.

No successful verdict precedes required observation finalization. Live capture
and final event evidence are distinct phases. If an adapter cannot establish
required lifetime coverage, report the gap instead of complete observation.
Direct resource sessions must also finalize and return or raise their explicit
findings; they cannot depend on CLI-only wrapping or silently discard checks.

Observer lifetime spans observed-resource disposal and ends after finalization;
the observer is disposed afterward. This extends the current lifecycle contract,
not merely an implementation of a resource's existing `dispose` callback.
Attempt-owned checks/evidence finalize before retry eligibility is chosen.
Logical-case/shared-resource cleanup keeps its separate boundary and errors.

D23 specifies direct API delivery: engine execution returns findings in the
ordinary run result and managed resource sessions feed that result. Closing a
standalone session with failed guards throws a structured failure retaining
findings and other errors. Do not throw asynchronously from event callbacks.
The exact findings-inspection API remains implementation-design work.

### Result Semantics Resolved By D02

| Event                                                               | Result domain                                                                |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Authored app expectation violated, including unexpected app warning | Failed resource check in the ordinary attempt outcome                        |
| Intentionally expected denied request                               | Passing predeclared bounded expectation under D33; operation remains blocked |
| Required observer/enforcer unavailable or loses evidence            | Infrastructure error and incomplete affected verification                    |
| Runner execution restriction violated                               | Existing permission/runtime-policy runner error                              |
| Resource/observer cleanup or artifact delivery fails                | Existing infrastructure/artifact error alongside original outcome            |

Strict runner-console violations retain their runtime-policy domain. Authored
app/resource expectations use failed resource checks, as resolved in D02.
Do not silently change retry eligibility through a new failure label.

## Browser App Guards

### Standard Preset Enabled By Default

| Signal                                 | Proposed behavior                                                                          | Narrow customization                                          |
| -------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| Outbound app request                   | Allow loopback destinations; prevent/report other destinations without explicit permission | Explicit permitted integrations or independent egress control |
| App console warning/error              | Fail the app expectation with original message/source/target                               | Typed matchers, exclusions, bounded expected diagnostics      |
| Unhandled app exception/rejection      | Retain attributed failure and native details                                               | Expected negative-path windows                                |
| Request failure/unexpected HTTP status | Opt-in expectation; intended 4xx/5xx are not automatically violations                      | Method/route/status/scenario matching                         |
| Dialog/popup/download/permission       | Observe; opt-in checks and handling policy                                                 | Explicit app expectations                                     |
| Hydration diagnostics                  | Catch console/error signals first                                                          | Optional framework/version-specific adapters                  |
| Dependency escape                      | Record requests beyond declared app/service boundaries                                     | Simulator/controller evidence                                 |

This is a visible resource/runtime preset, enabled by default on first-party
app/browser-session resources as resolved in D04/D25, not ambient global
interception or a mandatory capability of a bare browser execution host. It
also applies when those guarded resources are used by benchmarks. Real external integrations
remain possible when declared by project policy. Normalize adapter console
level names while retaining original values. Do not pretend every framework
or build mode exposes a universal hydration-mismatch event.

### Prevention And Fail-Fast Guarantees

Keep detection, prevention, fail-fast, and hard retirement distinct. A request
event may arrive after transmission. Throwing from an event callback does not
reliably stop the test. Record first; signal cancellation; then retire the
owned session/executor when needed. A caught navigation error cannot undo it.

Distinguish adapter-mediated prevention under supported configurations from
independent egress control supplied by a provider/proxy/environment. Recommend
offering both with explicit boundaries, not claiming equivalence. Required
unsupported guarantees fail admission; observation-only is never a silent
fallback. Native client access is not a security sandbox against malicious
test code. App traffic policies also do not cover arbitrary Node test traffic,
backend egress, browser telemetry, or other machine processes.

Playwright page routes override context routes; service-worker-handled traffic
is outside context-route coverage; routing disables HTTP cache; WebSockets
need separately installed routing before socket creation. See
[HTTP routing](https://playwright.dev/docs/api/class-browsercontext#browser-context-route)
and [WebSocket routing](https://playwright.dev/docs/api/class-browsercontext#browser-context-route-web-socket).

Current upstream Playwright BiDi interception also sets HTTP cache behavior to
`bypass` and does not offer interception on every redirect hop. Switching the
protocol name does not establish the required guard capabilities. See its
[BiDi network implementation](https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/server/bidi/bidiNetworkManager.ts).
These are development-source findings, not a pinned-release support promise.

Page routing documents first-URL-only redirect handling; `route.fetch` follows
redirects by default. Do not infer per-hop prevention from a generic route
handler. Validate the chosen context/proxy/client path explicitly and reject
mock-fetch behavior that escapes authorization. See [page routing](https://playwright.dev/docs/api/class-page#page-route)
and [route fetching](https://playwright.dev/docs/api/class-route#route-fetch).

Compose supported mocking through one adapter routing owner. Competing direct
native route mutation is incompatible with that guarantee; detect it where
possible, without claiming non-bypassability. Reject unsupported service-worker
combinations rather than silently disabling app behavior. Cache-sensitive
benchmarks must not acquire intercepting routes that silently change caching.

An attributable session proxy/provider enforcement resource is a candidate
boundary independent of native routing. Reuse an existing implementation;
do not build another proxy framework. Opaque HTTPS CONNECT can enforce
destination permissions but not encrypted paths/methods. TLS inspection needs
explicit trust configuration and must reject denied destinations before any
upstream certificate lookup/contact. A proxy also cannot observe cache/SW-only
attempts, so it does not alone satisfy D26. No backend is considered validated
until cache, workers, redirects, loopback, cleanup, and session attribution have
been demonstrated against actual receiving endpoints.

### Coverage, Matchers, And Composition

Declare coverage individually for navigation/redirects, scripts/styles/images,
fetch/XHR, forms, preloads, beacons/keepalive, EventSource, frames/popups,
workers/service workers, and WebSockets. Other transports such as WebRTC or
WebTransport need explicit support. Authorize every redirect destination.
Session-level prevention must cover popup initial requests before exposure.
An adapter unable to pause a required hop cannot claim that capability.

Recommend parsed URL/serializable standard `URLPattern` components where
suitable, with explicit method/resource-type constraints. Origin equality
includes scheme/hostname/port. D05 selects all loopback destinations on any port
as the default allowance. Match canonical localhost/loopback hosts and addresses,
not raw URL prefixes. Other destinations require explicit permissions. Remote
loopback is evaluated in the browser environment unless a provider tunnel
explicitly remaps it; remote app origins need corresponding grants.

Explicit allow rules may refer to declared resource endpoint roles before concrete ports
exist. Validate their structure during planning, then resolve exact advertised
origins after acquisition and before any guarded page is admitted. Freeze the
binding for that session. Persist logical resource/role identity separately
from ephemeral addresses; unresolved references never grant broad access.

Recommended matching semantics:

- Fields within one matcher are AND; entries in a matcher list are OR.
- Authorization uses positive allowed destinations within project permissions;
  explicit deny wins and independent policies intersect.
- Nested composition cannot silently widen permissions.
- Observation exclusions only affect their named check/evidence, never request
  authorization. Console exclusions do not disable unrelated browser rules.
- Console matchers can use normalized level, text, source URL, and supported
  target identity. Preserve unmatched findings and matching rule identity.
- Avoid undocumented glob precedence/stateful regular expressions. Callable
  local predicates need a supported import/bootstrap for remote execution;
  do not serialize functions into frozen facts.

Authorize against original data, then redact sensitive URLs/headers/bodies
before persistence. Harness/control connections have separate declared roles,
not an application-wide allowlist. Bound retained evidence and report total
violations/truncation; evidence limits cannot erase the failing verdict.

Console capture defaults to bounded native text/location/previews. Expanding
every logged object remotely may be costly or impossible after target closure;
avoid evaluating arbitrary getters merely to format a diagnostic. Preserve
collection failures and preview completeness without losing the check outcome.

### Intentional Negative Paths

Provide typed, bounded expected-event windows on the resource handle, registered
before the action and finalized inside normal test lifetime. The exact API is
open. Each has matcher, target/attempt scope, count bounds, lifetime/deadline,
and a reason. Missing required events and extra events fail. No retroactive
forgiveness or state leakage into retries/samples.

Recognize an in-window expected event at occurrence, reserving it instead of
first recording an irreversible unexpected-event failure. Exceeding the maximum
fails immediately; missing the minimum fails at close. One event cannot silently
satisfy multiple expectations. Reject ambiguous overlapping consumption unless
an explicit resolution rule is selected in D06.

Benchmark observations/windows also carry the existing warmup/measured phase
and invocation index beneath their attempt identity. Bind target/session events
to that invocation where causally supported. Delayed unassignable events remain
lifetime evidence and invalidate affected verification; never assign them to
the currently active sample or silently discard contaminated samples.

Expecting a denied analytics call does not authorize contacting analytics.
Permissions are resolved before admission. Link downstream request-failed and
console messages causally to blocked requests so raw evidence remains useful
without unexplained duplicate failures. Intentional API failure scenarios must
not require ignoring every warning/error or every failed request.

## Simulation, App Builds, And HTML Hosts

Reuse simulation definitions/catalogs, acquire/request-routed bindings,
resources, transcripts, and witnesses. Add optional HTML-host assembly with
explicit consumer markup, asset references, startup invocation/data, correct
HTML/script encoding, and a CSP-compatible external config/module alternative.
Existing SSR/template systems may supply the entire document. Do not prescribe
framework, root element, template language, or entry-point name.

For `window.startApp(config)`, resolve scenario server-side and let consumer
code map it to ordinary app configuration. Reuse the normal application bundle
where possible; dedicated deterministic composition roots remain consumer
options. Application code need not import Overkill.

Compose build commands/APIs, dev servers, or prebuilt assets as resources.
Share immutable artifacts while isolating mutable session state. Freeze the
exercised asset/module version; changes require invalidation/recollection.
App-page query parameters do not propagate automatically to fetch, assets,
navigation, workers, or sockets. Use explicit construction, defined session/path
routing, or fixed-scenario servers; no global mutable scenario switch. Existing
query-based `scenarioUrl` is not automatic app routing.

Record logical configuration, scenario, simulation seed/version, build identity,
and environment. Temporary ports/session credentials are not stable identity.
A seed and deterministic server do not control all browser scheduling.

## Browser Benchmarks Through The Existing Model

### Authoring And Resource Lifetime

Body placement, measured target, and collector owner are independent as resolved
in D34. A browser body can be observed by a host DevTools/BiDi collector; a host
body can request an explicitly browser-local timed operation. Mixed placements
may share one benchmark suite/file if their module graphs are compatible.
See [Body Placement And Collector Capabilities](../authoring/benchmarking.md#body-placement-and-collector-capabilities)
for the canonical authoring, admission, sampling, and comparison contract.

Keep `benchmark`, `workload`, resource/runtime wrappers, measurement strategies,
`sample.measure`, `sample.cleanup`, warmup, sampling, budgets, timelines,
baselines, and reporters. Browser packages consume common browser provisioning;
they do not own another browser lifecycle or sampling engine.

Browser functions execute/time locally in the actual page realm. Authored tests
and benchmarks can create workers and measure explicit boundaries, including
startup-to-result or computation-only intervals. This does not introduce a
dedicated worker placement. Worker-local timestamps require compatible clocks
or explicit conversion rather than subtracting unrelated realm timestamps.
Host journeys use native controllers and explicitly identified host/browser
measurements. Host timing of `page.evaluate` includes protocol/serialization;
it is not function-runtime evidence.

Resources currently wrap the sampling session. Per-invocation preparation and
reset can use handle operations plus existing `sample.cleanup` outside the
region. `per-case` must not silently mean `per-sample`. Add declarative nested
sample resources only if repeated integration evidence justifies extending the
shared resource/benchmark contract.

Illustrative use of the ordinary facade:

```ts
benchmark('checkout response', {
    kind: 'responsiveness',
    workloads: [ workload('declined', { cartItems: 3 }) ],
    measurement: rawMeasurement(checkoutMeasurement),
    measure: withRuntime(checkoutRuntime.scenario({ payments: 'declined' }), async (context) => {
        const page = await context.runtimes.browser.context.newPage();
        context.sample.cleanup(() => page.close());
        await page.goto(context.runtimes.app.url);
        await page.getByRole('button', { name: 'Pay' }).waitFor();
        const result = await context.sample.measure(async () => {
            await page.getByRole('button', { name: 'Pay' }).click();
            await page.getByRole('alert', { name: 'Payment declined' }).waitFor();
        });
        return { durationMicroseconds: result.metrics.durationMicroseconds };
    }),
    diagnosticMetrics: [],
    budgets: {
        declined: { durationMicroseconds: { maximum: 500000 } }
    }
});
```

`checkoutMeasurement` is a proposed strategy; `rawMeasurement` is existing
shared benchmark authoring. Here the duration is explicitly
host-command-to-DOM-condition, not native input-to-paint. A browser-local
strategy uses the same facade with differently identified metrics. A fresh
page does not reset context/backend state; this example alone cannot promise
cold or independent samples. The workload declares and establishes its reset.

### Measurement Endpoints

| Metric                      | Start/end contract                                                  | Important distinction                                            |
| --------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Browser function duration   | Same-realm invocation to return/awaited completion                  | Excludes result transport                                        |
| Controller command duration | Host command start to controller completion                         | Includes IPC, actionability/waiting, remote latency              |
| Native input timing         | Correlated browser input to supported Event Timing endpoint         | Not necessarily final asynchronous app result                    |
| Action-to-authored-effect   | Explicit input/marker or labelled command to app mark/DOM predicate | State evidence; rendering strength depends on endpoint           |
| Rendering evidence          | Supported marker/window to engine frame/trace endpoint              | Backend-specific; not automatically physical display observation |
| Navigation timing           | Document/navigation origin to defined FP/FCP/LCP endpoint           | Not automatically a fresh metric for SPA updates                 |

Arm observers before input. Endpoints must transition or be correlated to the
action, not already be true. Define timeout and cancellation. Network-idle is
not universal readiness for polling/streaming apps. Stop target timestamps
before metric delivery; do not charge transport delay to browser-local spans.

Use same-clock endpoints where possible. Record realm/document/worker,
clock domain/origin/resolution, conversion and uncertainty. Never subtract
Node, protocol, page, or worker timestamps without supported conversion.
Navigation invalidates old document observers and clocks.

DOM visibility/rAF callbacks do not prove intended pixels were presented.
A click can paint a spinner immediately while final results arrive much later.
Keep input responsiveness and authored-effect latency separate. See
[Event Timing](https://www.w3.org/TR/event-timing/).

### Metric Catalog

| Family             | Useful metrics                                                         | Required limitations/provenance                                 |
| ------------------ | ---------------------------------------------------------------------- | --------------------------------------------------------------- |
| Function/action    | Local execution, command span, effect span                             | Endpoints, clocks, IPC/wait inclusion                           |
| Native input       | Input delay, processing, event interaction duration                    | Correlation, thresholds, rounding, omitted short events         |
| Main-thread health | Long tasks, long animation frames                                      | Thresholded diagnostics, not every dropped frame                |
| Callback pacing    | rAF interval distribution                                              | Visible/active document; not compositor/display frame truth     |
| Rendering          | Style/layout/paint/composite time, supported frame evidence            | Engine/trace schema, target, observation window                 |
| CSS animations     | Completion/duration/cancellation; supported frame quality              | Completion and compositor smoothness differ                     |
| Scroll             | Displacement, endpoint latency, supported frame evidence               | Native input/path; compositor versus main thread                |
| Navigation         | FP/FCP, defined LCP, navigation phases                                 | Document identity and endpoint finalization                     |
| Requests           | Started/completed/failed counts, bytes, cache behavior before endpoint | Accounting scope/source and completeness                        |
| Memory             | JS heap, page estimate, process RSS, sampled peak, allocations         | Distinct quantities, owners and methods                         |
| CPU                | Main-thread, worker evidence, renderer/browser process CPU             | Shared-process attribution limits                               |
| Audits             | Lighthouse findings and selected numeric observations                  | Scores/findings are not universal timing or field-user evidence |

Do not hard-code 16.67 ms as universal frame time. Record refresh assumptions,
variable-refresh limitations, active/foreground state, headed/headless mode,
GPU/renderer, viewport/scale, preferences, and input mode. Compositor animation
may remain smooth during a main-thread stall. rAF stalls do not prove compositor
frame loss. [Long Animation Frames](https://www.w3.org/TR/long-animation-frames/)
has thresholded evidence, not an all-frame presentation guarantee.

First Meaningful Paint is not a proposed standard metric. Its Lighthouse audit
is retired; use current named metrics or authored completion endpoints. See
[Lighthouse FMP](https://developer.chrome.com/docs/lighthouse/performance/first-meaningful-paint).

Request count before FCP/app mark must distinguish starts from completions,
document/frame/worker scope, redirects, failures, cache/SW behavior, sockets,
buffer overflow, and cross-origin visibility. Resource Timing entry counts are
not automatically HTTP request counts; see [Resource Timing](https://www.w3.org/TR/resource-timing/).
Do not silently merge controller counts and browser entries under one name.

Node coordinator CPU/memory remain harness diagnostics. Browser, renderer,
page, and worker values need distinct scopes. Endpoint delta is not peak or
allocation rate. Shared renderer CPU is not precise worker CPU. Do not inject
isolation headers or force GC to obtain metrics without declaring that change.

### Measurement Contract Changes

Supply clocks/context/cooldown/GC through runtime capabilities, preserving
sample/results across direct and runner-managed execution. Extend the shared
strategy contract rather than adding browser-only sampling. Permit async
collector readiness/finalization and acknowledged target markers when exact
window boundaries are claimed. A protocol callback time is not that endpoint.

Separate stable comparison identity from per-observation facts and quality:

- Comparison identity: semantic/algorithm version, target scope, endpoint/clock
  method, thresholds, sampling method, material collector/runtime versions,
  environment/reset/cache policy, and instrumentation definition.
- Run/sample facts: concrete document/worker/process/session identities,
  observed environment and timestamps.
- Quality evidence: availability, completeness, truncation, attribution
  confidence, clock-conversion uncertainty, and missing-data reasons.

Quality may vary between samples without changing what metric is being measured.
Do not put concrete target IDs or changing availability into baseline keys.
Validate material semantic identity before comparing numeric readings, then
evaluate quality without hiding missing observations.

Reuse available/unavailable metrics and budget outcomes. Knowably absent
required capabilities fail preflight. Missing evidence during execution leaves
gated budgets unavailable/incomplete and the run unsuccessful. Never substitute
zero, drop missing samples, or silently switch to another metric/backend.
One-shot functional timeouts are not repeated benchmark distributions. Direct
one-shot use can share measurement library/results without claiming precision.

### State, Sampling, And Instrumentation

Cold/warm dimensions are independent: browser process/profile, context/storage,
document, HTTP/SW caches, server state, JIT, network and OS caches. A fresh page
is not a cold browser. Every sample satisfies its declared reset; cold warmup
uses throwaway equivalent boundaries or is disabled explicitly. Failed reset
stops sampling, rather than collecting contaminated observations.

Keep preparation/readiness/reset/evidence upload outside the measured region
unless explicitly part of the workload. Use existing shared sampling/precision
machinery; browser-friendly presets may change counts without introducing
another statistical model. Changing app state needs a defensible sampling unit.
Repetitions within a region are not automatically independent samples. A p95
across sample p95s is not the p95 across all interactions.

Use appropriate scheduling isolation and record device contention. Remote
shared devices cannot promise controlled local CPU/rendering behavior. Generic
CPU calibration cannot normalize paint/jank/memory without a validated model.

Isolation applies to the measured browser/device owner, including competing
sessions sharing its renderer/GPU and remote assignments, not only the local
Overkill worker count. Keep conservative serialization until that owner can
establish the required isolation. Local host calibration cannot prove remote
device availability.

Default normalization must follow measurement semantics and execution target,
not names such as `durationMicroseconds`. The current name-based Node CPU
normalization must change. Browser/journey strategies default to raw readings
unless an explicit validated calibration model is selected.

Recommend lightweight collection by default. Trace/video/profiling/heap capture
can perturb runs; measured heavy instrumentation is a separately identified
variant. Diagnostic reruns remain separate attempts and do not replace original
failed samples or prove unobserved details of them.

Prevention that disables HTTP cache changes benchmark semantics. Cache-sensitive
work needs compatible prevention/independent isolation or explicit user-selected
observation-only policy. Never weaken protection or mislabel results silently.

## Other Capabilities And Product Boundaries

Accessibility, visual/layout, document semantics and SEO remain imported
assertions/adapters, resources, matrices, transcripts, and baseline operations,
not extra families. Accessible journeys combine native input/focus checks,
scanners/preferences and optional named screen-reader platforms. Actual zoom,
resizing, accessibility trees, and speech are different evidence.

Visual updates do not waive network/console guards. Declare readiness/masks/
thresholds/environment. Source HTML, rendered DOM, external/generated CSS,
ARIA, structured-data syntax/vocabulary, and app factual consistency retain
separate provenance. SEO findings do not guarantee indexing or ranking.

Overkill owns lifecycle/identity/semantics/evidence/budgets/reporting. Reuse
controllers, protocol clients, build/server tools, comparators, scanners,
validators, measurement tools, and viewers. No competing browser engine or
universal locator API is proposed.

Keep no-first-party-component-testing guidance; allow consumer rendering and
JSX/TSX setup. Initial scope excludes native mobile/desktop products, hosted
clouds, general builds/SSR, no-code/BDD languages, recorders, autonomous test
harvesting, and a custom trace IDE. These are scope choices, not universal
judgments about those tools. No silent healing of expectations/selectors/
baselines or app-global monkey-patching to fabricate determinism.

Preserve manual simulator use; controller-free capture is deferred. Workers
remain authored workload dependencies, without dedicated execution placement.
First-party extension provisioning/lifecycle is selected; its browser/profile
matrix remains open. Standalone static/offline test export is explicitly rejected.
Optional first-party screen-reader support is selected;
its validated platform matrix remains to be specified. The selected helper
groups are now defined in the canonical audit catalog under D19D.

## Acceptance Scenarios

1. Default listing and matrix expansion launch no browser. Default collection
   rejects imports requiring browser APIs; the explicit single-browser opt-in
   collects those modules without Node executing their browser-only graph.
2. Both placements retain ordinary authoring, exact selection, scenario/workload
   identity and direct/runner API parity.
3. Supported denied analytics requests never dispatch; findings survive caught
   action errors and trigger bounded fail-fast.
4. An allowed app redirect to production is independently denied.
5. Popup/worker startup is guarded before exposure or unsupported coverage fails
   before app startup.
6. Cache-sensitive work rejects incompatible routing without silently disabling
   caches, service workers, or requested protection.
7. Expected denied analytics stays denied; missing/extra warnings fail bounded
   expectations, without broad global exceptions.
8. Supported cleanup-time beacons/warnings are retained; failed finalization
   cannot publish a passing attempt.
9. Late/shared events cannot contaminate a sibling or retry.
10. Resource checks survive failed requirements, plans, builder returns,
    transcript reset, interruption, and early return.
11. Concurrent scenarios reuse one app artifact without mutable-state leakage;
    startup config safely encodes script delimiter content.
12. Remote app/assets/APIs/channels are reachable with declared policy coverage.
13. Browser-local function timing excludes return transport latency.
14. Spinner response and delayed final result retain distinct measured endpoints.
15. Smooth compositor animation during a main-thread stall does not become a
    false compositor dropped-frame report.
16. Navigation invalidates old document clocks/observers.
17. Worker CPU never becomes low Node-coordinator CPU evidence.
18. Unsupported metrics, missing network detail, overflow, disconnect and trace
    truncation cannot satisfy required budgets with zero readings.
19. Failed sample reset stops measurement; incompatible cache/collector/endpoint
    identity rejects baseline comparison.
20. Heavy diagnostic reruns remain separate from measured attempts.
21. Visual updates, negative API scenarios, and scans cannot implicitly disable
    unrelated app guards.
22. A browser-executed body imports ordinary browser-compatible code without an
    application or prebuilt app; harness readiness/failure uses normal lifecycle.
23. Forbidden cache/SW-satisfied attempts fail without claiming outbound dispatch.
24. Destination-only enforcement rejects HTTPS path/method policies; TLS
    inspection requires explicit configuration and supported trust provisioning.
25. Extension startup has attributable guards before background activity or
    fails compatibility; persistent profiles do not imply shared mutable state.
26. Standalone browser-test export is unavailable; offline reports still work.
27. Authored tests/benchmarks create, communicate with, and clean up workers
    without a worker placement or host timing relabeled as worker computation.

## Resolved Decisions

### D01: Prevent Disallowed Requests And Fail Affected Work

For guard-enabled sessions, prevent a disallowed request before transmission
and fail its owning test unless a predeclared bounded denial expectation under
D33 consumes the intentional denial. Blocking alone is insufficient; detecting a request
after sending it is insufficient. Preserve affected-work attribution when more
than one test is involved rather than assigning the event arbitrarily.

Reject session admission when the requested prevention coverage cannot be
provided. Do not silently fall back to observation-only. Whether guards are
enabled automatically is resolved by D04; result classification is D02, and
shared-owner attribution/failure handling remains D08. Intentional negative-path
expectations remain part of D06 and must not authorize the denied request.

### D02: App Guard Violations Are Failed Checks

Expectations about application behavior produce attributed failed resource
checks, including disallowed app requests and unexpected app diagnostics.
Failures of observation/enforcement remain infrastructure errors. Runner
permission/execution restrictions retain their runtime-policy domain.

These checks use the shared result/assertion representation but a durable
resource-owned ledger, not the authored body recorder. D07B excludes automatic
retries of app-guard failures; ordinary assertion retry policy remains separate.

### D04: Standard App Guards Are Enabled By Default

First-party app/browser-session resources enable standard request,
console-warning/error, and unhandled-app-error guards by default. Ordinary
log/info output remains allowed. The same default applies when benchmarks use
those resources. D25 clarifies that a bare browser execution host does not
require these advanced capabilities.
Package installation does not alter unrelated tests. Permitted destinations
and narrow expected-event exceptions are explicit configuration.

### D05: Loopback Destinations Are Allowed By Default

Permit all loopback destinations, on any port, by default. External destinations
require explicit configuration; resource presence does not automatically grant
external access. Use parsed/canonical addresses rather than string prefixes.
For remote sessions, loopback refers to the browser environment unless a tunnel
explicitly maps it. Policy composition and matcher details remain open.

### D07A: Fail-Fast Stops Affected Sessions

An app-guard violation stops and fails affected sessions/tests, retaining their
evidence. Unrelated tests continue. Shared-resource violations preserve all
affected-work relationships without guessing a single owner. Automatic retry
eligibility is defined in D07B.

### D07B: App Guard Failures Are Not Automatically Retried

An app-guard failed check is ineligible for automatic integration retries.
Explicit diagnostic reruns may collect additional evidence without replacing
the failed outcome. Ordinary body-assertion retry policy is unchanged.

### D03A: Protected Service-Worker Journeys Are In Scope

Include service-worker journeys in desired browser support without silently
disabling the application's service workers. Require an adapter/environment
that satisfies the declared prevention coverage. Unsupported configurations
fail before application startup. This does not claim that ordinary Playwright
context routing supplies that coverage.

### D03B: Protected Warm-Cache Benchmarks Are In Scope

Include warm-cache benchmarks in desired browser support. Preserve the declared
HTTP cache behavior while enforcing the requested request-prevention guarantee.
Reject incompatible configurations before measurement rather than silently
disabling caching or weakening protection. Cache-disabled measurements remain
separate, explicitly identified workloads.

### D14A: Default Action Result Is An Explicit DOM/App Endpoint

The default action-to-result measurement ends at an explicitly authored DOM
condition or app mark. Label that endpoint accurately; it does not establish
physical pixel presentation. Stronger rendering/presentation evidence is a
separate supported metric. Do not substitute an intermediate response such as
a spinner for the authored final result. The default start point remains D14B.

### D14B: Default Application Latency Starts At Browser Input

Start default application action-to-result latency at the correlated browser
input event and end at the D14A DOM/app endpoint. Controller waiting and remote
command latency belong to a separately named host-command metric. If the input
timestamp/correlation cannot be established, report the metric unavailable;
never silently substitute host timing.

### D15: Portable And Engine-Specific Metrics Are Supported

Offer portable measurements and explicitly engine-specific advanced collectors.
Retain source, target, algorithm, and environment provenance instead of implying
cross-engine equivalence. An unsupported required metric cannot satisfy its
budget. The maintained metric groups are specified in
[Browser Collector Catalog](../authoring/benchmarking.md#browser-collector-catalog);
exact supported platform/tool versions remain validation work.

### D24: Controller Switching Is Not A Source-Compatibility Requirement

Use provider-native action and locator APIs. No strict source-compatibility
guarantee is required when moving between controller integrations. Make their
provider identity prominent in names, types, and documentation, for example a
Playwright `Page`. Do not present native objects as a provider-independent API.
Overkill owns surrounding lifecycle, guard, assertion, measurement, result,
and artifact contracts, not a universal action/locator API.
The exact public packaging and browser-local input contract remain open.

The lack of a semantic-versioning promise does not justify unnecessary breaking
changes after adoption. Replacement of a public native integration must be
explicit rather than silently changing its object's provider or semantics.

### D10A: Classic WebDriver Commands Are Outside First-Party Scope

Do not maintain a first-party Classic WebDriver command adapter. Focus on the
Playwright integration and verified BiDi capabilities, using another modern
client only for demonstrated gaps. Necessary HTTP/provider session setup for
obtaining a BiDi connection remains possible. A library is not excluded merely
because it also offers legacy support.

### D08A: Fresh Browser Session Per Integration-Test Attempt

Default integration-test attempts receive a fresh browser context/session.
The browser process may be reused where appropriate. Backend state remains
the responsibility of its server/simulation resources. This does not define
benchmark sample reset: samples have separately declared state requirements.
Shared observer finalization and attribution details remain part of D08.

### D09: Browser-Free Collection By Default With Explicit Browser Opt-In

Use one browser-free catalogue by default. Definitions/static imports must
respect the host-loadable boundary, with browser-only code loaded during
execution. Offer one designated collection browser as an explicit configuration
opt-in for definitions requiring browser APIs at import time. Do not start every
matrix browser for collection. Runtime expansion remains planning metadata
before final filtering/sharding; sessions start according to execution needs.
The opt-in's bootstrap resource and reference contract remains D21.

### D16: Browser Benchmarks Declare Sample State

Require a declared browser/application sample-state policy for each workload,
with supplied presets where suitable. Specify retained and reset state rather
than relying on implicit measurement-strategy defaults. Material state policy
participates in measurement identity. Presets do not equate a fresh page with
a cold context/process/cache/backend.

### D17: Diagnostic Benchmark Reruns Are Opt-In

Heavier diagnostic reruns after benchmark failures require explicit opt-in.
Retain the original failure and keep instrumented evidence under a separate
measurement/attempt identity. App-guard failures remain ineligible for automatic
retries. Lightweight collection remains the recommended measured-run default.

### D19A: Optional First-Party Screen-Reader Adapters Are In Scope

Include actual screen-reader automation through optional first-party adapters
reusing existing libraries. Publish explicitly validated OS/browser/reader
combinations. Accessibility-tree snapshots and keyboard checks do not substitute
for actual reader navigation/announcement evidence. This is not a universal
platform or complete-conformance guarantee.

### D19B: Heavier Page Audits Use Explicit Checkpoints

Run page-state audits through explicit assertions/macros at authored meaningful
states, not automatic initial/final scans for every test. Reusable composition
can apply shared checks without repeated boilerplate. Continuous app console,
network, and error guards remain automatic under D04.

### D19C: Original-Source And Rendered-DOM Checks Are Separate

Offer HTML conformance checks for original source and rendered DOM as separate
operations. Authors select either or both at explicit checkpoints. Preserve
input provenance: browser-repaired DOM cannot establish original-source
validity, and original source cannot establish client-generated DOM validity.
Do not silently refetch a different response and label it the original page.

### D11: One Portable Resource Declaration

Use one portable resource declaration with separately referenced owner/consumer
implementation modules for cross-realm resources. Existing resource/runtime
wrappers compose that declaration. It must not import implementations merely
to read metadata. Simple same-realm resources may keep inline callbacks.
Profiles do not become a second resource-definition/binding system. Exact
reference syntax, type inference, validation, and owner placement remain
implementation-design work within this selected architecture.

### D22A: Missing Required Functional Capabilities Fail Compatibility

For ordinary browser tests, a selected target missing a declared required
functional capability fails compatibility rather than automatically skipping.
Authors may explicitly declare intentional skips for unsupported targets.
Do not silently remove cases from the catalogue. Guard protection and required
benchmark metric failures retain their separately selected strict behavior.

### D05B: Inherited Explicit Denies Win

A test-local grant cannot override an explicit network deny inherited from its
runtime or profile. Change the defining restriction to authorize that traffic.
This is separate from explicitly extending the standard loopback default with
an external permission. Narrow expected-event windows do not authorize traffic.

### D23: Standalone Session Closure Throws On Guard Failure

Without a test engine, closing/disposal of a session with failed guards throws
a structured failure containing the findings. Preserve other body/cleanup
errors. Do not require callers to discover silent failed findings or throw
out-of-band from event callbacks. Managed engine execution retains ordinary
failed-check results rather than misclassifying these as observer malfunctions.

### D12: Optional Simulation HTML-Host Helper Is In Scope

Provide a first-party optional helper for consumer-owned markup/assets, safe
scenario-derived startup data, and an explicit startup invocation. Existing
SSR/template systems may supply the entire document. The app retains its
configuration mapping and build ownership; no required framework, root element,
global entry-point name, or general application bundler is introduced.

### D13A: Request-Routed Test Fixtures Require Scenario Identity

Reject requests missing scenario identity in request-routed test fixtures.
Require explicit identity even for the default scenario, catching lost routing
context rather than silently selecting default. Fixed-scenario servers derive
their identity at startup and need no per-request key. This intentionally
changes the current test HTTP adapter's untagged default fallback. URL/config
helpers and handle semantics must make the explicit routing boundary usable.

### D20A: Controller-Free Browser Capture Is Deferred

Defer first-party controller-free/manual browser capture. Manual use of the
deterministic application/server remains supported. The user's accompanying
distinction between lightweight Karma-style execution and automation capability
requires clarifying guard ownership in D25; deferral does not establish that
advanced guard/DevTools support is mandatory for a bare in-browser runner.

### D25: App Guards Are Resource Capabilities, Independent Of Placement

Bare in-browser execution remains lightweight and does not require advanced
app guards or DevTools capabilities. First-party app/browser-session resources
guard by default and can be composed into either browser-executed tests or
host-driven automation. This refines the scope of D04 rather than disabling
default guards on the resources that provide them. Ordinary test-error and
result reporting remain part of browser execution itself.

### D26: Forbidden Attempts Include Cache And Service-Worker Responses

An application request to a forbidden URL fails the guard even when HTTP cache
or a service worker satisfies it without outbound traffic. Observe application
attempts separately from enforcing outbound permissions. A proxy alone does
not establish this coverage. Reject configurations that cannot reliably observe
the required attempts; do not silently narrow the guarantee to transmissions.

### D27: Fine-Grained HTTPS Prevention Is Capability-Based

Support URL-path/method prevention through validated compatible backends.
Destination-only enforcement remains usable for destination-only policies and
rejects finer requested policies before startup. Never substitute observation
for requested prevention. TLS inspection requires explicit configuration and
trusted test certificates; do not silently change certificate validation.
Preserve the selected cache/service-worker behavior and D26 attempt coverage.

### D20B: Workers Belong To Authored Workloads

Do not add a dedicated browser-worker execution placement. Ordinary tests and
benchmarks can create workers, communicate with them, assert results, and
measure authored boundaries. Distinguish worker startup/message round trips
from worker-local computation. Application worker coverage and supported
worker metric collectors remain in scope independently of placement.

### D28: First-Party Automation Focuses On Browsers

Keep native mobile/desktop application automation outside first-party scope.
Compatible desktop/mobile browser journeys remain in scope. Consumers can wrap
native automation tools through ordinary resources without an Overkill native
UI contract. Embedded WebView support requires an explicit compatibility
assessment; mobile browser support does not imply native-container support.

### D20C: First-Party Browser Extension Integration

Include first-party extension provisioning and lifecycle through browser
resources with ordinary test/benchmark authoring. Declare supported browsers,
profile requirements, extension origins, background workers, and isolation
capabilities explicitly. Do not imply extension support from general browser
support. Persistent-profile isolation and the supported browser matrix remain
to be specified.

Extension attempts require equivalent fresh-session isolation, using a fresh
profile/process when contexts cannot provide it. Background workers may start
during persistent-profile launch, so post-acquisition listeners alone cannot
establish startup coverage. Require an earlier validated enforcement/observation
boundary or reject that configuration. Benchmarks separately declare retained
profile/extension state between samples.

### D06A: Bounded Expectations For Intentional Diagnostics

Offer authored expectations registered before an action, with explicit matcher,
occurrence count, and lifetime. Missing or excess occurrences fail. Outside
the bounded window, matching diagnostics remain subject to standard guards.
Permanent exclusions remain deliberate policy customizations, not a substitute
for asserting expected negative-path behavior. These expectations do not grant
network permission or erase recorded guard failures retroactively.

### D29: Explicit Network Transport Capabilities

The standard network guard covers HTTP(S) requests and WebSocket connections.
Other transports, including WebRTC and WebTransport, require explicit declared
capabilities with validated enforcement. Reject unsupported requested transport
configurations before startup. Do not present the standard guard as covering
every enabled browser transport or as machine-wide egress isolation.

### D20D: Standalone Browser Test Export Is Rejected

Do not offer standalone runnable browser-test bundles or static/offline test
execution without a live Overkill run. This is an explicit scope rejection,
not deferred work. Connected remote browser execution remains in scope;
offline result/report viewing is separate and remains supported.

### D30: Overkill Owns Browser Test-Harness Delivery

For browser-executed tests and benchmarks, supply a first-party harness
build/server integration using existing tooling, with replaceable adapters.
Overkill owns the harness server, browser communication channel, bootstrap,
module delivery, source maps, and result transport. No app or prebuilt app is
required. Test bodies import whatever browser-compatible code they need,
including app modules. App builds/servers, when needed, remain separately
composed resources owned/configured by the consumer.

Harness startup, readiness, frozen module/build identity, shutdown, and failures
use ordinary resource/run lifecycle and outcomes. Direct callers and the runner
use the same execution path, without CLI-only bootstrap or another scheduler.
The executing body realm owns its authored assertion recorder. Host transport
receives fenced results/evidence rather than sharing recorder objects. Frames,
workers, extension pages, and tested documents retain explicit target identities;
their events cannot select an owning attempt from whichever body is active.
Harness/control traffic has a separate declared role, not an app-wide network
grant. D31 binds the executing body to its document lifetime.

### D31: Browser Bodies Are Document-Bound

Browser-executed bodies are bound to their execution document. Replacing that
document before completion fails the attempt; no resumable phase contract is
provided. Host-driven tests handle app-navigation/reload journeys. Do not
fabricate completion or promise cleanup inside a destroyed realm. Host-owned
resource cleanup still runs; stale document results/input commands cannot
complete the replacement attempt or trigger action replay.

### D32: Provider-Specific Native Input Assistance

Offer optional first-party provider-specific input assistance to browser-executed
bodies for supported keyboard/pointer operations. Use a bounded channel tied to
run/session/target/document/attempt, with explicit capabilities, readiness,
timeout, and cancellation semantics. Do not transfer native host handles or
expose an arbitrary controller RPC surface. This does not create a universal
locator/action API or require advanced input capabilities of every bare browser
execution host. Unsupported requested assistance fails compatibility.

### D33: Predeclared Intentional Denials Can Pass

An exact bounded expectation registered before the action can consume an
intentional denied request as a passing check. The request remains blocked;
permissions never widen. Missing or excess occurrences fail, and unexpected
denials still fail owning tests. Recognize the expectation at occurrence,
without recording and later erasing an unexpected-request failure. This
explicitly qualifies D01; it does not allow contacting a forbidden destination
or treating a fulfilled forbidden request as proof of denial.

### D34: Body Placement And Measurement Capabilities Are Independent

Resolve body placement, measured target, collector owner/capabilities, and
supervision/isolation separately. Permit compatible mixed-placement cases in
one integration suite or one benchmark suite, including the same file when
its import graph permits. Partition work units by compatible runtime/body
target requirements. For incompatible graphs use explicit module/export
implementation references; do not serialize closures or add per-realm catalog
discovery. Scheduling never silently substitutes a placement or measurement.

### D35: Canonical Browser Mode Names

Use Browser-executed and Host-driven browser automation. The names describe
the authored body's execution location, not whether a controller exists or
where collectors run. Host may be remote. Karma-like is a prior-art comparison,
not a product mode name.

### D36: Browser Correctness Is Integration, Never Microtest Or Property

Browser correctness tests belong to integration in either mode. Browser
performance remains benchmark. Microtest/property bodies never run in browser
runtimes, and those families cannot use host-driven browser automation as a
way around the boundary. Static type analysis may refer to browser APIs without
executing a browser. Reject incompatible family/target combinations before
execution rather than silently reclassifying work.

### D19D: Concrete Audit Catalog Lives In The Canonical Concept

The first-party catalog includes automated/semantic/interactive accessibility,
contrast/target geometry, preference/zoom/text adaptation, actual reader
adapters, HTML/CSS/ARIA conformance, microformats, schema.org with JSON-LD/
Microdata/RDFa, and focused SEO checks. Use existing implementations through
ordinary assertions/macros and tool resources, explicit checkpoints, and
input/tool/coverage provenance. Full scope and limitations are specified in
[Accessibility And Page Audits](../authoring/higher-test-layers.md#accessibility-and-page-audits).
Specific supported tool/platform/rule versions remain validation work, not a
reason to leave the feature catalog only in research.

## Decision Register

The register records design decisions and technical validation topics.
Canonical concept documents define the settled contracts.

| ID  | Decision                                                      | Working recommendation                                                                                                                                                            |
| --- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D01 | Resolved: prevention and failure for guard-enabled sessions   | Prevent disallowed requests and fail owning tests; reject admission if requested protection is unavailable; activation remains D04                                                |
| D02 | Resolved: resource expectations versus runtime-policy errors  | App guard violations are failed checks; guard failures remain infrastructure errors and runner restrictions retain policy semantics                                               |
| D03 | Partly resolved: service-worker/cache/remote compatibility    | Protected service-worker journeys and warm-cache benchmarks are in scope with compatible enforcement; remote details remain open                                                  |
| D04 | Resolved: standard guard preset/default activation            | App/session resources guard by default, including benchmark use; D25 distinguishes bare execution hosts                                                                           |
| D05 | Resolved: default destinations and deny precedence            | Loopback allowed by default; external grants explicit; inherited explicit deny wins over test-local grants                                                                        |
| D06 | Partly resolved: expected diagnostics and matcher composition | Bounded count-checked expectations selected; exact syntax/composition remain open; no retroactive deletion                                                                        |
| D07 | Resolved: fail-fast scope and retry eligibility               | Stop affected sessions/tests; unrelated work continues; no automatic retries of app-guard failures                                                                                |
| D08 | Partly resolved: isolation and lifetime evidence              | Fresh browser context/session per integration-test attempt; process reuse allowed; sample reset and shared finalization remain separate                                           |
| D09 | Resolved: collection policy                                   | Browser-free catalogue by default; one collection browser through explicit configuration opt-in; placement/reference details remain open                                          |
| D10 | Partly resolved: controller/protocol/browser compatibility    | Classic command adapter excluded; assess Playwright public BiDi paths before adding clients for demonstrated gaps; exact matrix remains open                                      |
| D11 | Resolved: cross-realm resource declaration                    | One portable declaration referencing owner/consumer modules; same-realm inline resources allowed; no duplicate profile binding system                                             |
| D12 | Resolved: HTML-host helper                                    | Provide optional safe document/config assembly; consumer owns app mapping, markup/assets, builds, and may use existing SSR                                                        |
| D13 | Partly resolved: scenario routing/reproduction                | Request-routed test fixtures reject missing identity, including default; fixed-scenario servers bind at startup; exact helper/reproduction schema remains open                    |
| D14 | Resolved: action-to-result meaning                            | Correlated browser input to authored DOM condition/app mark; host-command and rendering measurements stay separate; no timing substitution                                        |
| D15 | Resolved: metric groups and provenance                        | Canonical collector catalog covers local timing, input, paint, requests, rendering, CPU/memory and named audits; exact platform/tool support requires validation                  |
| D16 | Partly resolved: sample state and sampling defaults           | Browser workloads require declared retained/reset state, with presets; numerical sampling defaults remain open                                                                    |
| D17 | Resolved: diagnostic rerun activation                         | Richer benchmark reruns are opt-in; original failure retained; measurement identities remain distinct                                                                             |
| D18 | Capability absence and baseline mismatch                      | Required missing metrics fail gates; no silent substitution/skip                                                                                                                  |
| D19 | Resolved: quality integration catalog and evidence contract   | Canonical advanced accessibility, HTML/CSS/ARIA, semantic-data and SEO checks; exact implementation/platform/rule versions require validation                                     |
| D20 | Partly resolved: additional execution workflows               | Controller-free capture deferred; workers managed by authored workloads; first-party extension resources included; standalone test export rejected; extension details remain open |
| D21 | Collection/resource boundary details                          | Specify opt-in collection bootstrap, owner/consumer reference resolution, and selected execution preparation within the chosen one-declaration model                              |
| D22 | Partly resolved: catalogs and capability outcomes             | Missing required functional capabilities fail compatibility unless an intentional skip is authored; exact catalog/skip API remains open                                           |
| D23 | Resolved: standalone resource observation delivery            | Closing a standalone session with failed guards throws structured findings and preserves other errors; managed execution uses ordinary result semantics                           |
| D24 | Resolved: native public automation APIs                       | Provider-native actions/locators with prominent integration identity; Overkill owns surrounding test contracts, without cross-controller source guarantees                        |
| D25 | Resolved: guard ownership across browser modes                | Bare execution stays lightweight; app/session resources guard by default and compose into either placement                                                                        |
| D26 | Resolved: forbidden cached requests                           | Forbidden app request attempts fail even without outbound traffic; require reliable observation alongside prevention                                                              |
| D27 | Resolved: fine-grained HTTPS prevention                       | Capability-based URL-path/method enforcement; reject unsupported policies; TLS inspection requires explicit configuration                                                         |
| D28 | Resolved: native application boundary                         | First-party browser focus, including compatible mobile browsers; consumer resources may wrap native tools                                                                         |
| D29 | Resolved: default transport boundary                          | Standard HTTP(S)/WebSocket guard; other transports require explicit validated capabilities                                                                                        |
| D30 | Resolved: browser test-harness delivery                       | Overkill-owned harness server/channel through replaceable existing-tool integrations; no application build prerequisite                                                           |
| D31 | Resolved: document-bound browser bodies                       | Replacing the execution document before completion fails the attempt; use host-driven tests for navigation/reload journeys                                                        |
| D32 | Resolved: browser-local native input assistance               | Optional first-party bounded provider-specific keyboard/pointer bridge, without general controller RPC or universal locator APIs                                                  |
| D33 | Resolved: intentional denial outcome                          | Exact predeclared bounded denial expectations may pass while requests stay blocked; missing/excess or unexpected denials fail                                                     |
| D34 | Resolved: independent placement and collectors                | Compatible mixed-placement suites/files; explicit import boundaries; one shared sampling/execution model                                                                          |
| D35 | Resolved: browser mode names                                  | Browser-executed and Host-driven browser automation, defined by authored body location                                                                                            |
| D36 | Resolved: browser family boundary                             | Integration correctness or benchmark performance; never browser microtest/property, with no automatic reclassification                                                            |

## Alternatives And Invalidation

Browser-only hooks duplicate resource ownership and weaken direct/remote parity.
A universal browser facade creates another controller API. Disposal-only checks
miss fail-fast and late evidence. A universal policy DSL mixes authorization,
app expectations, runner restrictions and audits. Share lifecycle/evidence,
keeping interpretation with each domain owner.

Revise this proposal if ordinary browser authoring cannot preserve identity/
assertion semantics, required prevention conflicts with selected SW/cache
behavior, resource observations cannot cover the required lifetime, or a metric
cannot establish its named endpoints. Change the stated guarantee or select
a suitable integration; do not weaken validation or relabel evidence silently.
