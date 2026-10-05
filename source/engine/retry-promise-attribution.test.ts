import {
    createSuite,
    createTestCase,
    type TestScope,
    type TestPlanCase
} from '../packages/engine/engine.entry-point.ts';
import { createTestEngine } from '../test-support/create-test-engine.ts';
import { createAsyncLeakMonitor, type AsyncLeakMonitor } from './async-leak-diagnostics.ts';

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

async function assertPromiseWindows(
    scope: TestScope,
    monitor: AsyncLeakMonitor,
    first: TestPlanCase,
    next: TestPlanCase
): Promise<void> {
    const pending = await monitor.runCase(first, async function createPendingPromise() {
        return Promise.withResolvers<undefined>();
    });
    try {
        scope.assert.notNull(monitor.casePromiseLeakError(first));
        await monitor.runCase(next, async function completedAttempt() {
            return undefined;
        });
        scope.assert.equal(monitor.casePromiseLeakError(next), null);
    } finally {
        pending.resolve(undefined);
        monitor.stop();
    }
}

export const testNode = createSuite({
    ...metadata,
    title: 'source/engine/retry-promise-attribution.test.ts',
    children: [ 'retry', 'runtime-variant' ].map(function attributionBoundary(kind) {
        return createTestCase({
            ...metadata,
            title: `promise leak evidence does not move into a later ${kind} window`,
            async body(scope: TestScope) {
                const first = promiseCase();
                const next = kind === 'retry' ? first : {
                    ...first,
                    workId: {
                        ...first.workId,
                        runtimes: [ { name: 'service', variantId: 'next', dimensions: {}, scenarios: {} } ]
                    }
                };
                await assertPromiseWindows(scope, createAsyncLeakMonitor(), first, next);
                return scope.assert.collect();
            }
        });
    })
});
const { runIfMain } = await import('../test-support/run-if-main.ts');
await runIfMain(import.meta, testNode);
