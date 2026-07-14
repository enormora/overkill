import { asyncNoop } from 'noop-esm';
import type { FinalResultReporter } from './reporter.ts';
import { createRunner } from './runner.ts';
import type { Suite } from './suite.ts';
import { createTestCaseExecutor } from './test-case-executor.ts';
import type { TestRunResult } from './test-run-result.ts';
import { createTestRunSessionProvider } from './test-run-session.ts';

function createSilentReporter(): FinalResultReporter {
    return {
        createSession() {
            return {
                report: asyncNoop
            };
        }
    };
}

export async function executeSuite(suite: Suite): Promise<TestRunResult> {
    const runner = createRunner({
        testRunSessionProvider: createTestRunSessionProvider({
            testCaseExecutor: createTestCaseExecutor({ timingApi: performance }),
            reporter: createSilentReporter()
        })
    });

    runner.addSuite(suite);

    return runner.runAll();
}
