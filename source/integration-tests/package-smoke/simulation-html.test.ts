import { type TestNode, test, type TestScope } from '@overkill-dev/test';

import type * as HttpPackage from '../../packages/simulation/http.entry-point.ts';
import type * as SimulationPackage from '../../packages/simulation/simulation.entry-point.ts';
import { resolvePackagedExport } from './support/packaged-module.ts';

const startupSource = 'export const app = "checkout";';

type PageRequest = {
    readonly url: string;
    readonly scenario: string;
    readonly title: string;
};

async function assertStartupModule(scope: TestScope, pageUrl: string, html: string): Promise<void> {
    const reference = /<script type="module" src="(?<reference>[^"]+)"><\/script>/u.exec(html)?.groups?.reference;
    scope.require.defined(reference);
    const module = await fetch(new URL(reference, pageUrl));
    scope.assert.equal(module.headers.get('content-type'), 'text/javascript');
    scope.assert.equal(await module.text(), startupSource);
}

async function assertPage(scope: TestScope, page: PageRequest): Promise<void> {
    const response = await fetch(page.url);
    scope.assert.equal(response.status, 200);
    scope.assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8');
    const html = await response.text();
    scope.assert.includes(html, `<main>${page.title}</main>`);
    await assertStartupModule(scope, page.url, html);
    const api = await fetch(new URL('api', page.url));
    scope.assert.deepEqual(await api.json(), { scenario: page.scenario });
}

async function assertMissingScenario(scope: TestScope, routedBaseUrl: string): Promise<void> {
    const response = await fetch(new URL('/', routedBaseUrl));
    scope.assert.equal(response.status, 400);
    await response.text();
}

export const testNode: TestNode = test('serves app pages from the installed HTTP package', async function (scope) {
    const { defineSimulatedHttpServer } = await import(
        await resolvePackagedExport('@overkill-dev/simulation')
    ) as typeof SimulationPackage;
    const { simulationHtmlResponse, startFixedSimulatedHttpServer, startSimulatedHttpServer } = await import(
        await resolvePackagedExport('@overkill-dev/simulation/http')
    ) as typeof HttpPackage;
    const simulation = defineSimulatedHttpServer({
        name: 'checkout',
        scenarios: { default: { title: 'Ready' }, 'payments-500': { title: 'Unavailable' } },
        handle(request, scenario) {
            const url = new URL(request.url);
            if (url.pathname === '/') {
                return simulationHtmlResponse({
                    language: 'en',
                    headMarkup: '',
                    bodyMarkup: `<main>${scenario.descriptor.title}</main>`,
                    stylesheets: [],
                    startupModule: 'start.js'
                });
            }
            if (url.pathname === '/start.js') {
                return new Response(startupSource, { headers: { 'content-type': 'text/javascript' } });
            }
            return Response.json({ scenario: scenario.key });
        }
    });

    await using routed = await startSimulatedHttpServer({ simulation });
    await using fixed = await startFixedSimulatedHttpServer({ simulation, scenario: 'payments-500' });
    const pages = [
        { url: routed.baseUrl, scenario: 'default', title: 'Ready' },
        { url: routed.scenarioUrl('payments-500', '/'), scenario: 'payments-500', title: 'Unavailable' },
        { url: fixed.baseUrl, scenario: 'payments-500', title: 'Unavailable' }
    ];
    for (const page of pages) {
        await assertPage(scope, page);
    }
    await assertMissingScenario(scope, routed.baseUrl);
    return scope.assert.collect();
});
