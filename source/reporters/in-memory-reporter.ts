import type { TestRunResult } from '../engine/test-run-result.ts';
import type { TestCaseResult } from '../engine/test-case-executor.ts';
import type { RealTimeReporter, FinalResultReporter } from '../engine/reporter.ts';

type RecordedReportEntry = {
    readonly sessionId: number;
    readonly type: 'done' | 'progress' | 'start';
    readonly testRunResult: TestRunResult;
    readonly testCaseResult?: TestCaseResult;
};

type InMemoryRealTimeReporter = {
    readonly getRecordedEntries: () => readonly RecordedReportEntry[];
} & RealTimeReporter;

export function createInMemoryRealTimeReporter(): InMemoryRealTimeReporter {
    const recordedEntries: RecordedReportEntry[] = [];

    return {
        createSession(sessionId) {
            return {
                async start(testRunResult) {
                    recordedEntries.push({ sessionId, type: 'start', testRunResult });
                },

                async progress(testRunResult, testCaseResult) {
                    recordedEntries.push({ sessionId, type: 'progress', testRunResult, testCaseResult });
                },

                async done(testRunResult) {
                    recordedEntries.push({ sessionId, type: 'done', testRunResult });
                }
            };
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
        createSession(sessionId) {
            return {
                async report(testRunResult) {
                    recordedEntries.push({ sessionId, type: 'done', testRunResult });
                }
            };
        },

        getRecordedEntries() {
            return recordedEntries;
        }
    };
}

export type InMemoryReporter = InMemoryFinalResultReporter | InMemoryRealTimeReporter;
