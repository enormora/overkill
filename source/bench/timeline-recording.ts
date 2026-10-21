import {
    PerformanceObserver as RuntimeObserver,
    performance as runtimePerformance,
    type PerformanceEntry as RuntimeEntry
} from 'node:perf_hooks';
import { setImmediate as nextTurn } from 'node:timers/promises';
import type {
    BenchmarkTimelineEvent,
    BenchmarkTimelineEvidence,
    BenchmarkTimelinePolicy
} from '../engine/benchmark-timeline.ts';
import {
    attachmentsForProducer,
    currentAttachmentLimits,
    defaultAttachmentLimits
} from '../packages/resources/attachment-context.entry-point.ts';
import { createStoredValue, type StoredValue } from '../stored-value.ts';
import type { TimelineRecording } from './timeline-context.ts';
import { benchmarkTimelineMediaType } from './timeline-report.ts';
import { microsecondsPerMillisecond } from './measurement-units.ts';

const envelopeBytes = 128;
const completionReserveBytes = 64;
type Invocation = Pick<BenchmarkTimelineEvent, 'phase' | 'sample'> & { readonly start: number; };
type TimelineCapture = {
    readonly origin: number;
    readonly policy: BenchmarkTimelinePolicy;
    readonly maximumBytes: number;
    readonly events: readonly BenchmarkTimelineEvent[];
    readonly invocations: readonly Invocation[];
    readonly appendEvent: (event: BenchmarkTimelineEvent) => void;
    readonly appendInvocation: (invocation: Invocation) => void;
    readonly progress: StoredValue<{
        readonly closed: boolean;
        readonly retained: boolean;
        readonly bytes: number;
        readonly omitted: number;
        readonly current: Pick<BenchmarkTimelineEvent, 'phase' | 'sample'>;
        readonly end: number | null;
    }>;
    readonly evidence: StoredValue<BenchmarkTimelineEvidence>;
};
type TimelineSession = TimelineRecording & { readonly close: () => void; };

function elapsed(capture: TimelineCapture): number {
    return runtimePerformance.now() * microsecondsPerMillisecond - capture.origin;
}

function append(capture: TimelineCapture, event: BenchmarkTimelineEvent): void {
    const progress = capture.progress.read();
    if (progress.closed) {
        return;
    }
    const size = Buffer.byteLength(JSON.stringify(event)) + completionReserveBytes;
    if (capture.events.length >= capture.policy.maximumEvents || progress.bytes + size > capture.maximumBytes) {
        capture.progress.write({ ...progress, omitted: progress.omitted + 1 });
    } else {
        capture.appendEvent(event);
        capture.progress.write({ ...progress, bytes: progress.bytes + size });
    }
}

function withinCapture(capture: TimelineCapture, time: number): boolean {
    const { end } = capture.progress.read();
    return time >= 0 && (end === null || time <= end);
}

function appendRuntimeEntry(capture: TimelineCapture, entry: RuntimeEntry): void {
    const startMicroseconds = entry.startTime * microsecondsPerMillisecond - capture.origin;
    const attribution = capture.invocations.findLast(function precedingInvocation(invocation) {
        return invocation.start <= startMicroseconds;
    });
    if (attribution !== undefined && withinCapture(capture, startMicroseconds)) {
        append(capture, {
            phase: attribution.phase,
            sample: attribution.sample,
            source: 'runtime',
            name: 'GC',
            clockDomain: 'runtime',
            startMicroseconds,
            durationMicroseconds: entry.duration * microsecondsPerMillisecond,
            outcome: 'complete'
        });
    }
}

function recordRuntimeEntries(capture: TimelineCapture, entries: readonly RuntimeEntry[]): void {
    for (const entry of entries) {
        appendRuntimeEntry(capture, entry);
    }
}

function snapshot(capture: TimelineCapture): BenchmarkTimelineEvidence {
    return { ...capture.evidence.read(), events: capture.events.length, omitted: capture.progress.read().omitted };
}

async function publish(capture: TimelineCapture): Promise<BenchmarkTimelineEvidence> {
    const evidence = snapshot(capture);
    if (currentAttachmentLimits() === null) {
        return { ...evidence, status: 'omitted', reason: 'No runner attachment coordinator is active.' };
    }
    const artifact = await attachmentsForProducer({ kind: 'case' }).json(
        { name: 'benchmark-timeline', mediaType: benchmarkTimelineMediaType },
        { version: 1, events: capture.events, omitted: evidence.omitted }
    );
    const unavailable = artifact.payload.content.kind === 'omitted';
    return {
        ...evidence,
        status: unavailable ? 'omitted' : 'recorded',
        reference: JSON.stringify(artifact.id),
        reason: unavailable ? artifact.payload.content.reason : null
    };
}

async function retain(capture: TimelineCapture, observer: RuntimeObserver): Promise<void> {
    const previous = capture.progress.read();
    if (previous.retained) {
        return;
    }
    capture.progress.write({ ...previous, retained: true, end: elapsed(capture) });
    await nextTurn();
    await nextTurn();
    recordRuntimeEntries(capture, observer.takeRecords());
    observer.disconnect();
    capture.progress.write({ ...capture.progress.read(), closed: true });
    capture.evidence.write(await publish(capture));
}

function createCapture(policy: BenchmarkTimelinePolicy): TimelineCapture {
    const limits = currentAttachmentLimits() ?? defaultAttachmentLimits;
    const events: BenchmarkTimelineEvent[] = [];
    const invocations: Invocation[] = [];
    return {
        policy,
        origin: runtimePerformance.now() * microsecondsPerMillisecond,
        maximumBytes: Math.min(limits.maxInlineBytes, limits.maxArtifactBytes),
        events,
        invocations,
        appendEvent(event) {
            events.push(event);
        },
        appendInvocation(invocation) {
            invocations.push(invocation);
        },
        progress: createStoredValue<ReturnType<TimelineCapture['progress']['read']>>({
            closed: false,
            retained: false,
            bytes: envelopeBytes,
            omitted: 0,
            current: { phase: 'warmup', sample: 0 },
            end: null
        }),
        evidence: createStoredValue<BenchmarkTimelineEvidence>({
            version: 1,
            events: 0,
            omitted: 0,
            status: 'pending',
            reference: null,
            reason: 'Timeline observations have not been persisted.'
        })
    };
}

export function createTimelineRecording(policy: BenchmarkTimelinePolicy): TimelineSession {
    const capture = createCapture(policy);
    const observer = new RuntimeObserver(function gcEntries(list) {
        recordRuntimeEntries(capture, list.getEntries());
    });
    observer.observe({ entryTypes: [ 'gc' ] });
    return {
        append(event) {
            append(capture, event);
        },
        elapsed() {
            return elapsed(capture);
        },
        attribution() {
            return capture.progress.read().current;
        },
        invocation(phase, sample) {
            capture.progress.write({ ...capture.progress.read(), current: { phase, sample } });
            if (capture.invocations.length < policy.maximumEvents) {
                capture.appendInvocation({ phase, sample, start: elapsed(capture) });
            }
        },
        evidence() {
            return snapshot(capture);
        },
        async retain() {
            await retain(capture, observer);
        },
        close() {
            observer.disconnect();
            capture.progress.write({ ...capture.progress.read(), closed: true });
        }
    };
}
