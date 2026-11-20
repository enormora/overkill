import { type TestScope as OverkillScope, suite, test } from '@overkill-dev/test';

import {
    type TestBody as DirectTestBody,
    type TestNode as DirectTestNode,
    type TestScope as DirectScope,
    createTestCase as createDirectTestCase
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

export const testNode = suite('source/run/run-if-main-profile-file-sets.test.ts', [
    test('runIfMain() rejects empty file sets while selecting direct profiles', async function (scope: OverkillScope) {
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
    }),
    test('runIfMain() rejects a non-microtest fallback profile named microtest', async function (scope: OverkillScope) {
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
    })
]);
