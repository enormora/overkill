import { table, suite } from '@overkill-dev/test';

import type { TestPlanCase } from '../packages/engine/engine.entry-point.ts';
import { createTestEngine } from '../test-support/create-test-engine.ts';
import { createAsyncLeakMonitor } from './async-leak-diagnostics.ts';

const metadata = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;

function promiseCase(): TestPlanCase {
    const engine = createTestEngine();
    return engine
        .createTestPlan(engine.createRoot({
            annotations: {},
            controls: {},
            title: 'promises',
            children: [ engine.createTestCase({
                ...metadata,
                title: 'case',
                body(scope) {
                    scope.assert.true(true);
                    return scope.assert.collect();
                }
            }) ]
        }))
        .cases[0];
}

export const testNode = suite(
    'Retry promise attribution',
    [ table({
        title: 'promise leak evidence does not move into a later window',
        cases: [ 'retry', 'runtime-variant' ],
        caseTitle: String,
        async test(scope) {
            const kind = scope.parameters;

            const first = promiseCase();
            const next = kind === 'retry' ? first : {
                ...first,
                workId: {
                    ...first.workId,
                    runtimes: [ { name: 'service', variantId: 'next', dimensions: {}, scenarios: {} } ]
                }
            };
            const promiseWindowsMonitor = createAsyncLeakMonitor();
            const promiseWindowsPending = await promiseWindowsMonitor.runCase(
                first,
                async function createPendingPromise() {
                    return Promise.withResolvers<undefined>();
                }
            );
            try {
                scope.assert.notNull(promiseWindowsMonitor.casePromiseLeakError(first));
                await promiseWindowsMonitor.runCase(next, async function completedAttempt() {
                    return undefined;
                });
                scope.assert.equal(promiseWindowsMonitor.casePromiseLeakError(next), null);
            } finally {
                promiseWindowsPending.resolve(undefined);
                promiseWindowsMonitor.stop();
            }

            return scope.assert.collect();
        }
    }) ]
);
