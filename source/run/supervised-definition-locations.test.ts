import { isDeepStrictEqual } from 'node:util';
import { createTestCase, type TestScope } from '../packages/engine/engine.entry-point.ts';
import {
    createChildRun,
    nativeChildDependencies,
    supervisedChildCommand
} from '../test-support/supervised-child-fixture.ts';
import { createVirtualRunDiscovery } from '../test-support/virtual-run-discovery.ts';
import type { SupervisedChildMessage } from './supervised-protocol.ts';
import { runSupervisedChild, type SupervisedChildHost } from './supervised-child.ts';
import { supervisedChildMessageSchema } from './supervised-protocol-schema.ts';

const file = 'tests/authored.test.ts';
const location = { kind: 'known', file, line: 1, column: 1 } as const;

const loadAuthoredTestModule: SupervisedChildHost['loadRunTestModules'] = async function (files, engine) {
    const [ discovered ] = files;
    return [ {
        file: discovered.file,
        testNode: engine.createSuite({
            annotations: {},
            controls: {},
            title: 'fixture',
            definitionLocations: [ function () {
                return location;
            } ],
            children: [ engine.createTestCase({
                annotations: {},
                controls: {},
                title: 'passes',
                definitionLocations: [ function () {
                    return location;
                } ],
                body(scope) {
                    scope.assert.true(true);
                    return scope.assert.collect();
                }
            }) ]
        })
    } ];
};

function assertTransportedLocations(scope: TestScope, messages: readonly SupervisedChildMessage[]): void {
    const events = messages.filter(function (message) {
        return message.kind === 'event';
    });
    scope.assert.true(events.some(function (message) {
        return message.event.kind === 'suite-start';
    }));
    scope.assert.true(events.some(function (message) {
        return message.event.kind === 'test-start';
    }));
    for (const message of events) {
        const { event } = message;
        scope.assert.true(isDeepStrictEqual(supervisedChildMessageSchema.parse(structuredClone(message)), message));
        if (event.kind === 'test-start') {
            scope.assert.true(isDeepStrictEqual(event.definitionLocations, [ location ]));
            scope.assert.true(isDeepStrictEqual(event.suitePath[0]?.definitionLocations, [ location ]));
        }
    }
}

export const testNode = createTestCase({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'supervised execution resolves lazy case and suite locations before IPC',
    async body(scope: TestScope) {
        const child = createChildRun({
            assignment: {
                attachmentEndpoint: null,
                assignedCases: [ { file, params: null, suite: [ 'fixture' ], title: 'passes' } ],
                kind: 'assign'
            },
            command: supervisedChildCommand('run', file),
            discoverRunFiles: createVirtualRunDiscovery({
                cwd: '/project',
                directories: [],
                files: [ file ],
                realpaths: {}
            })
                .discoverRunFiles,
            loadRunTestModules: loadAuthoredTestModule,
            readEnvironment() {
                return {};
            }
        });
        await runSupervisedChild(child.host, nativeChildDependencies());
        scope.assert.equal(child.exitCode(), 0);
        assertTransportedLocations(scope, child.messages());
        return scope.assert.collect();
    }
});

const { runIfMain } = await import('#test-runner');
await runIfMain(import.meta, testNode);
