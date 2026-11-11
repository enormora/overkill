import { setInterval as scheduleCheckpoints, clearInterval as stopCheckpoints } from 'node:timers';
import { withModuleLoadingScope, type ModuleLoadingHooks } from '../module-loading-scope.ts';
import { observeActiveCaseWork } from './execution-global-error-observer.ts';
import { recordExecutionArtifact, withRunnerInfrastructure } from './execution-observation.ts';
import { workIdentityKey } from './identity.ts';
import { createDebugArtifact, debugNativeSnapshot, type DebugNativeSnapshot } from './test-debug-artifact.ts';
import { captureDebugModule, createDebugAttempt, debugAttempts, type DebugAttempt } from './test-debug-recording.ts';
import type { ExecuteCaseInput } from './case-attempt-context.ts';
import type { PerTestResult } from './run-result.ts';
import { debugFailure, readRecordings } from './test-debug-providers.ts';

type DebugCapture = { readonly before: DebugNativeSnapshot; readonly stop: () => Promise<void>; };
const active = new Set<DebugAttempt>();
const checkpointIntervalMilliseconds = 50;
function createAttempt(input: ExecuteCaseInput): DebugAttempt {
    const attempt = createDebugAttempt(input.testCase.workId);
    for (const current of active) {
        attempt.overlap(current.work);
        current.overlap(attempt.work);
    }
    return attempt;
}
function moduleHooks(attempt: DebugAttempt): ModuleLoadingHooks {
    return {
        resolve(specifier, _parentURL, nextResolve) {
            const start = process.hrtime.bigint();
            const resolved = nextResolve();
            captureDebugModule(attempt, { phase: 'resolve', specifier, resolvedUrl: resolved.url, start });
            return resolved;
        },
        load(url, nextLoad) {
            const start = process.hrtime.bigint();
            const loaded = nextLoad();
            captureDebugModule(attempt, { phase: 'load', specifier: url, resolvedUrl: url, start });
            return loaded;
        }
    };
}
async function reportCheckpoint(
    input: ExecuteCaseInput,
    attempt: DebugAttempt,
    before: DebugNativeSnapshot
): Promise<void> {
    const errors = await input.context.reporterDelivery.reportEvent({
        kind: 'debug-checkpoint',
        artifact: createDebugArtifact(input, attempt, { kind: 'checkpoint', before }, [])
    });
    for (const error of errors) {
        input.supervision.recordRunnerError(error);
    }
}
function beginCapture(input: ExecuteCaseInput, attempt: DebugAttempt): DebugCapture {
    const before = debugNativeSnapshot();
    let pending: Promise<void> | null = null;
    const stopObservingWork = observeActiveCaseWork(attempt.overlap);
    async function deliverCheckpoint(): Promise<void> {
        try {
            await reportCheckpoint(input, attempt, before);
        } catch (error: unknown) {
            input.supervision.recordRunnerError(debugFailure(input, error, 'Debug checkpoint delivery failed.'));
        } finally {
            pending = null;
        }
    }
    function checkpoint(): void {
        if (pending !== null || !attempt.isOpen()) {
            return;
        }
        pending = deliverCheckpoint();
    }
    active.add(attempt);
    attempt.onCheckpoint(checkpoint);
    const timer = withRunnerInfrastructure(function () {
        return scheduleCheckpoints(checkpoint, checkpointIntervalMilliseconds);
    });
    timer.unref();
    return {
        before,
        async stop() {
            attempt.close();
            active.delete(attempt);
            stopObservingWork();
            stopCheckpoints(timer);
            const delivery = pending;
            if (delivery !== null) {
                await delivery;
            }
        }
    };
}
function selectedForDebug(input: ExecuteCaseInput): boolean {
    const selection = input.options.debug;
    if (selection.mode !== 'selected') {
        return selection.mode === 'all';
    }
    return selection.work.some(function selected(work) {
        return workIdentityKey(work) === workIdentityKey(input.testCase.workId);
    });
}
export async function withDebugAttempt<Value>(
    input: ExecuteCaseInput,
    operation: () => Promise<Value>,
    result: (value: Value) => PerTestResult
): Promise<Value> {
    if (!selectedForDebug(input)) {
        return await operation();
    }
    const attempt = createAttempt(input);
    return await withModuleLoadingScope(moduleHooks(attempt), async function captureAttempt() {
        const capture = beginCapture(input, attempt);
        try {
            return await debugAttempts.run(attempt, async function observeAttempt() {
                const value = await operation();
                await capture.stop();
                const after = debugNativeSnapshot();
                const recordings = await readRecordings(input, attempt);
                recordExecutionArtifact(
                    createDebugArtifact(input, attempt, {
                        kind: 'completed',
                        result: result(value),
                        measurements: { before: capture.before, after }
                    }, recordings)
                );
                return value;
            });
        } finally {
            await capture.stop();
        }
    });
}
