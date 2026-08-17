import { createDeterministicWallClock } from '@enormora/wall-clock';
import { createLineReporter as createOverkillLineReporter } from '@overkill-dev/reporter-line';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '@overkill-dev/engine';
import {
    createReporterDispatcher,
    type FinalResultReporter,
    type RealTimeReporter,
    ReporterSinkConflictError,
    type SinkDeclaration,
    validateReporterSinks
} from './reporter.ts';

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

export const testSuite = createOverkillSuite({
    name: 'source/engine/reporter.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            name: 'validateReporterSinks() allows shared standard output sinks',
            metadata: {},
            body(scope: OverkillScope) {
                validateReporterSinks([
                    createFinalReporter('first', [ { conflictPolicy: 'shared', kind: 'stdout' } ]),
                    createFinalReporter('second', [ { conflictPolicy: 'shared', kind: 'stdout' } ])
                ]);
                scope.assert.true(true, { message: 'shared stdout sinks are valid' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'validateReporterSinks() rejects exclusive standard output conflicts',
            metadata: {},
            body(scope: OverkillScope) {
                scope.assert.throws(function validateConflictingStandardOutputSinks() {
                    validateReporterSinks([
                        createFinalReporter('first', [ { conflictPolicy: 'exclusive', kind: 'stderr' } ]),
                        createFinalReporter('second', [ { conflictPolicy: 'shared', kind: 'stderr' } ])
                    ]);
                }, {
                    message: 'Reporter sink conflict: stderr is claimed exclusively.',
                    type: ReporterSinkConflictError
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'validateReporterSinks() rejects exact file and directory path conflicts',
            metadata: {},
            body(scope: OverkillScope) {
                scope.assert.throws(function validateConflictingPathSinks() {
                    validateReporterSinks([
                        createFinalReporter('first', [
                            { conflictPolicy: 'exclusive', kind: 'file', path: 'target/report' }
                        ]),
                        createFinalReporter('second', [
                            { conflictPolicy: 'exclusive', kind: 'directory', path: 'target/report' }
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
            name: 'validateReporterSinks() treats memory and stream sinks as private',
            metadata: {},
            body(scope: OverkillScope) {
                const stream = new WritableStream<unknown>();

                validateReporterSinks([
                    createFinalReporter('first', [
                        { conflictPolicy: 'shared', kind: 'memory' },
                        { conflictPolicy: 'exclusive', kind: 'stream', provided: stream }
                    ]),
                    createFinalReporter('second', [
                        { conflictPolicy: 'shared', kind: 'memory' },
                        { conflictPolicy: 'exclusive', kind: 'stream', provided: stream }
                    ])
                ]);
                scope.assert.true(true, { message: 'private sinks are valid' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'reporter dispatcher records direct runner-error delivery failures without notification',
            metadata: {},
            async body(scope: OverkillScope) {
                const wallClock = createDeterministicWallClock();
                const dispatcher = createReporterDispatcher({ wallClock });
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

                const errors = await dispatcher.reportEvent([ failingReporter ], {
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
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
