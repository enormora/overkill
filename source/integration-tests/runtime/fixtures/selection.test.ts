import { createSuite, createTable, createTestCase } from '../../../packages/engine/engine.entry-point.ts';
import type { TestScope } from '@overkill-dev/test';

function pass(scope: { readonly assert: Pick<TestScope['assert'], 'true' | 'collect'>; }) {
    scope.assert.true(true, { message: 'passes' });
    return scope.assert.collect();
}

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    children: [
        createSuite({
            definitionLocations: [ { kind: 'unknown' } ],
            children: [
                createTestCase({
                    definitionLocations: [ { kind: 'unknown' } ],
                    body: pass,
                    annotations: {
                        ownership: [ '@Payments' ],
                        tags: [ 'Fast' ]
                    },
                    controls: {},
                    title: 'charges card'
                }),
                createTestCase({
                    definitionLocations: [ { kind: 'unknown' } ],
                    body: pass,
                    annotations: {
                        ownership: [ '@Payments' ],
                        tags: [ 'Slow' ]
                    },
                    controls: {},
                    title: 'refunds card'
                })
            ],
            annotations: {},
            controls: {},
            title: 'payments'
        }),
        createTable({
            definitionLocations: [ { kind: 'unknown' } ],
            cases: [
                {
                    body: pass,
                    annotations: {
                        ownership: [ '@Search' ],
                        tags: [ 'Search' ]
                    },
                    controls: {},
                    title: 'query row',
                    parameters: { query: 'Alpha' }
                },
                {
                    body: pass,
                    annotations: {
                        ownership: [ '@Other' ],
                        tags: [ 'Other' ]
                    },
                    controls: {},
                    title: 'other query row',
                    parameters: { query: 'Beta' }
                }
            ],
            annotations: {},
            controls: {},
            title: 'search rows'
        })
    ],
    annotations: {},
    controls: {},
    title: 'selection fixture'
});
