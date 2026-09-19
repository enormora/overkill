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

Use `@overkill-dev/simulation/http` to launch a simulated HTTP server manually.
Use `createSimulatedHttpServerResource(...)` from `@overkill-dev/resources`
when a test runtime should own the server lifecycle. The resource adapter
requires an explicit local address request, for example
`{ kind: 'loopback', port: 0 }`.
