import { isDeepStrictEqual } from 'node:util';
import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { test } from '@overkill-dev/test';
import type { ReporterEvent } from '../packages/engine/engine.entry-point.ts';

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

const resolvedTransportLocations = defineCompositeAssertion({
    name: 'resolved transport locations',
    assert(
        check,
        transportedLocationsEvents: readonly { readonly event: ReporterEvent; readonly kind: 'event'; }[]
    ) {
        const transported = transportedLocationsEvents.map(function (message) {
            const event = message.event;
            const roundtrip = check.true(
                isDeepStrictEqual(supervisedChildMessageSchema.parse(structuredClone(message)), message)
            );
            return event.kind === 'test-start'
                ? check.group([
                    roundtrip,
                    check.true(isDeepStrictEqual(event.definitionLocations, [ location ])),
                    check.true(isDeepStrictEqual(event.suitePath[0]?.definitionLocations, [ location ]))
                ])
                : roundtrip;
        });
        return check.group([
            check.true(transportedLocationsEvents.some(function (transportedLocationsMessage) {
                return transportedLocationsMessage.event.kind === 'suite-start';
            })),
            check.true(transportedLocationsEvents.some(function (transportedLocationsMessage) {
                return transportedLocationsMessage.event.kind === 'test-start';
            })),
            ...transported
        ]);
    }
});

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
        const events = child.messages().filter(function (message) {
            return message.kind === 'event';
        });
        scope.assert(resolvedTransportLocations, events);

        return scope.assert.collect();
    }
);
