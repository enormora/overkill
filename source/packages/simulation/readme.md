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
The returned handle exposes a read-only `transcript` with one normalized entry
per HTTP exchange, including the selected scenario. Request and response bodies
are captured up to 16 KiB independently.
Protocol integrations can use `@overkill-dev/simulation/transcript` for the
shared HTTP transcript recorder, snapshots, and types.
`runWithTranscriptScope(scope, run)` shares attribution across package boundaries.
Pass `null` to read the complete lifetime transcript.
Use `createSimulatedHttpServerResource(...)` from `@overkill-dev/resources`
when a test runtime should own the server lifecycle. The resource adapter
requires an explicit local address request, for example
`{ kind: 'loopback', port: 0 }`.
