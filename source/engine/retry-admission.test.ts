import {
    createSuite,
    createTestCase,
    defineReporter,
    type ReporterEvent,
    type TestScope
} from '../packages/engine/engine.entry-point.ts';
import { createTestEngine } from '../test-support/create-test-engine.ts';

const metadata = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;
const schedulingCases = [ { mode: 'serial-in-process' }, {
    mode: 'concurrent-in-process',
    maxConcurrency: 1
} ] as const;

function failRetryStart(event: ReporterEvent): void {
    if (event.kind === 'test-start' && event.attempt === 1) {
        process.emit('unhandledRejection', new Error('retry admission failed'), Promise.resolve());
    }
}

export const testNode = createSuite({
    ...metadata,
    title: 'source/engine/retry-admission.test.ts',
    children: schedulingCases.map(function executionMode(execution) {
        return createTestCase({
            ...metadata,
            title: `fatal retry-start reporting prevents body execution under ${execution.mode}`,
            async body(scope: TestScope) {
                const engine = createTestEngine();
                let runs = 0;
                const reporter = defineReporter(function () {
                    return {
                        name: 'fatal-admission',
                        kind: 'real-time',
                        sinks: [ { kind: 'memory' } ],
                        dispose: null,
                        onFinish: null,
                        onEvent: failRetryStart
                    };
                });
                const plan = engine.createTestPlan(engine.createRoot({
                    annotations: {},
                    controls: {},
                    title: 'admission',
                    children: [ engine.createTestCase({
                        ...metadata,
                        title: 'case',
                        body(attemptScope) {
                            runs += 1;
                            attemptScope.assert.fail();
                            return attemptScope.assert.collect();
                        }
                    }) ]
                }));
                const result = await engine.execute(plan, {
                    execution,
                    reporters: [ reporter ],
                    retryPolicy: { maxAttempts: 3 },
                    runFacts: {},
                    startedAt: '1970-01-01T00:00:00.000Z'
                });
                scope.assert.deepEqual([ runs, result.summary.crashed, result.perTest[0]?.attempts.length ], [
                    1,
                    1,
                    2
                ]);
                scope.assert.equal(result.status, 'failed');
                return scope.assert.collect();
            }
        });
    })
});
const { runIfMain } = await import('../test-support/run-if-main.ts');
await runIfMain(import.meta, testNode);
