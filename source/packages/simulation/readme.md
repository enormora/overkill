# `@overkill-dev/simulation`

Finite simulation descriptors for Overkill resource-backed tests.

```ts
import { defineSimulatedHttpServer } from '@overkill-dev/simulation';

const api = defineSimulatedHttpServer({
    name: 'api',
    scenarios: {
        default: { title: 'standard responses' },
        'payments-500': { status: 500, title: 'payment service fails' }
    },
    handle(_request, scenario) {
        return Response.json({ scenario: scenario.key });
    }
});
```

Every simulation has a `default` scenario. Scenario descriptors require a
`title` and may carry additional typed data for the simulator.

Launch either server from `@overkill-dev/simulation/http`.

```ts
import { startFixedSimulatedHttpServer, startSimulatedHttpServer } from '@overkill-dev/simulation/http';

await using routed = await startSimulatedHttpServer({ simulation: api });
await fetch(new URL('orders', routed.baseUrl));
await fetch(routed.scenarioUrl('payments-500', '/orders'));

await using fixed = await startFixedSimulatedHttpServer({ simulation: api, scenario: 'payments-500' });
await fetch(new URL('/orders', fixed.baseUrl));
```

Routed URLs use `/<scenario-key>/<path>`, including `/default/` for the routed
root. Replace the old query selector with `scenarioUrl(key, path)`. Use relative
references such as `orders` with a routed `baseUrl` to preserve its prefix.
A fixed server uses its startup scenario for every request.

Both handles expose a read-only `transcript`. A missing routed key produces
HTTP 400 and a transcript entry with `scenario: null`. Request and response bodies
are captured up to 16 KiB independently.
Protocol integrations can use `@overkill-dev/simulation/transcript` for the
shared HTTP transcript recorder, snapshots, and types.
`runWithTranscriptScope(scope, run)` shares attribution across package boundaries.
Pass `null` to read the complete lifetime transcript.
Use `createSimulatedHttpServerResource(...)` from `@overkill-dev/resources`
when a test runtime should own the server lifecycle. The resource adapter
requires an explicit local address request, for example
`{ kind: 'loopback', port: 0 }`.

## Serve a simulated app page

Return `simulationHtmlResponse(page)` from the HTTP handler on the route that
serves the app shell.

```ts
import { defineSimulatedHttpServer } from '@overkill-dev/simulation';
import { simulationHtmlResponse } from '@overkill-dev/simulation/http';

const page = {
    language: 'en',
    headMarkup: '<title>Checkout</title>',
    bodyMarkup: '<main id="app"></main>',
    stylesheets: [ 'app.css' ],
    startupModule: 'start.js'
};

const simulation = defineSimulatedHttpServer({
    name: 'checkout',
    scenarios: { default: { title: 'Normal checkout' } },
    handle(request, scenario) {
        if (request.method === 'GET' && new URL(request.url).pathname === '/') {
            return simulationHtmlResponse(page);
        }
        return serveApiAndAssets(request, scenario);
    }
});
```

Supply trusted head and body markup and asset destinations. The helper returns a
UTF-8 HTML response with links to the given assets. The consumer implements
`serveApiAndAssets` and serves the output of its own build. Relative asset
references such as `start.js` stay under the scenario prefix when the page is
served at `/default/` or another routed scenario root. The startup module owns
app initialization and any startup config. You can set a Content Security
Policy on the returned response or return a response from your own template
or SSR system.
