import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { suite, test, type TestScope } from '@overkill-dev/test';

import { passingResult, runCommandLine } from '../../../../test-support/command-line-test-driver.ts';
import { parseRuntimeSelector } from '../../../../packages/test/run-runtime-selector.ts';

const assertRunRuntimeSelection = defineCompositeAssertion({
    name: 'run runtime selection',
    assert(check, selection: unknown) {
        return check.group([ check.deepEqual(selection, {
            filter: {
                filters: [
                    { kind: 'runtime', runtime: 'app' },
                    {
                        kind: 'runtime-variant',
                        runtime: 'browser',
                        variantId: 'chromium'
                    },
                    {
                        dimension: 'engine',
                        kind: 'runtime-dimension',
                        runtime: 'ui.browser',
                        value: 'firefox'
                    },
                    { field: 'tag', kind: 'equals', value: 'fast' }
                ],
                kind: 'all'
            },
            kind: 'filter'
        }) ]);
    }
});

export const testNode = suite({
    title: 'Overkill CLI runtime selection',

    children: [
        test({
            title: 'runtime selector parser lowers names, variants, and dimensions',

            body(scope) {
                scope.assert.deepEqual(parseRuntimeSelector('browser'), {
                    kind: 'runtime',
                    runtime: 'browser'
                });
                scope.assert.deepEqual(parseRuntimeSelector('browser:chromium'), {
                    kind: 'runtime-variant',
                    runtime: 'browser',
                    variantId: 'chromium'
                });
                scope.assert.deepEqual(parseRuntimeSelector('ui.browser.engine=chromium=stable'), {
                    dimension: 'engine',
                    kind: 'runtime-dimension',
                    runtime: 'ui.browser',
                    value: 'chromium=stable'
                });

                return scope.assert.collect();
            }
        }),
        test({
            title: 'combines repeated runtime selectors with filter expressions',

            async body(scope: TestScope) {
                const result = await runCommandLine([
                    'run',
                    '--runtime',
                    'app',
                    '--runtime=browser:chromium',
                    '--runtime',
                    'ui.browser.engine=firefox',
                    '--filter',
                    'tag=fast',
                    'source/a.test.ts'
                ], passingResult());
                const request = result.runRequests[0];

                scope.require.defined(request);
                scope.assert.deepEqual(result.exitCodes, [ 0 ]);
                scope.assert(assertRunRuntimeSelection, request.runRequest.selection);

                return scope.assert.collect();
            }
        }),
        test({
            title: 'overkill list accepts repeated duplicate runtime selectors',

            async body(
                scope: TestScope
            ) {
                const result = await runCommandLine([
                    'list',
                    '--runtime=browser:chromium',
                    '--runtime=browser:chromium',
                    'source/a.test.ts'
                ], passingResult());
                const request = result.listRequests[0];

                scope.require.defined(request);
                scope.assert.deepEqual(request.listRequest.selection, {
                    filter: {
                        filters: [
                            { kind: 'runtime-variant', runtime: 'browser', variantId: 'chromium' },
                            { kind: 'runtime-variant', runtime: 'browser', variantId: 'chromium' }
                        ],
                        kind: 'all'
                    },
                    kind: 'filter'
                });

                return scope.assert.collect();
            }
        }),
        test({
            title: 'rejects malformed runtime selectors before runner loading',

            async body(
                scope
            ) {
                for (const selector of [ '', 'browser:', 'browser.engine=', 'browser=chromium', ':chromium' ]) {
                    const result = await runCommandLine(
                        [ 'run', '--runtime', selector, 'source/a.test.ts' ],
                        passingResult()
                    );

                    scope.assert.deepEqual(result.exitCodes, [ 3 ]);
                    scope.assert.equal(result.runRequests.length, 0);
                    scope.assert.true(result.stderr.includes('Runtime selector must use'));
                }

                return scope.assert.collect();
            }
        })
    ]
});
