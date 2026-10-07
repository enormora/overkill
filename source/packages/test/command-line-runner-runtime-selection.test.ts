import { createSuite, createTestCase, type TestScope } from '../engine/engine.entry-point.ts';
import { passingResult, runCommandLine } from '../../test-support/command-line-test-driver.ts';
import { parseRuntimeSelector } from './run-runtime-selector.ts';

const emptyTestData = { annotations: {}, controls: {} } as const;

function assertRunRuntimeSelection(scope: TestScope, selection: unknown): void {
    scope.assert.deepEqual(selection, {
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
    });
}

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/packages/test/command-line-runner-runtime-selection.test.ts',
    ...emptyTestData,
    children: [
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'runtime selector parser lowers names, variants, and dimensions',
            ...emptyTestData,
            body(scope: TestScope) {
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
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'overkill wrapper combines repeated runtime selectors with filter expressions',
            ...emptyTestData,
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
                assertRunRuntimeSelection(scope, request.runRequest.selection);

                return scope.assert.collect();
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'overkill list accepts repeated duplicate runtime selectors',
            ...emptyTestData,
            async body(scope: TestScope) {
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
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'overkill wrapper rejects malformed runtime selectors before runner loading',
            ...emptyTestData,
            async body(scope: TestScope) {
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

const { runIfMain: runTestFileIfMain } = await import('../../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
