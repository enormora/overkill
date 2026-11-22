import {
    createExecutionGlobalErrorObserver,
    type ExecutionGlobalErrorObserver
} from '../engine/execution-global-error-observer.ts';
import { withAnalysisDeadline } from './analysis-deadline.ts';
import { RunCollectionError } from './run-errors.ts';
import { preparedFamilyMetadata } from './prepared-family-plan.ts';
import { setFamilyCatalog } from './family-catalog.ts';
import {
    createProfileTestPlan,
    type LocalTestPlanInput as ProfilePlanInput,
    type LocalTestPlan as ProfilePlan
} from './profile-test-plan.ts';

export type LocalTestPlanInput = ProfilePlanInput;
export type LocalTestPlan = ProfilePlan;

function firstObservedCollectionError(observer: ExecutionGlobalErrorObserver): RunCollectionError {
    const [ error ] = observer.takeErrors();

    return new RunCollectionError(
        error?.message ?? 'Collection failed after a process-level runtime error.',
        { cause: error ?? null },
        error?.subtype ?? 'crash'
    );
}

async function waitForObservedCollectionError(observer: ExecutionGlobalErrorObserver): Promise<never> {
    await observer.fatalSignal();
    throw firstObservedCollectionError(observer);
}

export async function createLocalTestPlan(input: LocalTestPlanInput): Promise<LocalTestPlan> {
    const controller = new AbortController();
    const globalErrorObserver = createExecutionGlobalErrorObserver('in-process');
    try {
        return await globalErrorObserver.runBoundary(async function runObservedCollection() {
            if (
                typeof input.profile.testFamily !== 'string' &&
                input.profile.testFamily.features.execution === 'analysis'
            ) {
                try {
                    return await globalErrorObserver.runPhase('collection', async function prepareAnalysis() {
                        return await withAnalysisDeadline(
                            input.profile.timeouts.collectionMilliseconds,
                            'Analysis preparation exceeded collection timeout.',
                            async function prepare(signal) {
                                return await createProfileTestPlan(input, signal);
                            }
                        );
                    });
                } catch (error: unknown) {
                    throw new RunCollectionError(
                        error instanceof Error ? error.message : String(error),
                        { cause: error },
                        'loader'
                    );
                }
            }
            let rejectCollection: (error: RunCollectionError) => void = function ignoreReject() {
                return undefined;
            };
            const collectionTimeout = new Promise<never>(function rejectOnCollectionTimeout(_resolve, reject) {
                rejectCollection = reject;
            });
            const timeout = input.dependencies.wallClock.setTimeout(function failTimedOutCollection() {
                controller.abort();
                rejectCollection(
                    new RunCollectionError(
                        'Collection exceeded collection timeout.',
                        { cause: null },
                        'loader'
                    )
                );
            }, input.profile.timeouts.collectionMilliseconds);

            try {
                return await globalErrorObserver.runPhase('collection', async function collectObservedTestPlan() {
                    return await Promise.race([
                        createProfileTestPlan(input, controller.signal),
                        collectionTimeout,
                        waitForObservedCollectionError(globalErrorObserver)
                    ]);
                });
            } finally {
                input.dependencies.wallClock.clearTimeout(timeout);
            }
        });
    } catch (error: unknown) {
        controller.abort(error);
        throw error;
    } finally {
        globalErrorObserver.stop();
    }
}

export async function inspectLocalTestPlan(input: LocalTestPlanInput): Promise<LocalTestPlan['testPlan']> {
    const plan = await createLocalTestPlan(input);
    await using prepared = plan.preparation.prepared;
    const metadata = preparedFamilyMetadata(plan.preparation, { ...prepared.facts, collection: null });
    if (metadata !== null) {
        setFamilyCatalog(prepared.testPlan, metadata);
    }
    return prepared.testPlan;
}
