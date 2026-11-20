import { type TestNode, table, suite, test } from '@overkill-dev/test';

import { debugArtifactFixture } from '../test-support/debug-artifact-fixture.ts';
import { formatDebugSummary, contextPrefix } from './human-reporter-rendering.ts';

export const testNode: TestNode = suite('human debug evidence rendering', [
    table({
        title: 'formats heap growth',
        cases: [ null, 0, 42, -42 ] as const,
        caseTitle(growth) {
            return `${String(growth)}`;
        },
        async test(scope) {
            const growth = scope.parameters;

            const { artifact } = await debugArtifactFixture('debug case');
            const debug = {
                ...artifact,
                payload: {
                    ...artifact.payload,
                    durationMicroseconds: 12_500,
                    timeline: [],
                    stats: { ...artifact.payload.stats, heapGrowthBytes: growth }
                }
            };
            const heap = growth === null ? 'heap unavailable' : `${growth >= 0 ? '+' : ''}${growth} B heap (thread)`;
            scope.assert.equal(formatDebugSummary([ debug ]), ` [debug: 13 ms wall, 0 entries, ${heap}]`);
            return scope.assert.collect();
        }
    }),
    test('sorts multiple runtime dimensions before rendering context', function (scope) {
        scope.assert.equal(
            contextPrefix(
                [ {
                    name: 'node',
                    variantId: null,
                    dimensions: { version: '26', architecture: 'arm' },
                    scenarios: {}
                } ],
                null,
                [ 'root' ],
                { color: false, wrap: false }
            ),
            '[node:architecture=arm,version=26] [root]'
        );
        return scope.assert.collect();
    })
]);
