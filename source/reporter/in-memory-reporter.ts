import type { SuiteResult } from '../suite';
import type { TestCaseResult } from '../test-case-executor';
import type { RealTimeReporter, FinalResultReporter } from './reporter';

interface RecordedReportEntry {
    readonly sessionId: number;
    readonly type: 'start' | 'progress' | 'done';
    readonly suiteResult: SuiteResult;
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
                async start(suiteResult) {
                    recordedEntries.push({ sessionId, type: 'start', suiteResult });
                },

                async progress(suiteResult, testCaseResult) {
                    recordedEntries.push({ sessionId, type: 'progress', suiteResult, testCaseResult });
                },

                async done(suiteResult) {
                    recordedEntries.push({ sessionId, type: 'done', suiteResult });
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
                async report(suiteResult) {
                    recordedEntries.push({ sessionId, type: 'done', suiteResult });
                },
            };
        },

        getRecordedEntries() {
            return recordedEntries;
        },
    };
}

export type InMemoryReporter = InMemoryRealTimeReporter | InMemoryFinalResultReporter;
