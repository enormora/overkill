import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import {
    hostProcessFacts,
    validateHostProcess
} from './run-host-process.ts';

export const testNode = createOverkillSuite({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/run-host-process.test.ts',
    children: [
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'hostProcessFacts() records direct execution without a host child',
            body(scope: OverkillScope) {
                scope.assert.deepEqual(hostProcessFacts({ kind: 'direct' }), { kind: 'direct' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'hostProcessFacts() derives child host reasons from Node arguments',
            body(scope: OverkillScope) {
                scope.assert.deepEqual(
                    hostProcessFacts({
                        kind: 'child',
                        nodeArguments: [ '--expose-gc', '--inspect-brk=0', '--cpu-prof' ]
                    }),
                    {
                        kind: 'child',
                        nodeArguments: [ '--expose-gc', '--inspect-brk=0', '--cpu-prof' ],
                        reasons: [ 'node-arguments', 'forced-garbage-collection', 'debugging', 'profiling' ]
                    }
                );
                scope.assert.deepEqual(
                    hostProcessFacts({
                        kind: 'child',
                        nodeArguments: []
                    }),
                    {
                        kind: 'child',
                        nodeArguments: [],
                        reasons: [ 'host-isolation' ]
                    }
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'validateHostProcess() rejects unsupported Node argument shapes',
            body(scope: OverkillScope) {
                scope.assert.throws(function rejectShortArgument() {
                    validateHostProcess({ kind: 'child', nodeArguments: [ '-r' ] });
                }, {
                    message: 'Host process Node argument must use long-form syntax: -r'
                });
                scope.assert.throws(function rejectPreloadArgument() {
                    validateHostProcess({ kind: 'child', nodeArguments: [ '--require=./setup.js' ] });
                }, {
                    message: 'Host process Node argument is not supported: --require'
                });
                scope.assert.throws(function rejectMultiTokenArgument() {
                    validateHostProcess({ kind: 'child', nodeArguments: [ '--inspect\n--require=./setup.js' ] });
                }, {
                    message: 'Host process Node argument must stay on one command-line token.'
                });

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
