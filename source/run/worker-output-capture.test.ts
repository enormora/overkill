import { suite, test } from '@overkill-dev/test';

import { workerOutput } from '../test-support/worker-output.ts';

export const testNode = suite('worker output capture', [
    test('forwards stream bytes and monotonic timestamps to the worker port', function (scope) {
        const fixture = workerOutput(scope.cleanup);
        const capture = fixture.capture.captureOutput(fixture.task, fixture.clock);
        fixture.streams.stdout.write('out');
        fixture.clock.advanceByMilliseconds(1);
        fixture.streams.stderr.write(Buffer.from('err'));
        capture.restore();
        scope.assert.deepEqual<unknown, unknown>(fixture.messages, [ {
            capturedAtMicroseconds: 0,
            chunk: Buffer.from('out'),
            kind: 'output',
            stream: 'stdout'
        }, { capturedAtMicroseconds: 1000, chunk: Buffer.from('err'), kind: 'output', stream: 'stderr' } ]);
        scope.assert.deepEqual({ stdout: fixture.stdout, stderr: fixture.stderr }, { stdout: [], stderr: [] });
        return scope.assert.collect();
    }),
    test('restores the original stream destinations', function (scope) {
        const fixture = workerOutput(scope.cleanup);
        const capture = fixture.capture.captureOutput(fixture.task, fixture.clock);
        fixture.streams.stdout.write('captured');
        capture.restore();
        fixture.streams.stdout.write('native');
        fixture.streams.stderr.write('diagnostic');
        scope.assert.deepEqual({ stdout: fixture.stdout, stderr: fixture.stderr }, {
            stdout: [ 'native' ],
            stderr: [ 'diagnostic' ]
        });
        scope.assert.equal(fixture.messages.length, 1);
        return scope.assert.collect();
    }),
    test('invokes callbacks for both supported write signatures', function (scope) {
        const fixture = workerOutput(scope.cleanup);
        const capture = fixture.capture.captureOutput(fixture.task, fixture.clock);
        const completed: (Error | null | undefined)[] = [];
        fixture.streams.stdout.write('first', function (error) {
            completed.push(error);
        });
        fixture.streams.stderr.write('second', 'utf8', function (error) {
            completed.push(error);
        });
        capture.restore();
        scope.assert.deepEqual(completed, [ null, null ]);
        return scope.assert.collect();
    }),
    test('suppresses output while acknowledging writes and restores it afterwards', function (scope) {
        const fixture = workerOutput(scope.cleanup);
        const capture = fixture.capture.suppressOutput();
        const completed: (Error | null | undefined)[] = [];
        fixture.streams.stdout.write('first', function (error) {
            completed.push(error);
        });
        fixture.streams.stderr.write('second', 'utf8', function (error) {
            completed.push(error);
        });
        capture.restore();
        fixture.streams.stdout.write('restored');
        scope.assert.deepEqual(completed, [ null, null ]);
        scope.assert.deepEqual({ stdout: fixture.stdout, stderr: fixture.stderr }, {
            stdout: [ 'restored' ],
            stderr: []
        });
        return scope.assert.collect();
    }),
    test('restores an enclosing capture after nested suppression', function (scope) {
        const fixture = workerOutput(scope.cleanup);
        const outer = fixture.capture.captureOutput(fixture.task, fixture.clock);
        const inner = fixture.capture.suppressOutput();
        fixture.streams.stdout.write('suppressed');
        inner.restore();
        fixture.streams.stdout.write('captured');
        outer.restore();
        scope.assert.equal(fixture.messages.length, 1);
        scope.assert.deepEqual(fixture.stdout, []);
        return scope.assert.collect();
    })
]);
