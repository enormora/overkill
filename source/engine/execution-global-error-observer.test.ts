import { spawn } from 'node:child_process';
import type { Readable } from 'node:stream';
import { setImmediate as scheduleImmediate } from 'node:timers';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { createTestEngine } from '../test-support/create-test-engine.ts';
import {
    createDisabledExecutionGlobalErrorObserver,
    createExecutionGlobalErrorObserver,
    type ExecutionGlobalErrorObserver
} from './execution-global-error-observer.ts';
import type { RunnerError } from './run-result.ts';
import type { TestPlanCase } from './test-plan.ts';

type SpawnOutput = {
    readonly code: number | null;
    readonly stderr: string;
    readonly stdout: string;
};

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

function emitUnhandledRejectionReason(reason: unknown): void {
    process.emit('unhandledRejection', reason, Promise.resolve());
}

function createStacklessError(message: string): Error {
    const error = new Error(message);

    Object.defineProperty(error, 'stack', { value: undefined });

    return error;
}

function createPermissionError(permission: string, resource: string): Error {
    const error = new Error('Access to this API has been restricted');

    Object.defineProperties(error, {
        code: { value: 'ERR_ACCESS_DENIED' },
        permission: { value: permission },
        resource: { value: resource }
    });

    return error;
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

async function fatalSignalLabel(observer: ExecutionGlobalErrorObserver): Promise<string> {
    await observer.fatalSignal();

    return 'fatal';
}

async function emitObservedRejection(observer: ExecutionGlobalErrorObserver, message: string): Promise<void> {
    await observer.runBoundary(async function runObservedBoundary() {
        emitUnhandledRejection(message);
    });
}

async function fatalHandlerDeliveryCount(observer: ExecutionGlobalErrorObserver): Promise<number> {
    const fatalErrors: RunnerError[] = [];
    const removeFatalHandler = observer.onFatalError(function recordFatalError(error) {
        fatalErrors.push(error);
    });
    const fatalSignal = fatalSignalLabel(observer);

    await emitObservedRejection(observer, 'fatal failure');
    await fatalSignal;
    removeFatalHandler();
    await emitObservedRejection(observer, 'second fatal failure');
    await observer.fatalSignal();

    return fatalErrors.length;
}

function assertPlainRejectionCause(scope: OverkillScope, error: RunnerError): void {
    scope.assert.deepEqual(error.cause, {
        boundary: 'in-process',
        hook: 'unhandledRejection',
        origin: {
            case: null,
            work: null
        },
        phase: 'collection',
        reason: {
            message: 'plain rejection',
            name: 'Error',
            stack: null
        }
    });
}

async function collectStream(stream: Readable): Promise<string> {
    return await new Promise(function collect(resolve, reject) {
        const chunks: Buffer[] = [];

        stream.on('data', function recordChunk(chunk: Buffer) {
            chunks.push(chunk);
        });
        stream.on('error', reject);
        stream.on('end', function resolveOutput() {
            resolve(Buffer.concat(chunks).toString('utf8'));
        });
    });
}

async function runObserverScript(script: string): Promise<SpawnOutput> {
    const child = spawn(process.execPath, [ '--input-type=module', '--eval', script ], {
        cwd: process.cwd(),
        stdio: [ 'ignore', 'pipe', 'pipe' ]
    });
    const stdout = collectStream(child.stdout);
    const stderr = collectStream(child.stderr);
    const code = await new Promise<number | null>(function wait(resolve, reject) {
        child.on('error', reject);
        child.on('close', resolve);
    });

    return {
        code,
        stderr: await stderr,
        stdout: await stdout
    };
}

function ambiguousBoundaryScript(): string {
    return `
        import {
            createDisabledExecutionGlobalErrorObserver,
            createExecutionGlobalErrorObserver
        } from './source/engine/execution-global-error-observer.ts';

        createDisabledExecutionGlobalErrorObserver().fatalSignal();
        const firstObserver = createExecutionGlobalErrorObserver('in-process');
        const secondObserver = createExecutionGlobalErrorObserver('worker-pool-host');
        let releaseFirstBoundary = () => {};
        let releaseSecondBoundary = () => {};
        const firstBoundary = firstObserver.runBoundary(async () => {
            await new Promise((resolve) => {
                releaseFirstBoundary = resolve;
            });
        });
        const secondBoundary = secondObserver.runBoundary(async () => {
            await new Promise((resolve) => {
                releaseSecondBoundary = resolve;
            });
        });

        process.emit('unhandledRejection', new Error('shared failure'), Promise.resolve());
        releaseFirstBoundary();
        releaseSecondBoundary();
        await Promise.all([ firstBoundary, secondBoundary ]);

        console.log(JSON.stringify([
            firstObserver.takeErrors()[0]?.subtype,
            secondObserver.takeErrors()[0]?.subtype
        ]));
    `;
}

function hostFatalScript(): string {
    return `
        const sent = [];

        process.send = (message) => {
            sent.push(message);

            return true;
        };
        process.disconnect = () => {
            process.emit('disconnect');
        };

        await import('./source/run/worker-pool-host.entry-point.ts');
        process.emit('unhandledRejection', new Error('host failed'), Promise.resolve());
        process.emit('uncaughtException', new Error('second host failed'));
        await new Promise((resolve) => {
            setImmediate(resolve);
        });

        console.log(JSON.stringify(sent.map((message) => message.message.kind)));
    `;
}

function parseJson(text: string): unknown {
    return JSON.parse(text) as unknown;
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
            title: 'observer records run-level failures with phase and reason details',
            async body(scope: OverkillScope) {
                const observer = createExecutionGlobalErrorObserver('in-process');

                await observer.runBoundary(async function runObservedBoundary() {
                    await observer.runPhase('collection', async function collectObservedBoundary() {
                        emitUnhandledRejectionReason('plain rejection');
                    });
                });

                const error = firstError(observer.takeErrors());

                scope.assert.equal(error.subtype, 'unhandled-rejection');
                scope.assert.equal(error.attributedTo, null);
                scope.assert.equal(error.attributedToWork, null);
                assertPlainRejectionCause(scope, error);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'observer classifies permission hook failures as permission errors',
            async body(scope: OverkillScope) {
                const observer = createExecutionGlobalErrorObserver('in-process');
                const testCase = createPlanCase('denies fs access');

                await observer.runBoundary(async function runObservedBoundary() {
                    await observer.runCase(testCase, async function runObservedCase() {
                        emitUnhandledRejectionReason(createPermissionError('FileSystemRead', '/project/input.txt'));
                    });
                });

                const error = firstError(observer.takeErrors());

                scope.assert.equal(error.subtype, 'permission');
                scope.assert.equal(error.attributedTo?.title, 'denies fs access');
                scope.assert.equal(error.message, 'Permission denied: FileSystemRead for /project/input.txt.');
                scope.assert.partialDeepEqual(error.cause, {
                    hook: 'unhandledRejection',
                    permission: 'FileSystemRead',
                    resource: '/project/input.txt',
                    source: 'throw'
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'observer serializes errors without stack traces',
            async body(scope: OverkillScope) {
                const observer = createExecutionGlobalErrorObserver('in-process');

                await observer.runBoundary(async function runObservedBoundary() {
                    emitUnhandledRejectionReason(createStacklessError('stackless rejection'));
                });

                const error = firstError(observer.takeErrors());

                scope.assert.partialDeepEqual(error.cause, {
                    reason: {
                        message: 'stackless rejection',
                        name: 'Error',
                        stack: null
                    }
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'observer reports ambiguous boundary ownership in isolated processes',
            async body(scope: OverkillScope) {
                const output = await runObserverScript(ambiguousBoundaryScript());

                scope.assert.equal(output.code, 0);
                scope.assert.equal(output.stderr, '');
                scope.assert.deepEqual(parseJson(output.stdout), [ 'attribution-drift', 'attribution-drift' ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'worker-pool host entrypoint reports fatal global hook failures',
            async body(scope: OverkillScope) {
                const output = await runObserverScript(hostFatalScript());

                scope.assert.equal(output.code, 0);
                scope.assert.equal(output.stderr, '');
                scope.assert.deepEqual(parseJson(output.stdout), [ 'runner-error', 'destroyed' ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'observer resolves fatal signals and unregisters fatal handlers',
            async body(scope: OverkillScope) {
                const observer = createExecutionGlobalErrorObserver('in-process');
                const fatalSignal = fatalSignalLabel(observer);
                const deliveryCount = await fatalHandlerDeliveryCount(observer);

                scope.assert.equal(await fatalSignal, 'fatal');
                scope.assert.equal(deliveryCount, 1);
                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'stopped observer ignores later hook failures',
            async body(scope: OverkillScope) {
                const observer = createExecutionGlobalErrorObserver('in-process');

                observer.stop();

                await observer.runBoundary(async function runStoppedBoundary() {
                    emitUnhandledRejection('ignored failure');
                });

                scope.assert.deepEqual(observer.takeErrors(), []);
                scope.assert.equal(observer.hasFatalError(), false);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'disabled observer preserves boundary calls without recording failures',
            async body(scope: OverkillScope) {
                const observer = createDisabledExecutionGlobalErrorObserver();
                const testCase = createPlanCase('disabled case');
                const removeFatalHandler = observer.onFatalError(function failOnFatalError() {
                    throw new Error('Disabled observer must not report fatal errors.');
                });

                const value = await observer.runBoundary(async function runDisabledBoundary() {
                    return await observer.runPhase('collection', async function runDisabledCollection() {
                        return await observer.runCase(testCase, async function runDisabledCase() {
                            return 'complete';
                        });
                    });
                });

                removeFatalHandler();
                observer.stop();

                scope.assert.equal(value, 'complete');
                scope.assert.equal(observer.hasFatalError(), false);
                scope.assert.deepEqual(observer.takeErrors(), []);

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
