import { suite, test } from '@overkill-dev/test';

import { createLocalProcessOutput, type LocalProcessOutputWriters } from './local-process-output.ts';

type CapturedProcessOutput = LocalProcessOutputWriters & {
    readonly stdout: readonly string[];
    readonly stderr: readonly string[];
};
function capturedOutput(maximumBytes: number): CapturedProcessOutput {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const output = createLocalProcessOutput(maximumBytes, {
        stdout: {
            write(text) {
                stdout.push(text);
            },
            async close() {
                return undefined;
            }
        },
        stderr: {
            write(text) {
                stderr.push(text);
            },
            async close() {
                return undefined;
            }
        }
    });
    return { ...output, stdout, stderr };
}
export const testNode = suite('bounded process output', [
    test('retains only the newest bytes independently for each stream', function (scope) {
        const output = createLocalProcessOutput(5, { stdout: null, stderr: null });
        output.appendStdout(Buffer.from('remake'));
        output.appendStdout(Buffer.from('r'));
        output.appendStderr(Buffer.from('caretaker'));
        scope.assert.equal(output.output.stdout.text(), 'maker');
        scope.assert.equal(output.output.stderr.text(), 'taker');
        scope.assert.deepEqual(output.output.stdout.bytes(), new Uint8Array(Buffer.from('maker')));
        return scope.assert.collect();
    }),
    test('does not expose mutable backing buffers', function (scope) {
        const output = createLocalProcessOutput(5, { stdout: null, stderr: null });
        output.appendStdout(Buffer.from('estate'));
        const bytes = output.output.stdout.bytes();
        bytes.fill(0);
        scope.assert.equal(output.output.stdout.text(), 'state');
        scope.assert.true(Object.isFrozen(output.output));
        scope.assert.true(Object.isFrozen(output.output.stdout));
        return scope.assert.collect();
    }),
    test('supports a zero-byte tail without discarding capture text', function (scope) {
        const output = capturedOutput(0);
        output.appendStdout(Buffer.from('value'));
        output.appendStderr(Buffer.from('error'));
        scope.assert.equal(output.output.stdout.text(), '');
        scope.assert.equal(output.output.stderr.bytes().byteLength, 0);
        scope.assert.equal(output.stdout.join(''), 'value');
        scope.assert.equal(output.stderr.join(''), 'error');
        return scope.assert.collect();
    }),
    test('decodes split UTF-8 sequences before forwarding captures', function (scope) {
        const output = capturedOutput(8);
        const text = Buffer.from('😊');
        output.appendStdout(text.subarray(0, 2));
        output.appendStdout(text.subarray(2));
        output.appendStderr(text.subarray(0, 1));
        output.appendStderr(text.subarray(1));
        output.finishStdout();
        output.finishStderr();
        scope.assert.deepEqual({ stdout: output.stdout.join(''), stderr: output.stderr.join('') }, {
            stdout: '😊',
            stderr: '😊'
        });
        return scope.assert.collect();
    }),
    test('flushes incomplete UTF-8 sequences when streams end', function (scope) {
        const output = capturedOutput(8);
        output.appendStdout(Buffer.from([ 0xE2, 0x82 ]));
        output.appendStderr(Buffer.from([ 0xF0 ]));
        output.finishStdout();
        output.finishStderr();
        scope.assert.deepEqual({ stdout: output.stdout.join(''), stderr: output.stderr.join('') }, {
            stdout: '�',
            stderr: '�'
        });
        return scope.assert.collect();
    }),
    test('can finish incomplete streams with capture disabled', function (scope) {
        const output = createLocalProcessOutput(8, { stdout: null, stderr: null });
        output.appendStdout(Buffer.from([ 0xE2 ]));
        output.appendStderr(Buffer.from([ 0xF0 ]));
        output.finishStdout();
        output.finishStderr();
        scope.assert.equal(output.output.stdout.text(), '�');
        scope.assert.equal(output.output.stderr.text(), '�');
        return scope.assert.collect();
    })
]);
