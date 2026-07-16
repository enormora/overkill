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

export function createInMemoryRealTimeReporter(): InMemoryRealTimeReporter {
    const recordedEntries: RecordedReportEntry[] = [];

    return {
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

type InMemoryFinalResultReporter = {
    readonly getRecordedEntries: () => readonly RecordedReportEntry[];
} & FinalResultReporter;

export function createInMemoryFinalResultReporter(): InMemoryFinalResultReporter {
    const recordedEntries: RecordedReportEntry[] = [];

    return {
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
