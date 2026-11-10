import { AsyncLocalStorage } from 'node:async_hooks';
import { resolveSourceLocations } from '../assertion-protocol/source-location.ts';
import type { AssertionNode } from '../assertion-protocol/assertion-node.ts';
import type { SourceLocation } from '../assertion-protocol/assertion-node-shape.ts';
import { serializeValue, defaultSerializationBudget, type SerializedValue } from '../compare/serialized-value.ts';
import { currentSerializationBudget, withSerializationBudget } from '../compare/serialization-context.ts';
import { createStoredValue } from '../stored-value.ts';
import { workIdentityKey, type WorkId } from './identity.ts';
import type { DebugRecordingProvider, TestDebugPayload, TestDebugScope, TimelineEntry } from './test-debug.ts';
import { defaultAttachmentLimits } from './runtime-attachment.ts';

type ModuleObservation = TestDebugPayload['moduleLoads'][number];
type DebugBodyCompletion = { readonly kind: 'rejection'; readonly reason: unknown; } | { readonly kind: 'returned'; };
export type DebugTraceSnapshot = {
    readonly origin: bigint;
    readonly timeline: readonly TimelineEntry[];
    readonly moduleLoads: readonly ModuleObservation[];
    readonly overlappingWork: readonly WorkId[];
    readonly asserts: number;
    readonly requires: number;
    readonly declared: number | null;
    readonly dropped: number;
};
export type DebugAttempt = {
    readonly work: WorkId;
    readonly isOpen: () => boolean;
    readonly bodyOrigin: () => bigint | null;
    readonly close: () => void;
    readonly onCheckpoint: (notify: () => void) => void;
    readonly snapshot: () => DebugTraceSnapshot;
    readonly record: (kind: TimelineEntry['kind'], declared: number | null) => void;
    readonly assertion: (assertion: AssertionNode) => void;
    readonly completeBody: (completion: DebugBodyCompletion) => void;
    readonly module: (observation: ModuleObservation) => void;
    readonly includeRecording: (provider: DebugRecordingProvider) => void;
    readonly recordingProviders: () => readonly DebugRecordingProvider[];
    readonly overlap: (work: WorkId) => void;
    readonly retainValue: (value: unknown) => SerializedValue | null;
    readonly drop: (count: number) => void;
};
export const debugAttempts = new AsyncLocalStorage<DebugAttempt>();
const debugArtifactByteLimit = 10_485_760;
const terminalReserveBytes = 131_072;
const captureByteLimit = debugArtifactByteLimit - terminalReserveBytes;
const checkpointEntryCount = 64;
const providerMetadataBytes = 128;
const measurementCount = 5;
const nanosecondsPerMicrosecond = 1000;
function ignoreCheckpoint(): void {
    return undefined;
}
function serializeDebugValue(value: unknown, remaining: number): SerializedValue {
    const budget = currentSerializationBudget();
    const operandBytes = Math.max(0, Math.min(budget.operandBytes, defaultSerializationBudget.operandBytes, remaining));
    return withSerializationBudget({ ...budget, operandBytes }, function () {
        return serializeValue(value);
    });
}
function entryAt(kind: TimelineEntry['kind'], origin: bigint, declared: number | null): TimelineEntry {
    return {
        kind,
        declared,
        reason: null,
        label: null,
        sourceLocations: [],
        atNanoseconds: kind === 'body-start' ? '0' : (process.hrtime.bigint() - origin).toString()
    };
}
function snapshotLocation(location: SourceLocation): SourceLocation {
    return location.kind === 'unknown' ? { kind: 'unknown' } : {
        kind: 'known',
        file: location.file,
        line: location.line,
        column: location.column
    };
}
function assertionLocations(assertion: AssertionNode): TimelineEntry['sourceLocations'] {
    try {
        return resolveSourceLocations(assertion.sourceLocations).map(snapshotLocation);
    } catch {
        return [];
    }
}
export function createDebugAttempt(work: WorkId): DebugAttempt {
    const timeline: TimelineEntry[] = [];
    const moduleLoads: ModuleObservation[] = [];
    const providers: DebugRecordingProvider[] = [];
    const overlapping = new Map<string, WorkId>();
    const state = {
        origin: process.hrtime.bigint(),
        bodyStarted: false,
        open: true,
        bytes: 0,
        dropped: 0,
        asserts: 0,
        requires: 0,
        declared: createStoredValue<number | null>(null),
        checkpoint: ignoreCheckpoint
    };
    function reserve(bytes: number): boolean {
        if (state.bytes + bytes > captureByteLimit) {
            return false;
        }
        state.bytes += bytes;
        return true;
    }
    function count(kind: TimelineEntry['kind'], declared: number | null): void {
        if (kind === 'assert') {
            state.asserts += 1;
        } else if (kind === 'require') {
            state.requires += 1;
        } else if (kind === 'plan') {
            state.declared.write(declared);
        }
    }
    function retainTimeline(entry: TimelineEntry): void {
        if (!reserve(Buffer.byteLength(JSON.stringify(entry)))) {
            state.dropped += 1;
            return;
        }
        timeline.push(entry);
        if (timeline.length === 1 || timeline.length % checkpointEntryCount === 0) {
            state.checkpoint();
        }
    }
    return {
        work,
        isOpen() {
            return state.open;
        },
        bodyOrigin() {
            return state.bodyStarted ? state.origin : null;
        },
        close() {
            state.open = false;
        },
        onCheckpoint(notify) {
            state.checkpoint = notify;
        },
        snapshot() {
            return {
                origin: state.origin,
                timeline: Array.from(timeline),
                moduleLoads: Array.from(moduleLoads),
                overlappingWork: Array.from(overlapping.values()),
                asserts: state.asserts,
                requires: state.requires,
                declared: state.declared.read(),
                dropped: state.dropped
            };
        },
        record(kind, declared) {
            if (!state.open) {
                return;
            }
            if (kind === 'body-start' && timeline.length === 0) {
                state.origin = process.hrtime.bigint();
                state.bodyStarted = true;
            }
            count(kind, declared);
            retainTimeline(entryAt(kind, state.origin, declared));
        },
        assertion(assertion) {
            if (!state.open) {
                return;
            }
            count(assertion.source, null);
            retainTimeline({
                ...entryAt(assertion.source, state.origin, null),
                label: assertion.message ?? assertion.check,
                sourceLocations: assertionLocations(assertion)
            });
        },
        completeBody(completion) {
            if (!state.open) {
                return;
            }
            const entry: TimelineEntry = completion.kind === 'returned'
                ? entryAt('body-end', state.origin, null)
                : {
                    ...entryAt('rejection', state.origin, null),
                    reason: serializeDebugValue(completion.reason, terminalReserveBytes)
                };
            state.bytes += Buffer.byteLength(JSON.stringify(entry));
            timeline.push(entry);
        },
        module(observation) {
            if (!state.open) {
                return;
            }
            if (!reserve(Buffer.byteLength(JSON.stringify(observation)))) {
                state.dropped += 1;
                return;
            }
            moduleLoads.push(observation);
        },
        includeRecording(provider) {
            if (!state.open) {
                return;
            }
            if (providers.length >= defaultAttachmentLimits.maxScopeAttachments) {
                state.dropped += 1;
                return;
            }
            const bytes = Buffer.byteLength(JSON.stringify(provider.name)) + providerMetadataBytes;
            if (!reserve(bytes)) {
                state.dropped += 1;
                return;
            }
            providers.push({ name: provider.name, recorded: provider.recorded });
        },
        recordingProviders() {
            return Array.from(providers);
        },
        overlap(other) {
            const key = workIdentityKey(other);
            if (!state.open || key === workIdentityKey(work) || overlapping.has(key)) {
                return;
            }
            if (!reserve(Buffer.byteLength(JSON.stringify(other)) * measurementCount)) {
                state.dropped += 1;
                return;
            }
            overlapping.set(key, other);
        },
        retainValue(value) {
            const encoded = serializeDebugValue(value, captureByteLimit - state.bytes);
            return reserve(Buffer.byteLength(JSON.stringify(encoded))) ? encoded : null;
        },
        drop(dropped) {
            state.dropped += dropped;
        }
    };
}
export function recordDebugEntry(kind: TimelineEntry['kind'], declared: number | null): void {
    debugAttempts.getStore()?.record(kind, declared);
}
const inactiveScope: TestDebugScope = {
    includeRecording() {
        return undefined;
    }
};
export function currentTestDebugScope(): TestDebugScope {
    const attempt = debugAttempts.getStore();
    return attempt === undefined ? inactiveScope : { includeRecording: attempt.includeRecording };
}
export function debugBodyStarted(): void {
    recordDebugEntry('body-start', null);
}
type ObservedBodyCompletion = { readonly kind: 'interrupted' | 'returned'; } | {
    readonly kind: 'threw';
    readonly error: unknown;
};
export function debugBodyCompleted(completion: ObservedBodyCompletion): void {
    if (completion.kind === 'returned') {
        debugAttempts.getStore()?.completeBody({ kind: 'returned' });
        return;
    }
    const reason = completion.kind === 'threw'
        ? completion.error
        : new Error('Test body interrupted before completion.');
    debugAttempts.getStore()?.completeBody({ kind: 'rejection', reason });
}
export function recordDebugAssertion(assertion: AssertionNode): void {
    debugAttempts.getStore()?.assertion(assertion);
}
type DebugModuleOperation = {
    readonly phase: 'load' | 'resolve';
    readonly specifier: string;
    readonly resolvedUrl: string;
    readonly start: bigint;
};
export function captureDebugModule(attempt: DebugAttempt, operation: DebugModuleOperation): void {
    if (debugAttempts.getStore() !== attempt || !attempt.isOpen()) {
        return;
    }
    const origin = attempt.bodyOrigin();
    if (origin === null) {
        return;
    }
    attempt.module({
        phase: operation.phase,
        specifier: operation.specifier,
        resolvedUrl: operation.resolvedUrl,
        atNanoseconds: (operation.start - origin).toString(),
        durationMicroseconds: Number(process.hrtime.bigint() - operation.start) / nanosecondsPerMicrosecond
    });
}
