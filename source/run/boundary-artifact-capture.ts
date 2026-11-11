import { serializeValue } from '../compare/serialized-value.ts';
import type { StoredValue } from '../stored-value.ts';
import {
    createBoundaryFailureArtifact,
    artifactsForAttempt,
    type ActiveBoundaryWork,
    type BoundaryFailure,
    type BoundaryMetadata,
    type WorkerCrashArtifact
} from '../engine/run-artifact.ts';
import type { AttemptId, WorkId } from '../engine/identity.ts';
import { isTestDebugArtifact, type RunArtifact } from '../engine/run-result.ts';
import { mergeDebugArtifacts } from './debug-artifact-results.ts';

const nanosecondsPerMicrosecond = 1000;

export type SupervisedBoundaryMetadata = BoundaryMetadata & {
    readonly processUsageSamplingIntervalMilliseconds: number | null;
};
export type BoundaryArtifactCapture = {
    readonly forAttempt: (work: WorkId, attempt: AttemptId) => readonly RunArtifact[];
    readonly recordArtifact: (artifact: RunArtifact) => void;
    readonly recordFailure: (failure: BoundaryFailure) => void;
};

function isCapturedWorkerCrash(artifact: RunArtifact): artifact is WorkerCrashArtifact {
    return artifact.payload.kind === 'worker-crash' && artifact.source === 'boundary-captured';
}

function retainCrashExit(
    artifact: RunArtifact,
    failure: Extract<BoundaryFailure, { readonly kind: 'worker-crash'; }>
): RunArtifact {
    if (!isCapturedWorkerCrash(artifact)) {
        return artifact;
    }
    return {
        ...artifact,
        payload: {
            ...artifact.payload,
            exitCode: artifact.payload.exitCode ?? failure.exitCode,
            signal: artifact.payload.signal ?? failure.signal,
            coreDumpPath: artifact.payload.coreDumpPath ?? failure.coreDumpPath,
            nativeAddons: artifact.payload.nativeAddons ?? failure.nativeAddons
        }
    };
}

export function unknownBoundaryMetadata(): SupervisedBoundaryMetadata {
    const timestamp = new Date();
    return {
        workerId: null,
        nodeVersion: null,
        timestamp: timestamp.toISOString(),
        source: 'boundary-captured',
        processUsageSamplingIntervalMilliseconds: null
    };
}

export function createBoundaryArtifactCapture(
    artifacts: StoredValue<readonly RunArtifact[]>,
    metadata: () => SupervisedBoundaryMetadata,
    activeWork: () => readonly ActiveBoundaryWork[]
): BoundaryArtifactCapture {
    const observed = new Set<BoundaryFailure['kind']>();
    return {
        forAttempt(work, attempt) {
            return artifactsForAttempt(artifacts.read(), work, attempt);
        },
        recordFailure(failure) {
            if (observed.has(failure.kind) || observed.has('process-exhaustion')) {
                artifacts.write(
                    artifacts.read().map(function captureExit(artifact) {
                        return failure.kind === 'worker-crash' ? retainCrashExit(artifact, failure) : artifact;
                    })
                );
                return;
            }
            observed.add(failure.kind);
            const boundary = metadata();
            const evidence = failure.kind === 'process-exhaustion'
                ? {
                    ...failure,
                    processUsageSamplingIntervalMilliseconds: failure.processUsageSamplingIntervalMilliseconds ??
                        boundary.processUsageSamplingIntervalMilliseconds
                }
                : failure;
            artifacts.write([
                ...artifacts.read().map(function interruptDebug(artifact): RunArtifact {
                    if (
                        !isTestDebugArtifact(artifact) || artifact.source !== 'boundary-captured' ||
                        artifact.payload.verdict !== 'inconclusive'
                    ) {
                        return artifact;
                    }
                    return {
                        ...artifact,
                        source: 'boundary-captured',
                        payload: {
                            ...artifact.payload,
                            verdict: failure.kind === 'worker-crash' ? 'crashed' : 'process-exhausted',
                            outcome: null,
                            timeline: [ ...artifact.payload.timeline, {
                                kind: 'rejection',
                                atNanoseconds: BigInt(
                                    Math.floor(artifact.payload.durationMicroseconds * nanosecondsPerMicrosecond)
                                )
                                    .toString(),
                                declared: null,
                                label: null,
                                sourceLocations: [],
                                reason: serializeValue(failure)
                            } ]
                        }
                    };
                }),
                createBoundaryFailureArtifact(evidence, boundary, activeWork(), artifacts.read().length)
            ]);
        },
        recordArtifact(artifact) {
            if (artifact.payload.kind === 'debug' && artifact.id.scope.kind === 'case') {
                artifacts.write(mergeDebugArtifacts([ ...artifacts.read(), artifact ]));
                return;
            }
            if (artifact.payload.kind === 'worker-crash' || artifact.payload.kind === 'process-exhaustion') {
                if (observed.has(artifact.payload.kind)) {
                    return;
                }
                observed.add(artifact.payload.kind);
            }
            artifacts.write([ ...artifacts.read(), artifact ]);
        }
    };
}
