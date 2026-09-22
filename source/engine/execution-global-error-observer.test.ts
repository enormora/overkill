import { setImmediate as scheduleImmediate } from 'node:timers';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { createTestEngine } from '../test-support/create-test-engine.ts';
import { createExecutionGlobalErrorObserver } from './execution-global-error-observer.ts';
import type { RunnerError } from './run-result.ts';
import type { TestPlanCase } from './test-plan.ts';

function createPlanCase(title: string): TestPlanCase {
    const engine = createTestEngine();
    const testPlan = engine.createTestPlan(engine.createRoot({
        annotations: {},
        children: [
            engine.createTestCase({
                annotations: {},
                body(testScope) {
                    testScope.assert.true(true);

                    return testScope.assert.collect();
                },
                controls: {},
                definitionLocations: [ { kind: 'unknown' } ],
                title
            })
        ],
        controls: {},
        title: 'root'
    }));
    return testPlan.cases[0];
}

function emitUnhandledRejection(message: string): void {
    process.emit('unhandledRejection', new Error(message), Promise.resolve());
}

function emitUncaughtException(message: string): void {
    process.emit('uncaughtException', new Error(message));
}

function firstError(errors: readonly RunnerError[]): RunnerError {
    const error = errors[0];

    if (error === undefined) {
        throw new Error('Expected a runner error.');
    }

    return error;
}

async function yieldToImmediate(): Promise<void> {
    await new Promise<void>(function resolveOnImmediate(resolve) {
        scheduleImmediate(resolve);
    });
}

export const testNode = createOverkillSuite({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/engine/execution-global-error-observer.test.ts',
    children: [
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'observer attributes unhandled rejections to the active case',
            async body(scope: OverkillScope) {
                const observer = createExecutionGlobalErrorObserver('in-process');
                const testCase = createPlanCase('rejects globally');

                await observer.runBoundary(async function runObservedBoundary() {
                    await observer.runCase(testCase, async function runObservedCase() {
                        emitUnhandledRejection('background rejected');
                    });
                });

                const error = firstError(observer.takeErrors());

                scope.assert.equal(error.subtype, 'unhandled-rejection');
                scope.assert.equal(error.attributedTo?.title, 'rejects globally');
                scope.assert.equal(observer.hasFatalError(), true);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'observer attributes uncaught exceptions to the active case',
            async body(scope: OverkillScope) {
                const observer = createExecutionGlobalErrorObserver('in-process');
                const testCase = createPlanCase('throws globally');

                await observer.runBoundary(async function runObservedBoundary() {
                    await observer.runCase(testCase, async function runObservedCase() {
                        emitUncaughtException('timer exploded');
                    });
                });

                const error = firstError(observer.takeErrors());

                scope.assert.equal(error.subtype, 'uncaught-exception');
                scope.assert.equal(error.attributedTo?.title, 'throws globally');

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'observer reports ended-case async failures as attribution drift',
            async body(scope: OverkillScope) {
                const observer = createExecutionGlobalErrorObserver('in-process');
                const testCase = createPlanCase('finished before rejection');

                await observer.runBoundary(async function runObservedBoundary() {
                    await observer.runCase(testCase, async function runObservedCase() {
                        scheduleImmediate(function rejectAfterCase() {
                            emitUnhandledRejection('late rejection');
                        });
                    });
                    await yieldToImmediate();
                });

                const error = firstError(observer.takeErrors());

                scope.assert.equal(error.subtype, 'attribution-drift');
                scope.assert.equal(error.attributedTo, null);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'execute() surfaces global hook failures as runner errors',
            async body(scope: OverkillScope) {
                const engine = createTestEngine();
                const testPlan = engine.createTestPlan(engine.createRoot({
                    annotations: {},
                    children: [
                        engine.createTestCase({
                            annotations: {},
                            body(testScope) {
                                emitUnhandledRejection('case hook failure');
                                testScope.assert.true(true);

                                return testScope.assert.collect();
                            },
                            controls: {},
                            definitionLocations: [ { kind: 'unknown' } ],
                            title: 'emits hook failure'
                        })
                    ],
                    controls: {},
                    title: 'root'
                }));
                const result = await engine.execute(testPlan);
                const error = firstError(result.runnerErrors);

                scope.assert.equal(error.subtype, 'unhandled-rejection');
                scope.assert.equal(error.attributedTo?.title, 'emits hook failure');
                scope.assert.deepEqual(
                    result.perTest.map(function toVerdict(testResult) {
                        return testResult.verdict;
                    }),
                    [ 'crashed' ]
                );

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
