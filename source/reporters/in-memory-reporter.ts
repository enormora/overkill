import type { RunResult } from '../engine/run-result.ts';
import type {
    FinalResultReporter,
    LegacyReporter,
    RealTimeReporter,
    ReporterEvent
} from '../engine/reporter.ts';
import type { TestCaseResult } from '../engine/test-case-executor.ts';
import type { TestRunResult } from '../engine/test-run-result.ts';

type EventEntry = {
    readonly event: ReporterEvent | null;
    readonly result: RunResult | null;
    readonly type: 'event' | 'finish' | 'result';
};

type LegacyProgressEntry = {
    readonly sessionId: number;
    readonly testCaseResult: TestCaseResult;
    readonly testRunResult: TestRunResult;
    readonly type: 'progress';
};

type LegacySessionEntry = {
    readonly sessionId: number;
    readonly testRunResult: TestRunResult;
    readonly type: 'done' | 'report' | 'start';
};

type LegacyEntry = LegacyProgressEntry | LegacySessionEntry;

type RecordedReportEntry = EventEntry | LegacyEntry;

export type InMemoryReporter = {
    readonly getRecordedEntries: () => readonly RecordedReportEntry[];
} & LegacyReporter;

type InMemoryRealTimeReporter = InMemoryReporter & RealTimeReporter;

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

        createSession(sessionId) {
            return {
                async done(testRunResult: TestRunResult) {
                    recordedEntries.push({ sessionId, testRunResult, type: 'done' });
                },

                async progress(testRunResult: TestRunResult, testCaseResult: TestCaseResult) {
                    recordedEntries.push({ sessionId, testCaseResult, testRunResult, type: 'progress' });
                },

                async report(testRunResult: TestRunResult) {
                    recordedEntries.push({ sessionId, testRunResult, type: 'report' });
                },

                async start(testRunResult: TestRunResult) {
                    recordedEntries.push({ sessionId, testRunResult, type: 'start' });
                }
            };
        },

        getRecordedEntries() {
            return recordedEntries;
        }
    };
}

type InMemoryFinalResultReporter = FinalResultReporter & InMemoryReporter;

export function createInMemoryFinalResultReporter(): InMemoryFinalResultReporter {
    const recordedEntries: RecordedReportEntry[] = [];

    return {
        kind: 'final-result',
        name: 'in-memory-final-result',
        sinks: [],

        async onResult(result) {
            recordedEntries.push({ event: null, result, type: 'result' });
        },

        createSession(sessionId) {
            return {
                async report(testRunResult: TestRunResult) {
                    recordedEntries.push({ sessionId, testRunResult, type: 'done' });
                }
            };
        },

        getRecordedEntries() {
            return recordedEntries;
        }
    };
}
