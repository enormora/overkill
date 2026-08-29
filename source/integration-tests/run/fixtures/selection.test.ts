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
    children: [
        createSuite({
            children: [
                createTestCase({
                    body: pass,
                    metadata: {
                        ownership: [ '@Payments' ],
                        runtimes: [ 'Node' ],
                        stability: 'stable',
                        tags: [ 'Fast' ]
                    },
                    name: 'charges card'
                }),
                createTestCase({
                    body: pass,
                    metadata: {
                        ownership: [ '@Payments' ],
                        runtimes: [ 'Browser' ],
                        stability: 'flaky',
                        tags: [ 'Slow' ]
                    },
                    name: 'refunds card'
                })
            ],
            metadata: {},
            name: 'payments'
        }),
        createTable({
            cases: [
                {
                    body: pass,
                    metadata: {
                        ownership: [ '@Search' ],
                        runtimes: [ 'Node' ],
                        stability: 'experimental',
                        tags: [ 'Search' ]
                    },
                    name: 'query row',
                    parameters: { query: 'Alpha' }
                }
            ],
            metadata: {},
            name: 'search rows'
        })
    ],
    metadata: {},
    name: 'selection fixture'
});
