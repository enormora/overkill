import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { debugArtifactFixture } from '../test-support/debug-artifact-fixture.ts';
import { formatDebugSummary, contextPrefix } from './human-reporter-rendering.ts';

export const testNode = suite('human debug evidence rendering', [
    ...([ null, 0, 42, -42 ] as const).map(function (growth) {
        return test(`formats ${String(growth)} heap growth`, async function (scope: TestScope) {
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
        });
    }),
    test('sorts multiple runtime dimensions before rendering context', function (scope: TestScope) {
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
await runIfMain(import.meta, testNode);
