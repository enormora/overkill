import { isDeepStrictEqual } from 'node:util';
import { test } from '@overkill-dev/test';

import {
    createChildRun,
    nativeChildDependencies,
    supervisedChildCommand
} from '../test-support/supervised-child-fixture.ts';
import { createVirtualRunDiscovery } from '../test-support/virtual-run-discovery.ts';

import { runSupervisedChild, type SupervisedChildHost } from './supervised-child.ts';
import { supervisedChildMessageSchema } from './supervised-child-message-schema.ts';

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

export const testNode = test(
    'supervised execution resolves lazy case and suite locations before IPC',
    async function (scope) {
        const child = createChildRun({
            assignment: {
                implementations: null,

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
        const transportedLocationsMessages = child.messages();
        const transportedLocationsEvents = transportedLocationsMessages.filter(function (transportedLocationsMessage) {
            return transportedLocationsMessage.kind === 'event';
        });
        scope.assert.true(transportedLocationsEvents.some(function (transportedLocationsMessage) {
            return transportedLocationsMessage.event.kind === 'suite-start';
        }));
        scope.assert.true(transportedLocationsEvents.some(function (transportedLocationsMessage) {
            return transportedLocationsMessage.event.kind === 'test-start';
        }));
        for (const transportedLocationsMessage of transportedLocationsEvents) {
            const { event } = transportedLocationsMessage;
            scope.assert.true(
                isDeepStrictEqual(
                    supervisedChildMessageSchema.parse(structuredClone(transportedLocationsMessage)),
                    transportedLocationsMessage
                )
            );
            if (event.kind === 'test-start') {
                scope.assert.true(isDeepStrictEqual(event.definitionLocations, [ location ]));
                scope.assert.true(isDeepStrictEqual(event.suitePath[0]?.definitionLocations, [ location ]));
            }
        }

        return scope.assert.collect();
    }
);
