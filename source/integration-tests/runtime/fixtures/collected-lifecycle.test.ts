import { suite, test } from '@overkill-dev/test';
import { increment } from './collected-subject.test.ts';
import { AsyncResource } from 'node:async_hooks';
import { state } from './collected-lifecycle-state.test.ts';

const metadata = { annotations: {}, controls: {} } as const;

function lifecycleCase(title: string) {
    return test({
        ...metadata,
        title,
        async body(scope) {
            state.raiseLateError = AsyncResource.bind(function rejectPreviousInvocation() {
                process.emit(
                    'unhandledRejection',
                    new Error('previous invocation rejection'),
                    Promise.resolve(undefined)
                );
            });
            state.notifyStarted();
            state.calls.push(title);
            state.scopes.push(scope);
            scope.cleanup(function countCleanup() {
                state.cleanupCount += 1;
                if (state.mode === 'cleanup-error') {
                    throw new Error('fixture cleanup failed');
                }
            });
            await state.gate;
            if (state.mode === 'timeout') {
                await new Promise(function waitForSoftTimeout(resolve) {
                    scope.signal.addEventListener('abort', function finishTimedOutBody() {
                        resolve(undefined);
                    }, { once: true });
                });
            }
            if (state.mode === 'no-assertions') {
                return scope.assert.collect();
            }
            scope.plan(1);
            if (state.mode === 'console') {
                console.log('fixture console violation');
            }
            if (state.mode === 'throw') {
                throw new Error('fixture body failed');
            }
            scope.assert.equal(increment(1), state.mode === 'fail' ? 0 : 2);
            return scope.assert.collect();
        }
    });
}

export const testNode = suite({
    ...metadata,
    title: 'lifecycle',
    children: [ lifecycleCase('first'), lifecycleCase('second') ]
});
