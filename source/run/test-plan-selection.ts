import type { TestPlan, RunResult } from '../packages/engine/engine.entry-point.ts';
import type { RunRequest } from './run-types.ts';
import { parseRunSelection } from './run-selection-schema.ts';
import { selectedTestPlan, orderedTestPlan } from './run-selection.ts';
import { shardedLocalCases } from './run-local-sharding.ts';
import { validateRunShard, validateRunSeed } from './run-validation.ts';
import { collectedRunPlanFromTestPlanCases, createRunResultFromCollectedPlan } from './collected-run-plan.ts';

export type TestPlanSelectionOptions = Pick<RunRequest, 'order' | 'seed' | 'selection' | 'shard'>;
export type TestPlanSelection = {
    readonly kind: 'empty-shard';
    readonly result: RunResult;
} | {
    readonly kind: 'selected';
    readonly testPlan: TestPlan;
};

function validateSelectionOptions(options: TestPlanSelectionOptions): void {
    validateRunShard(options);
    validateRunSeed(options);
    if (![ 'plan', 'lexical', 'seeded' ].includes(options.order)) {
        throw new TypeError('Unsupported test plan order.');
    }
    if (options.order === 'seeded' && options.seed.value === null) {
        throw new TypeError('Seeded ordering requires a resolved run seed.');
    }
}

export async function planTestSelection(plan: TestPlan, options: TestPlanSelectionOptions): Promise<TestPlanSelection> {
    const policy = {
        ...options,
        seed: { ...options.seed },
        shard: { ...options.shard },
        selection: parseRunSelection(options.selection)
    };
    validateSelectionOptions(policy);
    const selected = selectedTestPlan(plan, policy.selection);
    const cases = await shardedLocalCases(selected, policy.shard);
    const first = cases[0];
    if (first === undefined) {
        return {
            kind: 'empty-shard',
            result: createRunResultFromCollectedPlan(collectedRunPlanFromTestPlanCases(plan, []), [], [], {
                startedAtMicroseconds: 0,
                completedAtMicroseconds: 0,
                testExecutionWallTimeMicroseconds: 0,
                processUsage: null,
                planStatus: 'empty-shard'
            })
        };
    }
    return {
        kind: 'selected',
        testPlan: orderedTestPlan({ ...selected, cases: [ first, ...cases.slice(1) ] }, policy.order, policy.seed)
    };
}
