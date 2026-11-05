import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { placementPlan } from './worker-pool-placement-validation.test.ts';
import type { PlacementPlan } from './run-types.ts';
import type { PlacementTraceEntry } from './placement-trace.ts';
import { compileReplayTrace, type ReplayAssignment } from './replay-trace-plan.ts';
import { validateReplayPlacement } from './replay-placement-validation.ts';

type TraceFixture = {
    readonly plan: PlacementPlan;
    readonly unit: PlacementPlan['units'][number];
    readonly assignment: ReplayAssignment;
};
type InvalidTrace = {
    readonly title: string;
    readonly entries: (fixture: TraceFixture) => readonly PlacementTraceEntry[];
    readonly message: RegExp;
};
function traceFixture(): TraceFixture {
    const plan = placementPlan();
    const [ unit ] = plan.units;
    if (unit === undefined) {
        throw new Error('Expected fixture work.');
    }
    return {
        plan,
        unit,
        assignment: {
            kind: 'attempt-assigned',
            attempt: 'attempt-1',
            lane: 'worker-1',
            unit: unit.id,
            work: unit.work,
            reason: { kind: 'initial' }
        }
    };
}
function invalidTraces(): readonly InvalidTrace[] {
    return [
        {
            title: 'unknown assignment lane',
            entries({ assignment }) {
                return [ { ...assignment, lane: 'missing' } ];
            },
            message: /unknown unit or lane/u
        },
        {
            title: 'unknown assignment unit',
            entries({ assignment, unit }) {
                return [ { ...assignment, unit: { ...unit.id, key: 'missing' } } ];
            },
            message: /unknown unit or lane/u
        },
        {
            title: 'unknown split child',
            entries({ assignment, unit }) {
                return [ { ...assignment, unit: { parent: unit.id, child: 'missing' } } ];
            },
            message: /unknown split child/u
        },
        {
            title: 'duplicate assignment work',
            entries({ assignment }) {
                return [ { ...assignment, work: [ assignment.work[0], assignment.work[0] ] } ];
            },
            message: /duplicate or unrelated work/u
        },
        {
            title: 'unrelated assignment work',
            entries({ assignment }) {
                return [ {
                    ...assignment,
                    work: [ { ...assignment.work[0], case: { ...assignment.work[0].case, title: 'missing' } } ]
                } ];
            },
            message: /duplicate or unrelated work/u
        },
        {
            title: 'overlapping initial assignments',
            entries({ assignment }) {
                return [ assignment, { ...assignment, attempt: 'attempt-2' } ];
            },
            message: /initial assignments overlap/u
        },
        {
            title: 'unknown recovery predecessor',
            entries({ assignment }) {
                return [ { ...assignment, reason: { kind: 'recovery', previousAttempt: 'attempt-99' } } ];
            },
            message: /unknown or unrelated predecessor/u
        },
        {
            title: 'unsafe duplicate execution',
            entries({ assignment }) {
                return [ assignment, {
                    ...assignment,
                    attempt: 'attempt-2',
                    reason: { kind: 'hedge', primaryAttempt: 'attempt-1' }
                } ];
            },
            message: /duplication constraints/u
        },
        {
            title: 'inconsistent attempt sequence',
            entries({ assignment }) {
                return [ { ...assignment, attempt: 'attempt-2' } ];
            },
            message: /attempt identities are inconsistent/u
        },
        {
            title: 'unknown split parent',
            entries({ unit }) {
                const parent = { ...unit.id, key: 'missing' };
                return [ { kind: 'unit-split', parent, children: [ { parent, child: 'left' } ] } ];
            },
            message: /split has an unknown parent/u
        },
        {
            title: 'unrelated split child',
            entries({ unit }) {
                const parent = unit.id;
                return [ {
                    kind: 'unit-split',
                    parent,
                    children: [ { parent: { ...parent, key: 'missing' }, child: 'left' } ]
                } ];
            },
            message: /unrelated or duplicate child/u
        },
        {
            title: 'duplicate split children',
            entries({ unit }) {
                const parent = unit.id;
                const child = { parent, child: 'left' };
                return [ { kind: 'unit-split', parent, children: [ child, child ] } ];
            },
            message: /unrelated or duplicate child/u
        },
        {
            title: 'unknown batch attempt',
            entries() {
                return [ { kind: 'batch-started', lane: 'worker-1', envelopeId: 'batch', attempts: [ 'attempt-99' ] } ];
            },
            message: /incompatible or duplicate members/u
        },
        {
            title: 'duplicate batch members',
            entries({ assignment }) {
                return [ assignment, {
                    kind: 'batch-started',
                    lane: assignment.lane,
                    envelopeId: 'batch',
                    attempts: [ 'attempt-1', 'attempt-1' ]
                } ];
            },
            message: /incompatible or duplicate members/u
        },
        {
            title: 'batch completion without a start',
            entries({ assignment }) {
                return [ assignment, {
                    kind: 'batch-completed',
                    lane: assignment.lane,
                    envelopeId: 'batch',
                    attempts: [ 'attempt-1' ]
                } ];
            },
            message: /no matching batch/u
        },
        {
            title: 'unrelated hedge authority',
            entries({ assignment }) {
                return [ assignment, {
                    kind: 'hedge-conflict',
                    authoritativeAttempt: 'attempt-1',
                    conflictingAttempt: 'attempt-99'
                } ];
            },
            message: /unrelated attempts/u
        },
        {
            title: 'unknown crash lane',
            entries() {
                return [ { kind: 'worker-crashed', lane: 'missing', activeAttempt: null, workerId: null } ];
            },
            message: /unknown lane/u
        },
        {
            title: 'unrelated crashed attempt',
            entries() {
                return [ { kind: 'worker-crashed', lane: 'worker-1', activeAttempt: 'attempt-99', workerId: null } ];
            },
            message: /unrelated attempt/u
        },
        {
            title: 'unknown warm lane',
            entries({ unit }) {
                const { id } = unit;
                return [ {
                    kind: 'warm-lane-affinity-selected',
                    lane: 'missing',
                    baselineUnit: id,
                    selectedUnit: id,
                    candidateUnits: [ id ],
                    matchedWarmKeys: [ 'file' ],
                    score: 1
                } ];
            },
            message: /unknown lane/u
        },
        {
            title: 'unknown warm candidate',
            entries({ unit }) {
                const { id } = unit;
                return [ {
                    kind: 'warm-lane-affinity-selected',
                    lane: 'worker-1',
                    baselineUnit: id,
                    selectedUnit: id,
                    candidateUnits: [ { ...id, key: 'missing' } ],
                    matchedWarmKeys: [ 'file' ],
                    score: 1
                } ];
            },
            message: /unknown work/u
        }
    ];
}
type InvalidPlacement = {
    readonly title: string;
    readonly change: (fixture: TraceFixture) => PlacementPlan;
    readonly message: RegExp;
};
function invalidPlacements(): readonly InvalidPlacement[] {
    return [
        {
            title: 'duplicate placement lanes',
            change({ plan }) {
                return { ...plan, lanes: [ ...plan.lanes, ...plan.lanes ] };
            },
            message: /duplicate identities/u
        },
        {
            title: 'duplicate placement units',
            change({ plan }) {
                return { ...plan, units: [ ...plan.units, ...plan.units ] };
            },
            message: /duplicate identities/u
        },
        {
            title: 'duplicate placement assignments',
            change({ plan }) {
                return { ...plan, assignments: [ ...plan.assignments, ...plan.assignments ] };
            },
            message: /duplicate identities/u
        },
        {
            title: 'unknown placement lane',
            change({ plan }) {
                return {
                    ...plan,
                    assignments: plan.assignments.map(function (assignment) {
                        return { ...assignment, lane: 'missing' };
                    })
                };
            },
            message: /unknown assignments/u
        },
        {
            title: 'missing selected work',
            change({ plan }) {
                return { ...plan, units: [], assignments: [] };
            },
            message: /does not cover/u
        }
    ];
}
export const testNode = suite('invalid retained replay decisions', [
    ...invalidTraces().map(function invalidTrace(entry) {
        return test(entry.title, function (scope: TestScope) {
            const fixture = traceFixture();
            scope.assert.throws(function rejectInvalidTrace() {
                compileReplayTrace(fixture.plan, {
                    status: 'interrupted',
                    placementTrace: { entries: entry.entries(fixture) }
                });
            }, { message: entry.message });
            return scope.assert.collect();
        });
    }),
    ...invalidPlacements().map(function invalidPlacement(entry) {
        return test(entry.title, function (scope: TestScope) {
            const fixture = traceFixture();
            scope.assert.throws(function rejectInvalidPlacement() {
                validateReplayPlacement(entry.change(fixture), fixture.assignment.work);
            }, { message: entry.message });
            return scope.assert.collect();
        });
    })
]);
await runIfMain(import.meta, testNode);
