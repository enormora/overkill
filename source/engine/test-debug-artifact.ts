import type { ExecuteCaseInput } from './case-attempt-context.ts';
import type { PerTestResult } from './run-result.ts';
import type { DebugTraceSnapshot, DebugAttempt } from './test-debug-recording.ts';
import type { DebugStats } from './test-debug.ts';
import type { TestDebugArtifact } from './run-artifact.ts';

export type DebugNativeSnapshot = {
    readonly heap: number | null;
    readonly resources: number | null;
    readonly cpu: number | null;
};
type DebugMeasurements = { readonly before: DebugNativeSnapshot; readonly after: DebugNativeSnapshot; };
type CheckpointEvidence = { readonly kind: 'checkpoint'; readonly before: DebugNativeSnapshot; };
type CompletedEvidence = {
    readonly kind: 'completed';
    readonly result: PerTestResult;
    readonly measurements: DebugMeasurements;
};
type DebugArtifactEvidence = CheckpointEvidence | CompletedEvidence;
type DebugPayload = TestDebugArtifact['payload'];
type Measurement = DebugPayload['cpuTimeMs'];
type ArtifactMeasurements = Pick<
    DebugPayload,
    'activeHandlesDelta' | 'cpuTimeMs' | 'heapAfterBytes' | 'heapBeforeBytes' | 'sampledHeapPeakBytes'
>;
type DebugVerdict = Pick<DebugPayload, 'durationMicroseconds' | 'outcome' | 'verdict'>;
type CompletionFacts = DebugVerdict & Pick<TestDebugArtifact, 'source'>;
const microsecondsPerMillisecond = 1000;
const nanosecondsPerMicrosecond = 1000;
const unavailable = {
    availability: 'unavailable' as const,
    reason: 'Not observable with native per-case attribution.'
};
const emptySnapshot: DebugNativeSnapshot = { heap: null, cpu: null, resources: null };
const emptyMeasurements: DebugMeasurements = { before: emptySnapshot, after: emptySnapshot };
function observe(read: () => number): number | null {
    try {
        return read();
    } catch {
        return null;
    }
}
export function debugNativeSnapshot(): DebugNativeSnapshot {
    return {
        heap: observe(function heap() {
            return process.memoryUsage().heapUsed;
        }),
        resources: observe(function resources() {
            return process.getActiveResourcesInfo().length;
        }),
        cpu: observe(function cpu() {
            const usage = process.threadCpuUsage();
            return usage.user + usage.system;
        })
    };
}
function delta(before: number | null, after: number | null): number | null {
    return before === null || after === null ? null : after - before;
}
function maximum(before: number | null, after: number | null): number | null {
    return before === null || after === null ? null : Math.max(before, after);
}
function cpuMilliseconds(window: DebugMeasurements): number | null {
    const elapsed = delta(window.before.cpu, window.after.cpu);
    return elapsed === null ? null : elapsed / microsecondsPerMillisecond;
}
function measurement(
    value: number | null,
    method: string,
    scope: 'process' | 'thread',
    trace: DebugTraceSnapshot
): Measurement {
    return value === null
        ? unavailable
        : { availability: 'available', value, method, scope, overlappingWork: trace.overlappingWork };
}
function observationWindow(input: ExecuteCaseInput, evidence: DebugArtifactEvidence): DebugMeasurements {
    if (input.testCase.execution.kind === 'skip') {
        return emptyMeasurements;
    }
    return evidence.kind === 'checkpoint' ? { before: evidence.before, after: emptySnapshot } : evidence.measurements;
}
function observedMeasurements(
    input: ExecuteCaseInput,
    evidence: DebugArtifactEvidence,
    trace: DebugTraceSnapshot
): ArtifactMeasurements {
    const window = observationWindow(input, evidence);
    return {
        cpuTimeMs: measurement(cpuMilliseconds(window), 'thread CPU delta over attempt window', 'thread', trace),
        heapBeforeBytes: measurement(window.before.heap, 'heapUsed at attempt start', 'thread', trace),
        heapAfterBytes: measurement(window.after.heap, 'heapUsed at attempt evidence', 'thread', trace),
        sampledHeapPeakBytes: measurement(
            maximum(window.before.heap, window.after.heap),
            'maximum of start/end samples',
            'thread',
            trace
        ),
        activeHandlesDelta: measurement(
            delta(window.before.resources, window.after.resources),
            'active resource count delta over the current event loop',
            'thread',
            trace
        )
    };
}
function attemptDuration(evidence: DebugArtifactEvidence, trace: DebugTraceSnapshot): number {
    return evidence.kind === 'checkpoint'
        ? Number(process.hrtime.bigint() - trace.origin) / nanosecondsPerMicrosecond
        : evidence.result.durationMicroseconds;
}
function evidenceFacts(evidence: DebugArtifactEvidence, trace: DebugTraceSnapshot): CompletionFacts {
    if (evidence.kind === 'checkpoint') {
        return {
            source: 'boundary-captured',
            verdict: 'inconclusive',
            outcome: null,
            durationMicroseconds: attemptDuration(evidence, trace)
        };
    }
    return {
        source: 'native',
        verdict: evidence.result.verdict,
        outcome: evidence.result.outcome?.kind ?? null,
        durationMicroseconds: evidence.result.durationMicroseconds
    };
}
function timeoutHeadroom(input: ExecuteCaseInput, evidence: DebugArtifactEvidence, duration: number): number | null {
    if (evidence.kind === 'checkpoint' || input.testCase.execution.kind === 'skip') {
        return null;
    }
    const timeout = input.options.timeoutPolicy;
    if (timeout === null || timeout === undefined) {
        return null;
    }
    return (input.testCase.controls.timeoutMilliseconds ?? timeout.timeoutMilliseconds) -
        duration / microsecondsPerMillisecond;
}
function handleGrowth(window: DebugMeasurements): number | null {
    const handles = delta(window.before.resources, window.after.resources);
    return handles === null ? null : Math.max(0, handles);
}
function statistics(
    input: ExecuteCaseInput,
    evidence: DebugArtifactEvidence,
    trace: DebugTraceSnapshot,
    recordings: DebugPayload['recordings']
): DebugStats {
    const window = observationWindow(input, evidence);
    return {
        assertCount: trace.asserts,
        requireCount: trace.requires,
        handleCallCount: recordings.reduce(function count(total, recording) {
            return total + recording.events.length;
        }, 0),
        moduleLoadCount: trace
            .moduleLoads
            .filter(function loaded(entry) {
                return entry.phase === 'load';
            })
            .length,
        uncachedModuleLoadCount: unavailable,
        unaccountedGapMs: unavailable,
        heapGrowthBytes: delta(window.before.heap, window.after.heap),
        handleLeakCount: handleGrowth(window),
        softTimeoutHeadroomMs: timeoutHeadroom(input, evidence, attemptDuration(evidence, trace))
    };
}
function completeness(
    evidence: DebugArtifactEvidence,
    trace: DebugTraceSnapshot,
    recordings: DebugPayload['recordings']
): DebugPayload['completeness'] {
    if (
        evidence.kind === 'checkpoint' || recordings.some(function failed(recording) {
            return recording.error !== null;
        })
    ) {
        return 'incomplete';
    }
    return trace.dropped > 0 ? 'truncated' : 'complete';
}
function recordedPlan(trace: DebugTraceSnapshot): DebugPayload['plan'] {
    return trace.declared === null ? null : { declared: trace.declared, recorded: trace.asserts + trace.requires };
}
export function createDebugArtifact(
    input: ExecuteCaseInput,
    attempt: DebugAttempt,
    evidence: DebugArtifactEvidence,
    recordings: DebugPayload['recordings']
): TestDebugArtifact {
    const trace = attempt.snapshot();
    const facts = evidenceFacts(evidence, trace);
    return {
        id: {
            scope: {
                kind: 'case',
                case: input.testCase.id,
                activeCases: [ input.testCase.id ],
                confidence: 'active-case'
            },
            attempt: { index: input.attempt },
            runtimes: input.testCase.workId.runtimes,
            workload: input.testCase.workId.workload,
            sequence: 0,
            subtype: 'debug'
        },
        source: facts.source,
        payload: {
            kind: 'debug',
            schemaVersion: 1,
            verdict: facts.verdict,
            outcome: facts.outcome,
            durationMicroseconds: facts.durationMicroseconds,
            timeline: trace.timeline,
            recordings,
            moduleLoads: trace.moduleLoads,
            ...observedMeasurements(input, evidence, trace),
            stats: statistics(input, evidence, trace, recordings),
            plan: recordedPlan(trace),
            completeness: completeness(evidence, trace, recordings),
            droppedEntries: trace.dropped
        }
    };
}
