import { AsyncLocalStorage } from 'node:async_hooks';
import { types as runtimeTypes } from 'node:util';
import type {
    BenchmarkTimeline,
    BenchmarkTimelineEvent,
    BenchmarkTimelineEvidence
} from '../engine/benchmark-timeline.ts';

export type TimelineRecording = {
    readonly append: (event: BenchmarkTimelineEvent) => void;
    readonly elapsed: () => number;
    readonly evidence: () => BenchmarkTimelineEvidence;
    readonly retain: () => Promise<void>;
    readonly invocation: (phase: 'measured' | 'warmup', sample: number) => void;
    readonly attribution: () => Pick<BenchmarkTimelineEvent, 'phase' | 'sample'>;
};
export const timelineContext = new AsyncLocalStorage<TimelineRecording>();
type SpanCompletion = (outcome: BenchmarkTimelineEvent['outcome']) => void;
type TimelineSource = BenchmarkTimelineEvent['source'];

const invocationCounts = new WeakMap<TimelineRecording, { readonly warmup: number; readonly measured: number; }>();
export function beginTimelineInvocation(phase: 'measured' | 'warmup'): void {
    const recording = timelineContext.getStore();
    if (recording === undefined) {
        return;
    }
    const counts = invocationCounts.get(recording) ?? { warmup: 0, measured: 0 };
    const index = counts[phase];
    invocationCounts.set(recording, { ...counts, [phase]: index + 1 });
    recording.invocation(phase, index);
}

export function timelineMark(source: TimelineSource, name: string): void {
    const recording = timelineContext.getStore();
    if (recording !== undefined) {
        recording.append({
            ...recording.attribution(),
            source,
            name,
            clockDomain: 'runtime',
            startMicroseconds: recording.elapsed(),
            durationMicroseconds: null,
            outcome: 'complete'
        });
    }
}

function validateTimelineName(name: string): void {
    if (typeof name !== 'string' || name.trim().length === 0 || /\p{Cc}/v.test(name)) {
        throw new TypeError('Timeline names must be non-empty strings without control characters.');
    }
}

function beginSpan(recording: TimelineRecording, source: TimelineSource, name: string): SpanCompletion {
    const event = {
        ...recording.attribution(),
        source,
        name,
        startMicroseconds: recording.elapsed(),
        clockDomain: 'runtime',
        durationMicroseconds: null as number | null,
        outcome: 'incomplete' as BenchmarkTimelineEvent['outcome']
    };
    recording.append(event);
    return function finish(outcome) {
        event.durationMicroseconds = recording.elapsed() - event.startMicroseconds;
        event.outcome = outcome;
    };
}

async function completePromise<Value>(value: Promise<Value>, finish: SpanCompletion): Promise<Value> {
    try {
        const result = await value;
        finish('complete');
        return result;
    } catch (error: unknown) {
        finish('failed');
        throw error;
    }
}

function isPromise<Value>(value: Promise<Value> | Value): value is Promise<Value> {
    return runtimeTypes.isPromise(value);
}

function completeValue<Value>(value: Promise<Value> | Value, finish: SpanCompletion): Promise<Value> | Value {
    if (isPromise(value)) {
        return completePromise(value, finish);
    }
    finish('complete');
    return value;
}

export function timelineSpan<Value>(
    source: TimelineSource,
    name: string,
    operation: () => Promise<Value>
): Promise<Value>;
export function timelineSpan<Value>(source: TimelineSource, name: string, operation: () => Value): Value;
export function timelineSpan<Value>(
    source: TimelineSource,
    name: string,
    operation: () => Promise<Value> | Value
): Promise<Value> | Value {
    const recording = timelineContext.getStore();
    if (recording === undefined) {
        return operation();
    }
    validateTimelineName(name);
    const finish = beginSpan(recording, source, name);
    try {
        return completeValue(operation(), finish);
    } catch (error: unknown) {
        finish('failed');
        throw error;
    }
}

export const sampleTimeline: BenchmarkTimeline = Object.freeze({
    mark(name) {
        if (timelineContext.getStore() !== undefined) {
            validateTimelineName(name);
            timelineMark('authored', name);
        }
    },
    span<Value>(name: string, operation: () => Value): Value {
        return timelineSpan('authored', name, operation);
    }
});
