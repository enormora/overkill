import { createDeterministicWallClock } from '@enormora/wall-clock';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { defineFixedReporter } from '../test-support/reporter-definition.ts';
import {
    type FinalResultReporter,
    type Reporter,
    type ReporterEvent,
    type RealTimeReporter,
    ReporterSinkConflictError,
    type SinkDeclaration,
    validateReporterSinks
} from './reporter.ts';
import {
    createPlainOutputRenderer,
    type DefinedOutputRenderer,
    type OutputLineIntent
} from './reporter-output.ts';
import { createReporterDispatcher, type ReporterDispatcher } from './reporter-dispatcher.ts';
import type { RunnerError } from './run-result.ts';

const definitionLocation = { kind: 'unknown' as const };

function suiteStartEvent(title: string): Extract<ReporterEvent, { readonly kind: 'suite-start'; }> {
    return {
        kind: 'suite-start',
        suitePath: [ { definitionLocations: [ definitionLocation ], title } ]
    };
}

function createFinalReporter(name: string, sinks: readonly SinkDeclaration[]): FinalResultReporter {
    return {
        dispose: null,
        kind: 'final-result',
        name,
        onResult() {
            return undefined;
        },
        sinks
    };
}

type RecordingDispatcher = {
    readonly dispatcher: ReporterDispatcher;
    readonly stderrLines: readonly string[];
    readonly stdoutLines: readonly string[];
};

async function reportEvent(
    dispatcher: ReporterDispatcher,
    reporters: readonly Reporter[],
    event: ReporterEvent,
    outputRenderer: DefinedOutputRenderer = createPlainOutputRenderer()
): Promise<readonly RunnerError[]> {
    const delivery = await dispatcher.createDelivery(reporters.map(defineFixedReporter), outputRenderer);

    return await delivery.reportEvent(event);
}

function createRecordingDispatcher(): RecordingDispatcher {
    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];
    const wallClock = createDeterministicWallClock();

    function recordStderrLine(line: string): void {
        stderrLines.push(line);
    }

    function recordStdoutLine(line: string): void {
        stdoutLines.push(line);
    }

    const dispatcher = createReporterDispatcher({
        stderr: { writeLine: recordStderrLine },
        stdout: { writeLine: recordStdoutLine },
        wallClock
    });

    return {
        dispatcher,
        stderrLines,
        stdoutLines
    };
}

function ignoreOutputLine(): void {
    return undefined;
}

const stdoutPrimaryIntent: OutputLineIntent = {
    annotation: null,
    kind: 'stdout-line',
    role: 'primary',
    text: 'primary line'
};

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/engine/reporter.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'validateReporterSinks() allows managed supplemental standard output sinks',
            metadata: {},
            body(scope: OverkillScope) {
                validateReporterSinks([
                    createFinalReporter('first', [ { kind: 'stdout-managed-supplemental' } ]),
                    createFinalReporter('second', [ { kind: 'stdout-managed-supplemental' } ])
                ]);
                scope.assert.true(true, { message: 'managed supplemental stdout sinks are valid' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'validateReporterSinks() rejects raw standard output conflicts',
            metadata: {},
            body(scope: OverkillScope) {
                scope.assert.throws(function validateConflictingStandardOutputSinks() {
                    validateReporterSinks([
                        createFinalReporter('first', [ { kind: 'stderr-raw' } ]),
                        createFinalReporter('second', [ { kind: 'stderr-managed-supplemental' } ])
                    ]);
                }, {
                    message: 'Reporter sink conflict: stderr is claimed by incompatible reporters.',
                    type: ReporterSinkConflictError
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'validateReporterSinks() rejects duplicate managed primary standard output sinks',
            metadata: {},
            body(scope: OverkillScope) {
                scope.assert.throws(function validateConflictingManagedOutputSinks() {
                    validateReporterSinks([
                        createFinalReporter('first', [ { kind: 'stdout-managed-primary' } ]),
                        createFinalReporter('second', [ { kind: 'stdout-managed-primary' } ])
                    ]);
                }, {
                    message: 'Reporter sink conflict: stdout is claimed by incompatible reporters.',
                    type: ReporterSinkConflictError
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'validateReporterSinks() allows one managed primary with managed supplemental standard output sinks',
            metadata: {},
            body(scope: OverkillScope) {
                validateReporterSinks([
                    createFinalReporter('primary', [ { kind: 'stdout-managed-primary' } ]),
                    createFinalReporter('supplemental', [ { kind: 'stdout-managed-supplemental' } ])
                ]);
                scope.assert.true(true, { message: 'managed stdout primary and supplemental sinks are valid' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'validateReporterSinks() rejects exact file and directory path conflicts',
            metadata: {},
            body(scope: OverkillScope) {
                scope.assert.throws(function validateConflictingPathSinks() {
                    validateReporterSinks([
                        createFinalReporter('first', [
                            { kind: 'file', path: 'target/report' }
                        ]),
                        createFinalReporter('second', [
                            { kind: 'directory', path: 'target/report' }
                        ])
                    ]);
                }, {
                    message: 'Reporter sink conflict: path "target/report" is claimed by multiple reporters.',
                    type: ReporterSinkConflictError
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'validateReporterSinks() treats memory and stream sinks as private',
            metadata: {},
            body(scope: OverkillScope) {
                const stream = new WritableStream<unknown>();

                validateReporterSinks([
                    createFinalReporter('first', [
                        { kind: 'memory' },
                        { kind: 'stream', provided: stream }
                    ]),
                    createFinalReporter('second', [
                        { kind: 'memory' },
                        { kind: 'stream', provided: stream }
                    ])
                ]);
                scope.assert.true(true, { message: 'private sinks are valid' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'reporter dispatcher disposes reporters once',
            metadata: {},
            async body(scope: OverkillScope) {
                const { dispatcher } = createRecordingDispatcher();
                let disposeCount = 0;
                const reporter: FinalResultReporter = {
                    dispose() {
                        disposeCount += 1;
                    },
                    kind: 'final-result',
                    name: 'disposable',
                    onResult() {
                        return undefined;
                    },
                    sinks: []
                };
                const delivery = await dispatcher.createDelivery(
                    [ defineFixedReporter(reporter) ],
                    createPlainOutputRenderer()
                );

                scope.assert.deepEqual(await delivery.disposeReporters(), []);
                scope.assert.deepEqual(await delivery.disposeReporters(), []);
                scope.assert.equal(disposeCount, 1);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'reporter dispatcher records direct runner-error delivery failures without notification',
            metadata: {},
            async body(scope: OverkillScope) {
                const wallClock = createDeterministicWallClock();
                const dispatcher = createReporterDispatcher({
                    stderr: { writeLine: ignoreOutputLine },
                    stdout: { writeLine: ignoreOutputLine },
                    wallClock
                });
                const failingReporter: RealTimeReporter = {
                    dispose: null,
                    kind: 'real-time',
                    name: 'broken-runner-error',
                    onEvent(event) {
                        if (event.kind === 'runner-error') {
                            throw new Error('cannot render runner error');
                        }
                    },
                    onFinish: null,
                    sinks: []
                };

                const errors = await reportEvent(dispatcher, [ failingReporter ], {
                    error: {
                        attributedTo: null,
                        cause: new Error('original'),
                        message: 'original',
                        subtype: 'crash'
                    },
                    kind: 'runner-error'
                });

                scope.assert.deepEqual(
                    errors.map(function toMessage(error) {
                        return error.message;
                    }),
                    [ 'broken-runner-error: cannot render runner error' ]
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'reporter dispatcher records terminal runner-error notifications as delivered',
            metadata: {},
            async body(scope: OverkillScope) {
                const { dispatcher } = createRecordingDispatcher();
                const failingReporter: RealTimeReporter = {
                    dispose: null,
                    kind: 'real-time',
                    name: 'broken-event',
                    onEvent(event) {
                        if (event.kind === 'suite-start') {
                            throw new Error('cannot render event');
                        }
                    },
                    onFinish: null,
                    sinks: []
                };
                const terminalReporter: RealTimeReporter = {
                    dispose: null,
                    kind: 'real-time',
                    name: 'terminal',
                    onEvent() {
                        return undefined;
                    },
                    onFinish: null,
                    sinks: [ { kind: 'stdout-raw' } ]
                };
                const { deliveredRunnerErrors, result } = await dispatcher.trackRunnerErrorDelivery(
                    async function reportFailingEvent() {
                        return await reportEvent(
                            dispatcher,
                            [ failingReporter, terminalReporter ],
                            suiteStartEvent('suite')
                        );
                    }
                );

                scope.assert.deepEqual(
                    result.map(function toMessage(error) {
                        return error.message;
                    }),
                    [ 'broken-event: cannot render event' ]
                );
                scope.assert.deepEqual(deliveredRunnerErrors, result);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'reporter dispatcher records runner-error notification output failures',
            metadata: {},
            async body(scope: OverkillScope) {
                const { dispatcher } = createRecordingDispatcher();
                const failingReporter: RealTimeReporter = {
                    dispose: null,
                    kind: 'real-time',
                    name: 'broken-event',
                    onEvent() {
                        throw new Error('cannot render event');
                    },
                    onFinish: null,
                    sinks: []
                };
                const notifyingReporter: RealTimeReporter = {
                    dispose: null,
                    kind: 'real-time',
                    name: 'broken-notification-output',
                    onEvent(event: ReporterEvent) {
                        return event.kind === 'runner-error' ? [ stdoutPrimaryIntent ] : [];
                    },
                    onFinish: null,
                    sinks: []
                } as unknown as RealTimeReporter;

                const errors = await reportEvent(
                    dispatcher,
                    [ failingReporter, notifyingReporter ],
                    suiteStartEvent('suite')
                );

                scope.assert.deepEqual(
                    errors.map(function toMessage(error) {
                        return error.message;
                    }),
                    [
                        'broken-event: cannot render event',
                        'broken-notification-output: Reporter returned undeclared managed stdout output.'
                    ]
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'reporter dispatcher reports non-error failures',
            metadata: {},
            async body(scope: OverkillScope) {
                const { dispatcher } = createRecordingDispatcher();
                const failingReporter: RealTimeReporter = {
                    dispose: null,
                    kind: 'real-time',
                    name: 'broken-non-error',
                    async onEvent() {
                        const failure = Promise.withResolvers<never>();

                        failure.reject({
                            toString() {
                                return 'string failure';
                            }
                        });

                        return await failure.promise;
                    },
                    onFinish: null,
                    sinks: []
                };

                const errors = await reportEvent(
                    dispatcher,
                    [ failingReporter ],
                    suiteStartEvent('suite')
                );

                scope.assert.equal(errors[0]?.message, 'broken-non-error: string failure');

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
