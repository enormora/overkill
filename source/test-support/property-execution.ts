import {
    createRoot,
    createTestPlan,
    type TestNode,
    type DefinedReporter,
    type PropertyPolicy,
    type ExecuteExecution,
    type RunResult
} from '../packages/engine/engine.entry-point.ts';
import { defaultPropertyPolicy } from '../config/property-policy.ts';
import { resolveTestPlanCollectionPolicy } from '../run/run-test-plan.ts';
import { createTestEngine } from './create-test-engine.ts';

type PropertyExecutionRequest = {
    readonly reporters: readonly DefinedReporter[];
    readonly policy: PropertyPolicy;
    readonly execution: ExecuteExecution;
    readonly seed: bigint;
};

export const propertyExecutionDefaults: PropertyExecutionRequest = {
    reporters: [],
    policy: { ...defaultPropertyPolicy, newTrials: 3, maxAutomaticEdges: 0, maxExhaustiveValues: 0 },
    execution: { mode: 'serial-in-process' },
    seed: 42n
};

export async function executePropertyNode(node: TestNode, request: PropertyExecutionRequest): Promise<RunResult> {
    const plan = resolveTestPlanCollectionPolicy(
        createTestPlan(createRoot({
            title: 'properties',
            annotations: {},
            controls: {},
            children: [ node ]
        })),
        { testFamily: 'property', propertyPolicy: request.policy, timeoutMilliseconds: 1000 }
    );
    return await createTestEngine().execute(plan, {
        execution: request.execution,
        propertyRun: { seed: request.seed, projectRoot: process.cwd() },
        reporters: request.reporters,
        retryPolicy: null,
        runFacts: {},
        startedAt: '2026-10-26T00:00:00.000Z'
    });
}
