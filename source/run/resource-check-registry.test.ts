import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { table, type TestScope, suite, test } from '@overkill-dev/test';

import { createDeterministicClock, type DeterministicClock } from '@enormora/clock';

import { createStoredValue } from '../stored-value.ts';

import { createDefaultWorkId } from '../engine/identity.ts';
import type { ResourceCheckOwner, ResourceCheckSnapshot } from '../resource-check-protocol.ts';
import type { ResourceCheckFrame } from './resource-check-channel.ts';
import {
    createResourceCheckRegistry,
    type ResourceCheckRegistry,
    type ResourceCheckSend,
    type ResourceCheckConnection
} from './resource-check-registry.ts';

type RegistryConnection = ResourceCheckConnection & { readonly destroy: () => void; };
function connection(): RegistryConnection {
    const destroyed = createStoredValue(false);
    return {
        get destroyed() {
            return destroyed.read();
        },
        destroy() {
            destroyed.write(true);
        }
    };
}
const work = createDefaultWorkId({ file: null, suite: [], title: 'consumer', params: null });
const otherWork = createDefaultWorkId({ file: null, suite: [], title: 'other consumer', params: null });
const attempt = { kind: 'attempt', work, attempt: { index: 0 } } as const;
const owner: ResourceCheckOwner = { run: 'registry-run', id: 'owner', scope: 'per-run' };
const snapshot: ResourceCheckSnapshot = {
    owner,
    resource: 'service',
    revision: 1,
    interval: attempt,
    passing: 1,
    failures: [],
    errors: [],
    status: { kind: 'complete' }
};
type Scenario = {
    readonly clock: DeterministicClock;
    readonly registry: ResourceCheckRegistry;
    readonly owner: ResourceCheckOwner;
    readonly socket: RegistryConnection;
    readonly sibling: RegistryConnection;
    readonly send: ResourceCheckSend;
    readonly sent: () => readonly ResourceCheckFrame[];
};
async function registeredOwner(
    cleanup: TestScope['cleanup'],
    resourceScope: ResourceCheckOwner['scope']
): Promise<Scenario> {
    const clock = createDeterministicClock({ initialUnixEpochMicroseconds: 0n });
    const registry = createResourceCheckRegistry(owner.run, clock);
    const sockets = { owner: connection(), sibling: connection() };
    const frames: ResourceCheckFrame[] = [];
    const registered = { ...owner, scope: resourceScope };
    cleanup(function closeSockets() {
        sockets.owner.destroy();
        sockets.sibling.destroy();
    });
    const send: ResourceCheckSend = function recordFrame(frame) {
        frames.push(frame);
    };
    await registry.receive(sockets.owner, send, {
        kind: 'register',
        owner: registered,
        resource: 'service',
        consumers: [ work ]
    });
    return {
        clock,
        registry,
        owner: registered,
        socket: sockets.owner,
        sibling: sockets.sibling,
        send,
        sent() {
            return frames;
        }
    };
}
const invalidFrames: readonly {
    readonly title: string;
    readonly frame: ResourceCheckFrame;
    readonly message: RegExp;
}[] = [
    {
        title: 'rejects registrations from another execution',
        frame: { kind: 'register', owner: { ...owner, run: 'other' }, resource: 'service', consumers: [ work ] },
        message: /Invalid resource owner registration/u
    },
    {
        title: 'rejects duplicate owner registrations',
        frame: { kind: 'register', owner, resource: 'service', consumers: [ work ] },
        message: /Invalid resource owner registration/u
    },
    {
        title: 'rejects checkpoints for unknown owners',
        frame: { kind: 'checkpoint', snapshot: { ...snapshot, owner: { ...owner, id: 'unknown' } } },
        message: /channel mismatch/u
    },
    {
        title: 'rejects checkpoints outside the consumer set',
        frame: { kind: 'checkpoint', snapshot: { ...snapshot, interval: { ...attempt, work: otherWork } } },
        message: /outside the owner consumer set/u
    },
    {
        title: 'rejects checkpoints with changed execution identity',
        frame: { kind: 'checkpoint', snapshot: { ...snapshot, owner: { ...owner, run: 'other' } } },
        message: /execution mismatch/u
    },
    {
        title: 'rejects checkpoints with changed scope',
        frame: { kind: 'checkpoint', snapshot: { ...snapshot, owner: { ...owner, scope: 'per-case' } } },
        message: /execution mismatch/u
    }
];
async function checkpointOwner(scenario: Scenario): Promise<void> {
    await scenario.registry.receive(scenario.socket, scenario.send, {
        kind: 'checkpoint',
        snapshot: { ...snapshot, owner: scenario.owner }
    });
}
async function finalizeInterval(
    scenario: Scenario,
    interval: ResourceCheckSnapshot['interval'],
    socket: RegistryConnection
): Promise<void> {
    await scenario.registry.receive(socket, scenario.send, { kind: 'finalize', request: 'finalize', interval });
}
const rejectForeignAcknowledgement = defineCompositeAssertion({
    name: 'reject foreign acknowledgement',
    async assert(check, scenario: Scenario) {
        const command = scenario.sent()[0];
        if (command?.kind !== 'finalize-owner') {
            throw new Error('Expected owner finalization.');
        }
        await scenario.registry.receive(scenario.sibling, scenario.send, {
            kind: 'finalized',
            request: command.request,
            errors: []
        });
        scenario.registry.disconnect(scenario.sibling);
        return check.equal(scenario.sent().length, 1);
    }
});
export const testNode = suite('resource check owner registry', [
    test('flushes empty registries and ignores server response frames', async function (scope) {
        const registry = createResourceCheckRegistry(
            owner.run,
            createDeterministicClock({ initialUnixEpochMicroseconds: 0n })
        );
        const socket = connection();
        const frames: ResourceCheckFrame[] = [];
        const send: ResourceCheckSend = function collect(frame) {
            frames.push(frame);
        };
        await registry.receive(socket, send, { kind: 'result', request: 'ignored', snapshots: [], errors: [] });
        await registry.receive(socket, send, { kind: 'flush', request: 'flush' });
        scope.assert.deepEqual(frames, [ { kind: 'result', request: 'flush', snapshots: [], errors: [] } ]);
        return scope.assert.collect();
    }),
    test('delivers retained checkpoints to registered observers', async function (scope) {
        const scenario = await registeredOwner(scope.cleanup, 'per-run');
        const observed: ResourceCheckSnapshot[] = [];
        scenario.registry.observe(function checkpoint(value) {
            observed.push(value);
        });
        await checkpointOwner(scenario);
        scope.assert.deepEqual(observed, [ snapshot ]);
        return scope.assert.collect();
    }),
    table({
        title: 'routes stops to eligible connected consumers',
        cases: [ 'per-case', 'per-run' ] as const,
        caseTitle(resourceScope) {
            return resourceScope;
        },
        async test(scope) {
            const resourceScope = scope.parameters;

            const scenario = await registeredOwner(scope.cleanup, resourceScope);
            const recipients: string[] = [];
            scenario.registry.connect(scenario.socket, function deliver() {
                recipients.push('owner');
            });
            scenario.registry.connect(scenario.sibling, function deliver() {
                recipients.push('sibling');
            });
            await scenario.registry.receive(scenario.socket, scenario.send, {
                kind: 'stop',
                owner: scenario.owner,
                interval: attempt,
                cause: 'stopped'
            });
            scope.assert.deepEqual(recipients, resourceScope === 'per-case' ? [ 'owner' ] : [ 'owner', 'sibling' ]);
            return scope.assert.collect();
        }
    }),
    table({
        title: 'rejects invalid resource-check frames',
        cases: invalidFrames,
        caseTitle(testCase) {
            return testCase.title;
        },
        async test(scope) {
            const testCase = scope.parameters;

            const scenario = await registeredOwner(scope.cleanup, 'per-run');
            await scope.assert.rejects(async function receiveInvalidFrame() {
                await scenario.registry.receive(scenario.socket, scenario.send, testCase.frame);
            }, { message: testCase.message });
            scope.assert.equal(scenario.registry.snapshots().length, 1);
            return scope.assert.collect();
        }
    }),
    test('rejects checkpoints arriving on another owner channel', async function (scope) {
        const scenario = await registeredOwner(scope.cleanup, 'per-run');
        await scope.assert.rejects(async function receiveForeignCheckpoint() {
            await scenario.registry.receive(scenario.sibling, scenario.send, { kind: 'checkpoint', snapshot });
        }, { message: /channel mismatch/u });
        scope.assert.equal(scenario.registry.snapshots()[0]?.revision, 0);
        return scope.assert.collect();
    }),
    test('retains the newest checkpoint when older deliveries arrive', async function (scope) {
        const scenario = await registeredOwner(scope.cleanup, 'per-run');
        await checkpointOwner(scenario);
        await scenario.registry.receive(scenario.socket, scenario.send, {
            kind: 'checkpoint',
            snapshot: { ...snapshot, passing: 0, revision: 0 }
        });
        scope.assert.equal(scenario.registry.snapshots()[1]?.passing, 1);
        return scope.assert.collect();
    }),
    test('does not finalize per-case owners for unobserved attempts', async function (scope) {
        const scenario = await registeredOwner(scope.cleanup, 'per-case');
        await finalizeInterval(scenario, attempt, scenario.socket);
        await checkpointOwner(scenario);
        await finalizeInterval(scenario, { ...attempt, attempt: { index: 1 } }, scenario.socket);
        await finalizeInterval(scenario, { ...attempt, work: otherWork }, scenario.socket);
        scope.assert.deepEqual(
            scenario.sent().map(function kind(frame) {
                return frame.kind;
            }),
            [ 'result', 'result', 'result' ]
        );
        return scope.assert.collect();
    }),
    test('hides worker-local owners from sibling channels', async function (scope) {
        const scenario = await registeredOwner(scope.cleanup, 'shared-per-worker');
        await checkpointOwner(scenario);
        await finalizeInterval(scenario, attempt, scenario.sibling);
        const response = scenario.sent()[0];
        scope.assert.true(response?.kind === 'result' && response.snapshots.length === 0);
        return scope.assert.collect();
    }),
    test('reports finalization acknowledgements that never arrive', async function (scope) {
        const scenario = await registeredOwner(scope.cleanup, 'per-run');
        const waiting = finalizeInterval(scenario, attempt, scenario.socket);
        scenario.clock.advanceByMilliseconds(2000);
        await waiting;
        const response = scenario.sent()[1];
        scope.assert.true(
            response?.kind === 'result' && response
                .errors
                .includes('Resource owner finalization acknowledgement timed out.')
        );
        return scope.assert.collect();
    }),
    test('rejects admission after a lifetime stop', async function (scope) {
        const scenario = await registeredOwner(scope.cleanup, 'per-run');
        await scenario.registry.receive(scenario.socket, scenario.send, {
            kind: 'stop',
            owner,
            interval: { kind: 'lifetime' },
            cause: 'stopped'
        });
        await scenario.registry.receive(scenario.sibling, scenario.send, {
            kind: 'admit',
            request: 'admit',
            interval: attempt
        });
        const response = scenario.sent()[0];
        scope.assert.true(
            response?.kind === 'result' && response.errors[0] === 'Required resource owner is unavailable.'
        );
        return scope.assert.collect();
    }),
    test('rejects admission after a per-case stop', async function (scope) {
        const scenario = await registeredOwner(scope.cleanup, 'per-case');
        await scenario.registry.receive(scenario.socket, scenario.send, {
            kind: 'stop',
            owner: scenario.owner,
            interval: attempt,
            cause: 'stopped'
        });
        await scenario.registry.receive(scenario.socket, scenario.send, {
            kind: 'admit',
            request: 'admit',
            interval: attempt
        });
        const response = scenario.sent()[0];
        scope.assert.true(response?.kind === 'result' && response.errors.length === 1);
        return scope.assert.collect();
    }),
    test('rejects admission when the required owner channel has disappeared', async function (scope) {
        const scenario = await registeredOwner(scope.cleanup, 'per-run');
        scenario.socket.destroy();
        scenario.registry.disconnect(scenario.socket);
        await scenario.registry.receive(scenario.sibling, scenario.send, {
            kind: 'admit',
            request: 'admit',
            interval: attempt
        });
        const response = scenario.sent()[0];
        scope.assert.true(response?.kind === 'result' && response.errors.length === 1);
        return scope.assert.collect();
    }),
    test(
        'retains incomplete evidence when an owner disconnects during finalization',
        async function (scope) {
            const scenario = await registeredOwner(scope.cleanup, 'per-case');
            await checkpointOwner(scenario);
            const waiting = finalizeInterval(scenario, attempt, scenario.socket);
            await scope.assert(rejectForeignAcknowledgement, scenario);
            scenario.registry.disconnect(scenario.socket);
            await waiting;
            const response = scenario.sent()[1];
            scope.assert.true(
                response?.kind === 'result' && response.errors.includes('Resource observation channel closed.')
            );
            scope.assert.equal(scenario.registry.snapshots()[0]?.status.kind, 'incomplete');
            return scope.assert.collect();
        }
    )
]);
