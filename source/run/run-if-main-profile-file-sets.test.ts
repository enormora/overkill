import { type TestScope, suite, test } from '@overkill-dev/test';
import type { EngineCaseBody } from '../test-support/create-test-engine.ts';

import {
    type TestNode as DirectTestNode,
    createTestCase as createDirectTestCase
} from '../packages/engine/engine.entry-point.ts';

import { createDirectRunFixture } from '../test-support/direct-run-fixture.ts';

type PassingBodyAssertions = { readonly assert: Pick<TestScope['assert'], 'collect' | 'true'>; };

function passingBody(
    scope: PassingBodyAssertions
): ReturnType<EngineCaseBody> {
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

export const testNode = suite('Run if main profile file sets', [
    test('rejects empty file sets while selecting direct profiles', async function (scope) {
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
    test('rejects a non-microtest fallback profile named microtest', async function (scope) {
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
