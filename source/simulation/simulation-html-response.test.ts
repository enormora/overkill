import { type TestNode, suite, test } from '@overkill-dev/test';

import { simulationHtmlResponse } from './simulation-html-response.ts';

const page = {
    language: 'en',
    headMarkup: '<title>Checkout &amp; delivery</title>',
    bodyMarkup: '<main id="checkout">Ready</main>',
    stylesheets: [ 'app.css?theme=light&size=small', 'https://example.test/print.css' ],
    startupModule: 'start.js?label="ready"'
};

export const testNode: TestNode = suite('simulation HTML response', [
    test('serves consumer markup and escapes generated HTML attributes', async function (scope) {
        const response = simulationHtmlResponse({ ...page, language: 'en"x' });

        scope.assert.equal(response.status, 200);
        scope.assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8');
        const expected = [
            '<!doctype html><html lang="en&quot;x"><head><meta charset="utf-8">',
            page.headMarkup,
            '<link rel="stylesheet" href="app.css?theme=light&amp;size=small">',
            '<link rel="stylesheet" href="https://example.test/print.css">',
            '</head><body>',
            page.bodyMarkup,
            '<script type="module" src="start.js?label=&quot;ready&quot;"></script></body></html>'
        ]
            .join('');
        scope.assert.equal(await response.text(), expected);
        return scope.assert.collect();
    }),
    test('identifies invalid asset references by field', function (scope) {
        scope.assert.throws(function emptyModule() {
            simulationHtmlResponse({ ...page, startupModule: '' });
        }, {
            type: TypeError,
            message: 'Simulation HTML page startupModule requires a relative or HTTP(S) URL.'
        });
        scope.assert.throws(function malformedStylesheet() {
            simulationHtmlResponse({ ...page, stylesheets: [ 'https://[' ] });
        }, {
            type: TypeError,
            message: 'Simulation HTML page stylesheets[0] requires a relative or HTTP(S) URL.'
        });
        scope.assert.throws(function unsupportedModuleProtocol() {
            simulationHtmlResponse({ ...page, startupModule: 'file:///start.js' });
        }, {
            type: TypeError,
            message: 'Simulation HTML page startupModule requires a relative or HTTP(S) URL.'
        });
        return scope.assert.collect();
    })
]);
