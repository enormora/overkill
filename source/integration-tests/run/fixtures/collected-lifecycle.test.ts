import { createSuite, createTestCase, type TestScope } from '../../../packages/engine/engine.entry-point.ts';
import { increment } from './collected-subject.ts';
import { AsyncResource } from 'node:async_hooks';

const metadata = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;

export type LifecycleFixtureState = {
    calls: string[];
    cleanupCount: number;
    gate: Promise<void> | null;
    mode: 'cleanup-error' | 'console' | 'fail' | 'no-assertions' | 'pass' | 'throw' | 'timeout';
    scopes: TestScope[];
    notifyStarted: () => void;
    raiseLateError: () => void;
};

export const state: LifecycleFixtureState = {
    calls: [], cleanupCount: 0, gate: null, mode: 'pass', scopes: [],
    notifyStarted() { return undefined; },
    raiseLateError() { return undefined; }
};

function lifecycleCase(title: string) {
    return createTestCase({
        ...metadata,
        title,
        async body(scope) {
            state.raiseLateError = AsyncResource.bind(function rejectPreviousInvocation() {
                process.emit('unhandledRejection', new Error('previous invocation rejection'), Promise.resolve(undefined));
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
                    scope.signal.addEventListener('abort', function finishTimedOutBody() { resolve(undefined); }, { once: true });
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

export const testNode = createSuite({ ...metadata, title: 'lifecycle', children: [ lifecycleCase('first'), lifecycleCase('second') ] });
