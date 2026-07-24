import type { RunResult } from '../engine/run-result.ts';
import type { FinalResultReporter, RealTimeReporter, ReporterEvent } from '../engine/reporter.ts';

type RecordedReportEntry = {
    readonly event: ReporterEvent | null;
    readonly result: RunResult | null;
    readonly type: 'event' | 'finish' | 'result';
};

export type InMemoryRealTimeReporter = {
    readonly getRecordedEntries: () => readonly RecordedReportEntry[];
} & RealTimeReporter;

export type InMemoryFinalResultReporter = {
    readonly getRecordedEntries: () => readonly RecordedReportEntry[];
} & FinalResultReporter;

export type InMemoryReporterOptions = {
    readonly mode: 'final-result' | 'real-time';
};

export type InMemoryRealTimeReporterOptions = {
    readonly mode: 'real-time';
};

export type InMemoryFinalResultReporterOptions = {
    readonly mode: 'final-result';
};

export type InMemoryReporter = InMemoryFinalResultReporter | InMemoryRealTimeReporter;

function createRecordedEntries(): RecordedReportEntry[] {
    return [];
}

export function createInMemoryRealTimeReporter(): InMemoryRealTimeReporter {
    const recordedEntries = createRecordedEntries();

    return {
        dispose: null,
        kind: 'real-time',
        name: 'in-memory-real-time',
        sinks: [],

        async onEvent(event) {
            recordedEntries.push({ event, result: null, type: 'event' });
        },

        async onFinish(result) {
            recordedEntries.push({ event: null, result, type: 'finish' });
        },

        getRecordedEntries() {
            return recordedEntries;
        }
    };
}

export function createInMemoryFinalResultReporter(): InMemoryFinalResultReporter {
    const recordedEntries = createRecordedEntries();

    return {
        dispose: null,
        kind: 'final-result',
        name: 'in-memory-final-result',
        sinks: [],

        async onResult(result) {
            recordedEntries.push({ event: null, result, type: 'result' });
        },

        getRecordedEntries() {
            return recordedEntries;
        }
    };
}

export function createInMemoryReporter(
    options: InMemoryRealTimeReporterOptions
): InMemoryRealTimeReporter;
export function createInMemoryReporter(
    options: InMemoryFinalResultReporterOptions
): InMemoryFinalResultReporter;
export function createInMemoryReporter(options: InMemoryReporterOptions): InMemoryReporter {
    if (options.mode === 'real-time') {
        return createInMemoryRealTimeReporter();
    }

    return createInMemoryFinalResultReporter();
}
