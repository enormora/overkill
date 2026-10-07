import { setTimeout as wait } from 'node:timers/promises';
import { test, suite } from '../../../packages/test/test.entry-point.ts';
import { createSimulatedHttpServerResource, withResource } from '../../../packages/test/resources.entry-point.ts';
import { defineSimulatedHttpServer } from '../../../packages/simulation/simulation.entry-point.ts';
const api = createSimulatedHttpServerResource({
    simulation: defineSimulatedHttpServer({name: 'api', scenarios: {default: {title: 'ready'}}, handle() {return Response.json({ready: true});}}),
    address: {kind: 'loopback', port: 0}
});
export const testNode = suite('crash evidence', [test('HTTP prefix survives owner crash', withResource(api, async (scope) => {
    const response = await fetch(scope.resources.api.baseUrl);
    await response.json();
    await wait(100);
    process.exit(1);
}))]);
