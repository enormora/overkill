import { stopPropertyExecution } from '../engine/property-execution-host.ts';
import type { TestPlanCase } from '../engine/test-plan.ts';
import type { CollectedRunCaseEntry } from './collected-run-plan.ts';

export function unavailableRuntimeCase(template: TestPlanCase, saved: CollectedRunCaseEntry): TestPlanCase {
    const reason = `Recorded runtime is unavailable: ${JSON.stringify(saved.workId.runtimes)}`;
    return {
        ...template,
        id: saved.id,
        workId: saved.workId,
        annotations: saved.testCase.annotations,
        controls: saved.testCase.controls,
        workloadParameters: saved.testCase.workloadParameters,
        resourceAttachments: { directResources: [], resourceGraph: [], runtimeGraphs: [] },
        execution: {
            kind: 'body',
            bodyMode: 'builder',
            body() {
                return stopPropertyExecution({
                    bodyError: null,
                    cleanupErrors: [],
                    contractFailures: [],
                    inconclusiveReason: reason,
                    requireFailed: false,
                    runnerErrors: [],
                    returnedAssertions: []
                });
            }
        }
    };
}
