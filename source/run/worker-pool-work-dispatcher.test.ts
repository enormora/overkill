import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { workIdentityKey } from '../engine/identity.ts';
import type { DynamicWorkUnitId, PlacementTraceEntry } from './placement-trace.ts';
import type { PlacementPlan } from './run-types.ts';
import {
    fakeWorkerRuntime,
    placementPlan,
    testCaseMetadata
} from './worker-pool-placement-validation.test.ts';
import { createWorkDispatcher } from './worker-pool-work-dispatcher.ts';
import type {
    WorkerPoolUnitLease,
    WorkerPoolWorkDispatcher
} from './worker-pool-dispatch-state.ts';
import {
    originalQueueItem,
    splitQueuedWorkUnit
} from './worker-pool-pending-splitting.ts';

type WorkUnit = PlacementPlan['units'][number];
type PlacementLane = PlacementPlan['lanes'][number];
type NoSplitVariant = {
    readonly plan: PlacementPlan;
    readonly title: string;
};
type SplitLeaseExpectation = {
    readonly firstLease: WorkerPoolUnitLease;
    readonly secondLease: WorkerPoolUnitLease;
    readonly traceEntry: Extract<PlacementTraceEntry, { readonly kind: 'unit-split'; }>;
    readonly unit: WorkUnit;
};
function firstLane(plan: PlacementPlan): PlacementLane {
    const lane = plan.lanes[0];

    if (lane === undefined) {
        throw new Error('Worker-pool dispatcher fixture requires a lane.');
    }

    return lane;
}

function secondLane(plan: PlacementPlan): PlacementLane {
    const lane = plan.lanes[1];

    if (lane === undefined) {
        throw new Error('Worker-pool dispatcher fixture requires a second lane.');
    }

    return lane;
}

function firstUnit(plan: PlacementPlan): WorkUnit {
    const unit = plan.units[0];

    if (unit === undefined) {
        throw new Error('Worker-pool dispatcher fixture requires a work unit.');
    }

    return unit;
}

function constrainedUnit(unit: WorkUnit): WorkUnit {
    return {
        ...unit,
        resourceConstraints: {
            ...unit.resourceConstraints,
            faultDomains: [ 'rack' ],
            singleWorkerKeys: [ 'database' ]
        }
    };
}

function workerLane(id: string): PlacementLane {
    const lane = firstLane(placementPlan());

    return {
        ...lane,
        executor: {
            ...lane.executor,
            id
        },
        id
    };
}

function secondWork(unit: WorkUnit): WorkUnit['work'][number] {
    const work = unit.work[0];

    return {
        ...work,
        case: {
            ...work.case,
            title: 'second'
        }
    };
}

function firstWork(unit: WorkUnit): WorkUnit['work'][number] {
    return unit.work[0];
}

function multiWorkUnit(): WorkUnit {
    const unit = firstUnit(placementPlan());

    return {
        ...unit,
        scheduling: 'concurrent',
        work: [ firstWork(unit), secondWork(unit) ]
    };
}

function twoLanePlan(unit: WorkUnit): PlacementPlan {
    const first = workerLane('worker-1');
    const second = workerLane('worker-2');

    return {
        assignments: [ { lane: first.id, unit: unit.id } ],
        lanes: [ first, second ],
        units: [ unit ]
    };
}

function splitCandidatePlan(unit: WorkUnit): PlacementPlan {
    const first = workerLane('worker-1');
    const second = workerLane('worker-2');
    const filler: WorkUnit = {
        ...firstUnit(placementPlan()),
        id: {
            ...unit.id,
            key: 'filler'
        },
        scheduling: 'concurrent' as const,
        work: [
            {
                ...firstWork(unit),
                case: {
                    ...firstWork(unit).case,
                    title: 'filler'
                }
            }
        ]
    };

    return {
        assignments: [
            { lane: first.id, unit: unit.id },
            { lane: second.id, unit: filler.id }
        ],
        lanes: [ first, second ],
        units: [ unit, filler ]
    };
}

function oneLanePlan(unit: WorkUnit): PlacementPlan {
    const first = workerLane('worker-1');

    return {
        assignments: [ { lane: first.id, unit: unit.id } ],
        lanes: [ first ],
        units: [ unit ]
    };
}

function singleWorkUnit(key: string, title: string, workerLifecycle: WorkUnit['workerLifecycle']): WorkUnit {
    const unit = firstUnit(placementPlan());

    return {
        ...unit,
        id: {
            ...unit.id,
            key
        },
        scheduling: 'concurrent',
        workerLifecycle,
        work: [
            {
                ...firstWork(unit),
                case: {
                    ...firstWork(unit).case,
                    title
                }
            }
        ]
    };
}

function batchingPlan(workerLifecycle: WorkUnit['workerLifecycle']): PlacementPlan {
    const first = workerLane('worker-1');
    const firstUnitCandidate = singleWorkUnit('first', 'first', workerLifecycle);
    const secondUnitCandidate = singleWorkUnit('second', 'second', workerLifecycle);

    return {
        assignments: [
            { lane: first.id, unit: firstUnitCandidate.id },
            { lane: first.id, unit: secondUnitCandidate.id }
        ],
        lanes: [ first ],
        units: [ firstUnitCandidate, secondUnitCandidate ]
    };
}

function isDynamicWorkUnitId(value: unknown): value is DynamicWorkUnitId {
    return value !== null &&
        typeof value === 'object' &&
        Object.hasOwn(value, 'child') &&
        Object.hasOwn(value, 'parent');
}

function dynamicWorkUnitId(value: unknown): DynamicWorkUnitId {
    if (isDynamicWorkUnitId(value)) {
        return value;
    }

    throw new Error('Expected a dynamic work-unit id.');
}

function unitSplitEntry(entry: PlacementTraceEntry | undefined): Extract<PlacementTraceEntry, {
    readonly kind: 'unit-split';
}> {
    if (entry?.kind === 'unit-split') {
        return entry;
    }

    throw new Error('Expected a unit-split trace entry.');
}

function noSplitVariants(): readonly NoSplitVariant[] {
    const unit = multiWorkUnit();

    return [
        {
            plan: oneLanePlan(unit),
            title: 'one lane'
        },
        {
            plan: twoLanePlan({ ...unit, id: { ...unit.id, mode: 'group' } }),
            title: 'group unit'
        },
        {
            plan: twoLanePlan({ ...unit, scheduling: 'serial' }),
            title: 'serial scheduling'
        },
        {
            plan: twoLanePlan({ ...unit, workerLifecycle: 'fresh-worker-per-unit' }),
            title: 'fresh worker lifecycle'
        },
        {
            plan: twoLanePlan({
                ...unit,
                resourceConstraints: { ...unit.resourceConstraints, serialKeys: [ 'serial:database' ] }
            }),
            title: 'serial key'
        },
        {
            plan: twoLanePlan({
                ...unit,
                resourceConstraints: { ...unit.resourceConstraints, singleWorkerKeys: [ 'single-worker:database' ] }
            }),
            title: 'single worker key'
        }
    ];
}

function retainedReservationPlan(): PlacementPlan {
    const basePlan = placementPlan();
    const lane = firstLane(basePlan);
    const unit = constrainedUnit(firstUnit(basePlan));
    const fallbackLane = {
        ...lane,
        executor: {
            ...lane.executor,
            id: 'worker-2'
        },
        id: 'worker-2'
    };

    return {
        assignments: [ { lane: lane.id, unit: unit.id } ],
        lanes: [ lane, fallbackLane ],
        units: [ unit ]
    };
}

function pullRequiredLease(
    dispatcher: WorkerPoolWorkDispatcher,
    lane: PlacementLane
): WorkerPoolUnitLease {
    const lease = dispatcher.pull(lane);

    if (lease === null) {
        throw new Error('Worker-pool dispatcher fixture expected a lease.');
    }

    return lease;
}

function assertUnsplitLease(scope: OverkillScope, plan: PlacementPlan): void {
    const lease = pullRequiredLease(createWorkDispatcher(fakeWorkerRuntime(plan), plan), firstLane(plan));

    scope.assert.equal(lease.unit.work.length, 2);
    scope.assert.deepEqual(lease.traceUnit, lease.unit.id);
}

function assertFreshReservation(scope: OverkillScope, lease: WorkerPoolUnitLease): void {
    scope.assert.deepEqual(lease.reservation.faultDomains, [ 'rack' ]);
    scope.assert.deepEqual(lease.reservation.hardKeys, [ 'database' ]);
}

function assertRetainedReservation(scope: OverkillScope, lease: WorkerPoolUnitLease): void {
    scope.assert.deepEqual(lease.reservation.faultDomains, []);
    scope.assert.deepEqual(lease.reservation.hardKeys, []);
}

function splitLeaseMembers(expectation: SplitLeaseExpectation): readonly [
    WorkerPoolUnitLease['members'][number],
    WorkerPoolUnitLease['members'][number]
] {
    const splitMembers = [
        ...expectation.firstLease.members,
        ...expectation.secondLease.members
    ]
        .filter(function isSplitMember(member) {
            return isDynamicWorkUnitId(member.traceUnit);
        });
    const firstMember = splitMembers[0];
    const secondMember = splitMembers[1];

    if (firstMember === undefined || secondMember === undefined) {
        throw new Error('Expected two split work-unit members.');
    }

    return [ firstMember, secondMember ];
}

function assertSplitLeases(
    scope: OverkillScope,
    expectation: SplitLeaseExpectation
): void {
    const [ firstMember, secondMember ] = splitLeaseMembers(expectation);
    const traces = [
        dynamicWorkUnitId(firstMember.traceUnit),
        dynamicWorkUnitId(secondMember.traceUnit)
    ];

    scope.assert.equal(firstMember.unit.work.length, 1);
    scope.assert.equal(secondMember.unit.work.length, 1);
    scope.assert.deepEqual(
        traces.map(function toParent(trace) {
            return trace.parent;
        }),
        [ expectation.unit.id, expectation.unit.id ]
    );
    scope.assert.deepEqual(
        traces.map(function toChild(trace) {
            return trace.child;
        }),
        [
            workIdentityKey(firstWork(expectation.unit)),
            workIdentityKey(secondWork(expectation.unit))
        ]
    );
    scope.assert.deepEqual(expectation.traceEntry.children, traces);
    scope.assert.deepEqual(expectation.traceEntry.parent, expectation.unit.id);
}

export const testNode = createOverkillSuite({
    ...testCaseMetadata,
    title: 'source/run/worker-pool-work-dispatcher.test.ts',
    children: [
        createOverkillTestCase({
            ...testCaseMetadata,
            title: 'worker-pool dynamic dispatcher retains partial leases on their lane',
            body(scope: OverkillScope) {
                const plan = retainedReservationPlan();
                const dispatcher = createWorkDispatcher(fakeWorkerRuntime(plan), plan);
                const firstLease = pullRequiredLease(dispatcher, firstLane(plan));

                assertFreshReservation(scope, firstLease);
                dispatcher.finish(firstLease, true);
                dispatcher.requeue({ traceUnit: firstLease.traceUnit, unit: firstLease.unit });
                scope.assert.equal(dispatcher.pull(secondLane(plan)), null);
                assertRetainedReservation(scope, pullRequiredLease(dispatcher, firstLane(plan)));

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            ...testCaseMetadata,
            title: 'worker-pool dynamic dispatcher splits eligible pending units',
            body(scope: OverkillScope) {
                const unit = multiWorkUnit();
                const plan = splitCandidatePlan(unit);
                const runtime = fakeWorkerRuntime(plan);
                const dispatcher = createWorkDispatcher(runtime, plan);
                const firstLease = pullRequiredLease(dispatcher, firstLane(plan));
                const secondLease = pullRequiredLease(dispatcher, secondLane(plan));
                const traceEntry = unitSplitEntry(runtime.placementTraceEntries[0]);

                assertSplitLeases(scope, { firstLease, secondLease, traceEntry, unit });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            ...testCaseMetadata,
            title: 'worker-pool dynamic dispatcher batches compatible reusable units',
            body(scope: OverkillScope) {
                const plan = batchingPlan('reuse');
                const dispatcher = createWorkDispatcher(fakeWorkerRuntime(plan), plan);
                const lease = pullRequiredLease(dispatcher, firstLane(plan));

                scope.assert.equal(lease.envelopeId, 'batch-1');
                scope.assert.equal(lease.members.length, 2);
                scope.assert.deepEqual(
                    lease.members.map(function toTraceUnit(member) {
                        return member.traceUnit;
                    }),
                    plan.units.map(function toUnitId(unit) {
                        return unit.id;
                    })
                );
                scope.assert.deepEqual(
                    lease.members.map(function toWorkLength(member) {
                        return member.unit.work.length;
                    }),
                    [ 1, 1 ]
                );
                scope.assert.equal(dispatcher.pull(firstLane(plan)), null);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            ...testCaseMetadata,
            title: 'worker-pool dynamic dispatcher keeps fresh-worker units unbatched',
            body(scope: OverkillScope) {
                const plan = batchingPlan('fresh-worker-per-unit');
                const dispatcher = createWorkDispatcher(fakeWorkerRuntime(plan), plan);
                const firstLease = pullRequiredLease(dispatcher, firstLane(plan));
                const secondLease = pullRequiredLease(dispatcher, firstLane(plan));

                scope.assert.equal(firstLease.envelopeId, null);
                scope.assert.equal(secondLease.envelopeId, null);
                scope.assert.equal(firstLease.members.length, 1);
                scope.assert.equal(secondLease.members.length, 1);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            ...testCaseMetadata,
            title: 'worker-pool dynamic dispatcher keeps ineligible units whole',
            body(scope: OverkillScope) {
                for (const variant of noSplitVariants()) {
                    assertUnsplitLease(scope, variant.plan);
                }

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            ...testCaseMetadata,
            title: 'worker-pool dynamic dispatcher keeps crash requeues whole',
            body(scope: OverkillScope) {
                const unit = multiWorkUnit();
                const plan = twoLanePlan(unit);
                const dispatcher = createWorkDispatcher(fakeWorkerRuntime(plan), plan);

                dispatcher.clear();
                dispatcher.requeue({ traceUnit: unit.id, unit });
                const lease = pullRequiredLease(dispatcher, firstLane(plan));

                scope.assert.equal(lease.unit.work.length, 2);
                scope.assert.deepEqual(lease.traceUnit, unit.id);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            ...testCaseMetadata,
            title: 'worker-pool pending split rejects malformed empty child sets',
            body(scope: OverkillScope) {
                const unit = {
                    ...multiWorkUnit(),
                    work: []
                } as unknown as WorkUnit;

                scope.assert.throws(function splitMalformedUnit() {
                    splitQueuedWorkUnit(fakeWorkerRuntime(twoLanePlan(unit)), originalQueueItem(unit, 0));
                }, {
                    message: 'Splittable work unit unexpectedly had no children.'
                });

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
