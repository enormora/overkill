import {
    createTestCase as createDirectTestCase,
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestBody as DirectTestBody,
    type TestNode as DirectTestNode,
    type TestScope as DirectScope,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { createDirectRunFixture } from '../test-support/direct-run-fixture.ts';

function passingBody(scope: DirectScope): ReturnType<DirectTestBody> {
    scope.assert.true(true);

    return scope.assert.collect();
}

function passingCase(): DirectTestNode {
    return createDirectTestCase({
        body: passingBody,
        definitionLocations: [ { kind: 'unknown' as const } ],
        annotations: {},
        controls: {},
        title: 'passes'
    });
}

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/run-if-main-profile-file-sets.test.ts',
    annotations: {},
    controls: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'runIfMain() rejects empty file sets while selecting direct profiles',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const fixture = createDirectRunFixture({
                    config: {
                        profiles: {
                            microtest: {
                                testFamily: 'microtest',
                                files: { include: [ 'other.test.ts' ] }
                            },
                            focused: {
                                testFamily: 'microtest',
                                files: {
                                    sets: {
                                        empty: { include: [ 'missing/**/*.test.ts' ] },
                                        unit: { include: [ 'direct.test.ts' ] }
                                    }
                                }
                            }
                        }
                    },
                    fileName: 'direct.test.ts',
                    files: [ 'other.test.ts' ]
                });

                await scope.assert.rejects(async function runEmptyFileSetProfile() {
                    await fixture.runIfMain(fixture.project.meta, passingCase(), { reporters: [] });
                }, { message: 'Profile files.sets.empty matched no test files.' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'runIfMain() rejects a non-microtest fallback profile named microtest',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const fixture = createDirectRunFixture({
                    config: {
                        profiles: {
                            microtest: {
                                testFamily: 'integration',
                                files: { include: [ 'other.test.ts' ] }
                            }
                        }
                    },
                    fileName: 'direct.test.ts',
                    files: [ 'other.test.ts' ]
                });

                await scope.assert.rejects(async function runIntegrationFallbackProfile() {
                    await fixture.runIfMain(fixture.project.meta, passingCase(), { reporters: [] });
                }, { message: 'runIfMain() requires the configured "microtest" profile.' });

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
