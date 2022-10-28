import type { TestRunResult } from '../test-run-result.js';
import type { TestCaseResult } from '../test-case-executor.js';
import type { RealTimeReporter, FinalResultReporter } from './reporter.js';

interface RecordedReportEntry {
    readonly sessionId: number;
    readonly type: 'start' | 'progress' | 'done';
    readonly testRunResult: TestRunResult;
    readonly testCaseResult?: TestCaseResult;
}

interface InMemoryRealTimeReporter extends RealTimeReporter {
    getRecordedEntries(): readonly RecordedReportEntry[];
}

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
                },
            };
        },

        getRecordedEntries() {
            return recordedEntries;
        },
    };
}

interface InMemoryFinalResultReporter extends FinalResultReporter {
    getRecordedEntries(): readonly RecordedReportEntry[];
}

export function createInMemoryFinalResultReporter(): InMemoryFinalResultReporter {
    const recordedEntries: RecordedReportEntry[] = [];

    return {
        createSession(sessionId) {
            return {
                async report(testRunResult) {
                    recordedEntries.push({ sessionId, type: 'done', testRunResult });
                },
            };
        },

        getRecordedEntries() {
            return recordedEntries;
        },
    };
}

export type InMemoryReporter = InMemoryRealTimeReporter | InMemoryFinalResultReporter;
