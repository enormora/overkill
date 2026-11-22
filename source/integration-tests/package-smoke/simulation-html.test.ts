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

async function assertStartupModule(assert: TestScope['assert'], pageUrl: string, html: string): Promise<void> {
    const reference = /<script type="module" src="(?<reference>[^"]+)"><\/script>/u.exec(html)?.groups?.reference;
    if (reference === undefined) {
        throw new Error('The installed HTML response omitted the startup module.');
    }
    const module = await fetch(new URL(reference, pageUrl));
    assert.equal(module.headers.get('content-type'), 'text/javascript');
    assert.equal(await module.text(), startupSource);
}

async function assertPage(assert: TestScope['assert'], page: PageRequest): Promise<void> {
    const response = await fetch(page.url);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8');
    const html = await response.text();
    assert.includes(html, `<main>${page.title}</main>`);
    await assertStartupModule(assert, page.url, html);
    const api = await fetch(new URL('api', page.url));
    assert.deepEqual(await api.json(), { scenario: page.scenario });
}

async function assertMissingScenario(assert: TestScope['assert'], routedBaseUrl: string): Promise<void> {
    const response = await fetch(new URL('/', routedBaseUrl));
    assert.equal(response.status, 400);
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
        await assertPage(scope.assert, page);
    }
    await assertMissingScenario(scope.assert, routed.baseUrl);
    return scope.assert.collect();
});
