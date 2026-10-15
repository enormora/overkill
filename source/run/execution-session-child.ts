import type { JsonValue } from 'type-fest';
import { createStoredValue } from '../stored-value.ts';
import type { RunResult, TestPlan } from './run-engine-primitives.ts';
import { withExecutionLifecycle } from './execution-session-lifecycle.ts';
import { collectedRunPlanFromTestPlan } from './collected-run-plan.ts';
import { selectedTestPlan } from './run-selection.ts';
import {
    supervisedAssignedPlan,
    type SupervisedAssignmentCommand,
    type SupervisedRunCommand
} from './supervised-protocol.ts';

export type ExecutionSessionPlanSelection = (
    plan: TestPlan,
    assignment: SupervisedAssignmentCommand
) => Promise<TestPlan>;

export async function completeSupervisedExecutionSession(
    command: Extract<SupervisedRunCommand, { readonly kind: 'run-session'; }>,
    sendData: (data: JsonValue) => void,
    execute: (select: ExecutionSessionPlanSelection) => Promise<RunResult>
): Promise<RunResult> {
    const data = createStoredValue<JsonValue>(null);
    try {
        return await withExecutionLifecycle(command.session, command.policy.moduleBoundary, async function (lifecycle) {
            try {
                return await execute(async function selectEligiblePlan(plan, assignment) {
                    const eligible = supervisedAssignedPlan(plan, assignment);
                    const selection = await lifecycle.select(collectedRunPlanFromTestPlan(eligible));
                    const selected = selectedTestPlan({ ...eligible, discoveredCases: eligible.cases }, selection);
                    await lifecycle.beforeCases();
                    return selected;
                });
            } finally {
                data.write(lifecycle.snapshot());
            }
        });
    } finally {
        sendData(data.read());
    }
}
