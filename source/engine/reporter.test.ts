import assert from 'node:assert/strict';
import { registerTest } from '../test-support/register-test.ts';
import { type FinalResultReporter, type SinkDeclaration, validateReporterSinks } from './reporter.ts';

function createFinalReporter(name: string, sinks: readonly SinkDeclaration[]): FinalResultReporter {
    return {
        kind: 'final-result',
        name,
        onResult() {
            return undefined;
        },
        sinks
    };
}

registerTest('validateReporterSinks() allows shared standard output sinks', function () {
    validateReporterSinks([
        createFinalReporter('first', [ { conflictPolicy: 'shared', kind: 'stdout' } ]),
        createFinalReporter('second', [ { conflictPolicy: 'shared', kind: 'stdout' } ])
    ]);
});

registerTest('validateReporterSinks() rejects exclusive standard output conflicts', function () {
    assert.throws(
        function validateConflictingStandardOutputSinks() {
            validateReporterSinks([
                createFinalReporter('first', [ { conflictPolicy: 'exclusive', kind: 'stderr' } ]),
                createFinalReporter('second', [ { conflictPolicy: 'shared', kind: 'stderr' } ])
            ]);
        },
        { message: 'Reporter sink conflict: stderr is claimed exclusively.' }
    );
});

registerTest('validateReporterSinks() rejects exact file and directory path conflicts', function () {
    assert.throws(
        function validateConflictingPathSinks() {
            validateReporterSinks([
                createFinalReporter('first', [
                    { conflictPolicy: 'exclusive', kind: 'file', path: 'target/report' }
                ]),
                createFinalReporter('second', [
                    { conflictPolicy: 'exclusive', kind: 'directory', path: 'target/report' }
                ])
            ]);
        },
        { message: 'Reporter sink conflict: path "target/report" is claimed by multiple reporters.' }
    );
});

registerTest('validateReporterSinks() treats memory and stream sinks as private', function () {
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
});
