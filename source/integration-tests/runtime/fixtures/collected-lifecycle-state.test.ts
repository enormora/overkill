import { type TestScope } from '@overkill-dev/test';

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
    calls: [],
    cleanupCount: 0,
    gate: null,
    mode: 'pass',
    scopes: [],
    notifyStarted() {
        return undefined;
    },
    raiseLateError() {
        return undefined;
    }
};
