import { withModuleLoadingScope, type ModuleLoadingHooks } from '../module-loading-scope.ts';
import { startDebugCheckpoints } from './debug-checkpoints.ts';
import { workIdentityKey } from './identity.ts';
import { observeActiveCaseWork } from './execution-global-error-observer.ts';
import { recordExecutionArtifact } from './execution-observation.ts';
import { createDebugArtifact, debugNativeSnapshot, type DebugNativeSnapshot } from './test-debug-artifact.ts';
import { captureDebugModule, createDebugAttempt, debugAttempts, type DebugAttempt } from './test-debug-recording.ts';
import type { ExecuteCaseInput } from './case-attempt-context.ts';
import type { PerTestResult } from './run-result.ts';
import { debugFailure, readRecordings } from './test-debug-providers.ts';

type DebugCapture = { readonly before: DebugNativeSnapshot; readonly stop: () => Promise<void>; };
const active = new Set<DebugAttempt>();
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
    const stopObservingWork = observeActiveCaseWork(attempt.overlap);
    active.add(attempt);
    const stopCheckpoints = startDebugCheckpoints({
        clock: input.context.dependencies.wallClock,
        attempt,
        async report() {
            await reportCheckpoint(input, attempt, before);
        },
        failed(error) {
            input.supervision.recordRunnerError(debugFailure(input, error, 'Debug checkpoint delivery failed.'));
        }
    });
    return {
        before,
        async stop() {
            active.delete(attempt);
            stopObservingWork();
            await stopCheckpoints();
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
