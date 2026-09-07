import {
    createSuite,
    createTable,
    createTestCase,
    type TestScope
} from '../../../packages/engine/engine.entry-point.ts';

function pass(scope: TestScope) {
    scope.assert.true(true, { message: 'passes' });
    return scope.assert.collect();
}

export const testNode = createSuite({
                definitionLocations: [ { column: null, file: '', line: null } ],
    children: [
        createSuite({
            definitionLocations: [ { column: null, file: '', line: null } ],
            children: [
                createTestCase({
                definitionLocations: [ { column: null, file: '', line: null } ],
                    body: pass,
                    metadata: {
                        ownership: [ '@Payments' ],
                        runtimes: [ 'Node' ],
                        stability: 'stable',
                        tags: [ 'Fast' ]
                    },
                    title: 'charges card'
                }),
                createTestCase({
                definitionLocations: [ { column: null, file: '', line: null } ],
                    body: pass,
                    metadata: {
                        ownership: [ '@Payments' ],
                        runtimes: [ 'Browser' ],
                        stability: 'flaky',
                        tags: [ 'Slow' ]
                    },
                    title: 'refunds card'
                })
            ],
            metadata: {},
            title: 'payments'
        }),
        createTable({
                definitionLocations: [ { column: null, file: '', line: null } ],
            cases: [
                {
                    body: pass,
                    metadata: {
                        ownership: [ '@Search' ],
                        runtimes: [ 'Node' ],
                        stability: 'experimental',
                        tags: [ 'Search' ]
                    },
                    title: 'query row',
                    parameters: { query: 'Alpha' }
                },
                {
                    body: pass,
                    metadata: {
                        ownership: [ '@Other' ],
                        runtimes: [ 'Node' ],
                        stability: 'stable',
                        tags: [ 'Other' ]
                    },
                    title: 'other query row',
                    parameters: { query: 'Beta' }
                }
            ],
            metadata: {},
            title: 'search rows'
        })
    ],
    metadata: {},
    title: 'selection fixture'
});
