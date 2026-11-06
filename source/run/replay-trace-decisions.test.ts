import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { placementPlan, fakeWorkerRuntime } from './worker-pool-placement-validation.test.ts';
import {
    createPlacementTraceRecorder,
    type PlacementTraceRecorder,
    type PlacementTrace,
    type DynamicWorkUnitId
} from './placement-trace.ts';
import type { PlacementPlan } from './run-types.ts';
import { compileReplayTrace } from './replay-trace-plan.ts';
import { createReplayDispatcher } from './replay-dispatcher.ts';

function twoLanePlan(): PlacementPlan {
    const original = placementPlan();
    const [ first ] = original.lanes;
    if (first === undefined) {
        throw new Error('Expected fixture lane.');
    }
    return {
        ...original,
        units: original.units.map(function hedgeSafe(unit) {
            return {
                ...unit,
                resourceConstraints: { ...unit.resourceConstraints, duplicateExecution: [ 'idempotent' ] as const }
            };
        }),
        lanes: [ first, { ...first, id: 'worker-2', executor: { ...first.executor, id: 'worker-2' } } ]
    };
}
function firstUnit(plan: PlacementPlan): PlacementPlan['units'][number] {
    const [ unit ] = plan.units;
    if (unit === undefined) {
        throw new Error('Expected fixture unit.');
    }
    return unit;
}
function batchedPlan(): PlacementPlan {
    const plan = twoLanePlan();
    const unit = firstUnit(plan);
    const work = unit.work[0];
    const second = {
        ...unit,
        id: { ...unit.id, key: 'second' },
        work: [ { ...work, case: { ...work.case, title: 'second' } } ] as const
    };
    return {
        ...plan,
        units: [ unit, second ],
        assignments: [ ...plan.assignments, { lane: 'worker-1', unit: second.id } ]
    };
}
function completeAttempt(
    trace: PlacementTraceRecorder,
    attempt: Parameters<PlacementTraceRecorder['startAttempt']>[0]
): void {
    trace.startAttempt(attempt, '1:1');
    trace.completeAttempt(attempt, 100);
}
function batchTrace(plan: PlacementPlan): PlacementTrace {
    const trace = createPlacementTraceRecorder();
    const attempts = plan.units.map(function assigned(unit) {
        return trace.assignAttempt(unit.id, unit.work, 'worker-1', { kind: 'initial' });
    });
    const [ first, ...rest ] = attempts;
    if (first === undefined) {
        throw new Error('Expected batch members.');
    }
    trace.recordDecision({
        kind: 'batch-started',
        lane: 'worker-1',
        envelopeId: 'recorded-batch',
        attempts: [ first, ...rest ]
    });
    for (const attempt of attempts) {
        completeAttempt(trace, attempt);
    }
    trace.recordDecision({
        kind: 'batch-completed',
        lane: 'worker-1',
        envelopeId: 'recorded-batch',
        attempts: [ first, ...rest ]
    });
    return trace.finish();
}
function assertBatch(scope: TestScope): void {
    const plan = batchedPlan();
    const lane = plan.lanes[0];
    scope.require.defined(lane);
    const dispatcher = createReplayDispatcher(fakeWorkerRuntime(plan), plan, {
        status: 'completed',
        placementTrace: batchTrace(plan)
    });
    const lease = dispatcher.pull(lane);
    scope.require.defined(lease);
    scope.assert.equal(lease.envelopeId, 'recorded-batch');
    scope.assert.deepEqual(
        lease.members.map(function work(member) {
            return member.unit.work;
        }),
        plan.units.map(function work(unit) {
            return unit.work;
        })
    );
}
function completeSplitChildren(
    trace: PlacementTraceRecorder,
    parent: PlacementPlan['units'][number],
    children: readonly DynamicWorkUnitId[]
): void {
    for (const [ index, child ] of children.entries()) {
        const work = parent.work[index];
        if (work === undefined) {
            throw new Error('Expected split work.');
        }
        completeAttempt(trace, trace.assignAttempt(child, [ work ], `worker-${index + 1}`, { kind: 'initial' }));
    }
}
function splitTrace(plan: PlacementPlan): PlacementTrace {
    const parent = firstUnit(plan);
    const children = [ { parent: parent.id, child: 'left' }, { parent: parent.id, child: 'right' } ] as const;
    const trace = createPlacementTraceRecorder();
    trace.recordDecision({ kind: 'unit-split', parent: parent.id, children });
    trace.recordDecision({
        kind: 'warm-lane-affinity-selected',
        lane: 'worker-1',
        baselineUnit: children[0],
        selectedUnit: children[0],
        candidateUnits: [ children[0] ],
        matchedWarmKeys: [ 'file' ],
        score: 1
    });
    completeSplitChildren(trace, parent, children);
    return trace.finish();
}
function assertSplit(scope: TestScope): void {
    const source = batchedPlan();
    const unit = firstUnit(source);
    const work = source.units.flatMap(function members(entry) {
        return entry.work;
    });
    const parent = { ...unit, work: [ unit.work[0], ...work.slice(1) ] as const };
    const plan = {
        ...source,
        units: [ parent ],
        assignments: [ source.assignments[0] ].filter(function present(value) {
            return value !== undefined;
        })
    };
    const compiled = compileReplayTrace(plan, { status: 'completed', placementTrace: splitTrace(plan) });
    scope.assert.deepEqual(
        Array.from(compiled.assignments.values(), function child(entry) {
            return entry.unit;
        }),
        [
            { parent: parent.id, child: 'left' },
            { parent: parent.id, child: 'right' }
        ]
    );
}
function hedgeTrace(plan: PlacementPlan): PlacementTrace {
    const unit = firstUnit(plan);
    const trace = createPlacementTraceRecorder();
    const primary = trace.assignAttempt(unit.id, unit.work, 'worker-1', { kind: 'initial' });
    const duplicate = trace.assignAttempt(unit.id, unit.work, 'worker-2', { kind: 'hedge', primaryAttempt: primary });
    completeAttempt(trace, duplicate);
    completeAttempt(trace, primary);
    trace.recordDecision({ kind: 'hedge-conflict', authoritativeAttempt: duplicate, conflictingAttempt: primary });
    return trace.finish();
}
function assertHedge(scope: TestScope): void {
    const plan = twoLanePlan();
    const compiled = compileReplayTrace(plan, { status: 'completed', placementTrace: hedgeTrace(plan) });
    scope.assert.equal(
        JSON.stringify(compiled.assignments.get('attempt-2')?.reason),
        JSON.stringify({ kind: 'hedge', primaryAttempt: 'attempt-1' })
    );
    scope.assert.equal(
        JSON.stringify(compiled.entries.at(-1)),
        JSON.stringify({ kind: 'hedge-conflict', authoritativeAttempt: 'attempt-2', conflictingAttempt: 'attempt-1' })
    );
}
function recoveryTrace(plan: PlacementPlan): PlacementTrace {
    const unit = firstUnit(plan);
    const trace = createPlacementTraceRecorder();
    const primary = trace.assignAttempt(unit.id, unit.work, 'worker-1', { kind: 'initial' });
    trace.startAttempt(primary, '1:1');
    trace.interruptAttempt(primary, 'worker-crash');
    trace.decideRecovery(primary, 'worker-crash', { kind: 'retry', retryWork: unit.work });
    completeAttempt(
        trace,
        trace.assignAttempt(unit.id, unit.work, 'worker-2', { kind: 'recovery', previousAttempt: primary })
    );
    return trace.finish();
}
function assertRecovery(scope: TestScope): void {
    const plan = twoLanePlan();
    const compiled = compileReplayTrace(plan, { status: 'completed', placementTrace: recoveryTrace(plan) });
    scope.assert.equal(compiled.assignments.get('attempt-2')?.lane, 'worker-2');
    scope.assert.equal(
        JSON.stringify(compiled.assignments.get('attempt-2')?.reason),
        JSON.stringify({ kind: 'recovery', previousAttempt: 'attempt-1' })
    );
}
export const testNode = suite(
    'dynamic replay decisions',
    [
        { title: 'batch envelopes', verify: assertBatch },
        { title: 'split parentage and warm affinity', verify: assertSplit },
        { title: 'hedged authority and conflicts', verify: assertHedge },
        { title: 'recovery reassignment', verify: assertRecovery }
    ]
        .map(function decision(entry) {
            return test(entry.title, function (scope: TestScope) {
                entry.verify(scope);
                return scope.assert.collect();
            });
        })
);
await runIfMain(import.meta, testNode);
