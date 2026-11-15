import type { PropertyWitnessFile } from '../engine/witness-file.ts';
import { emptyPropertyCorpus, type PropertyCorpusSnapshot } from '../engine/property-corpus.ts';
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
    readonly corpus: PropertyCorpusSnapshot;
    readonly reporters: readonly DefinedReporter[];
    readonly policy: PropertyPolicy;
    readonly execution: ExecuteExecution;
    readonly seed: bigint;
};

type IntegrationPropertyExecutionRequest = PropertyExecutionRequest & { readonly testFamily: 'integration'; };
type FamilyPropertyExecutionRequest = IntegrationPropertyExecutionRequest | PropertyExecutionRequest;

export const propertyExecutionDefaults: PropertyExecutionRequest = {
    corpus: emptyPropertyCorpus,
    reporters: [],
    policy: { ...defaultPropertyPolicy, newTrials: 3, maxAutomaticEdges: 0, maxExhaustiveValues: 0 },
    execution: { mode: 'serial-in-process' },
    seed: 42n
};

export const integrationPropertyExecutionDefaults = {
    ...propertyExecutionDefaults,
    testFamily: 'integration'
} as const;

function hasReplay(
    request: PropertyExecutionRequest
): request is PropertyExecutionRequest & { readonly replay: PropertyWitnessFile; } {
    return Object.hasOwn(request, 'replay');
}

function propertyFamily(request: FamilyPropertyExecutionRequest): 'integration' | 'property' {
    return Object.hasOwn(request, 'testFamily') ? 'integration' : 'property';
}

export async function executePropertyNode(
    node: TestNode,
    request: FamilyPropertyExecutionRequest | FamilyPropertyExecutionRequest & { readonly replay: PropertyWitnessFile; }
): Promise<RunResult> {
    const plan = resolveTestPlanCollectionPolicy(
        createTestPlan(createRoot({
            title: 'properties',
            annotations: {},
            controls: {},
            children: [ node ]
        })),
        {
            testFamily: propertyFamily(request),
            propertyPolicy: request.policy,
            timeoutMilliseconds: 1000
        }
    );
    return await createTestEngine().execute(plan, {
        debug: { mode: 'off' },
        execution: request.execution,
        propertyRun: {
            ...hasReplay(request) ? { replay: request.replay } : {},
            corpus: request.corpus,
            seed: request.seed,
            projectRoot: process.cwd()
        },
        reporters: request.reporters,
        retryPolicy: null,
        runFacts: {},
        startedAt: '2026-10-26T00:00:00.000Z'
    });
}
