import { type TestScope, suite, test } from '@overkill-dev/test';
import type { EngineCaseBody } from '../test-support/create-test-engine.ts';

import {
    stampTestNodeFamily,
    type TestNode as DirectTestNode,
    createTestCase as createDirectTestCase
} from '../packages/engine/engine.entry-point.ts';

import { attachTestBodyResourceAttachments } from '../engine/test-body-resource-attachment.ts';
import type { DefinedReporter, ReporterEvent } from '../engine/reporter.ts';
import { createDirectRunFixture, type DirectRunFixture } from '../test-support/direct-run-fixture.ts';
import { defineFixedReporter } from '../test-support/reporter-definition.ts';
import type { RunFacts } from './run-types.ts';

type PassingBodyAssertions = { readonly assert: Pick<TestScope['assert'], 'collect' | 'true'>; };

type ResourceBodyAssertions = { readonly assert: Pick<TestScope['assert'], 'collect' | 'equal'>; };

type CapturedRun = {
    readonly facts: RunFacts;
    readonly rootTitle: string;
};

function passingBody(
    scope: PassingBodyAssertions
): ReturnType<EngineCaseBody> {
    scope.assert.true(true);

    return scope.assert.collect();
}

function resourceBody(
    scope: ResourceBodyAssertions
): ReturnType<EngineCaseBody> {
    scope.assert.equal('ready', 'ready');

    return scope.assert.collect();
}

function passingCase(controls: DirectTestNode['controls'] = {}): DirectTestNode {
    return createDirectTestCase({
        annotations: {},
        body: passingBody,
        controls,
        definitionLocations: [ { kind: 'unknown' as const } ],
        title: 'passes'
    });
}

function failingCase(): DirectTestNode {
    return createDirectTestCase({
        body(testScope) {
            testScope.assert.true(false);

            return testScope.assert.collect();
        },
        definitionLocations: [ { kind: 'unknown' as const } ],
        annotations: {},
        controls: {},
        title: 'fails'
    });
}

function integrationCase(): DirectTestNode {
    const testCase = passingCase();

    stampTestNodeFamily(testCase, 'integration');

    return testCase;
}

function resourceAttachedCase(): DirectTestNode {
    return createDirectTestCase({
        annotations: {},
        body: attachTestBodyResourceAttachments(resourceBody, {
            directResources: [ { key: 'database', resourceName: 'database' } ],
            resourceGraph: [
                {
                    workload: 'independent' as const,
                    dependencies: [],
                    handleTransport: 'local',
                    name: 'database',
                    requirements: [],
                    scenarios: [],
                    scope: 'per-case'
                }
            ],
            runtimeGraphs: []
        }),
        controls: {},
        definitionLocations: [ { kind: 'unknown' as const } ],
        title: 'uses runtime'
    });
}

function createCapturingReporter(recordRun: (capturedRun: CapturedRun) => void): DefinedReporter {
    return defineFixedReporter({
        dispose: null,
        kind: 'real-time',
        name: 'capture-direct-run',
        onEvent(event: ReporterEvent) {
            if (event.kind === 'run-start') {
                recordRun({
                    facts: event.facts as RunFacts,
                    rootTitle: event.root.title
                });
            }
        },
        onFinish: null,
        sinks: []
    });
}

async function runDirect(fixture: DirectRunFixture, testNode: DirectTestNode): Promise<CapturedRun> {
    const capturedRuns: CapturedRun[] = [];

    await fixture.runIfMain(fixture.project.meta, testNode, {
        reporters: [
            createCapturingReporter(function recordRun(capturedRun) {
                capturedRuns.push(capturedRun);
            })
        ]
    });

    const [ capturedRun ] = capturedRuns;

    if (capturedRun === undefined) {
        throw new Error('Direct run was not captured.');
    }

    return capturedRun;
}

export const testNode = suite('Direct module execution', [
    test('returns before config loading when imported', async function (scope) {
        const fixture = createDirectRunFixture({
            config: {
                profiles: {
                    microtest: {
                        testFamily: 'invalid'
                    }
                }
            },
            fileName: 'direct.test.ts',
            files: []
        });

        await fixture.runIfMain({ ...fixture.project.meta, main: false }, passingCase(), { reporters: [] });
        scope.assert.true(true);

        return scope.assert.collect();
    }),
    test('selects the configured profile matching the current file', async function (scope) {
        const fixture = createDirectRunFixture({
            config: {
                profiles: {
                    microtest: {
                        testFamily: 'microtest',
                        files: { include: [ 'other.test.ts' ] },
                        execution: { processModel: 'in-process', scheduling: 'concurrent' }
                    },
                    focused: {
                        testFamily: 'microtest',
                        files: { include: [ 'direct.test.ts' ] },
                        execution: { processModel: 'in-process', scheduling: 'serial' }
                    }
                }
            },
            fileName: 'direct.test.ts',
            files: [ 'other.test.ts' ]
        });
        const capturedRun = await runDirect(fixture, passingCase());

        scope.assert.equal(capturedRun.facts.execution.profile, 'focused');
        scope.assert.equal(capturedRun.facts.execution.scheduling, 'serial');
        scope.assert.equal(capturedRun.facts.execution.processModel, 'in-process');
        scope.assert.equal(capturedRun.rootTitle, fixture.project.cwd);

        return scope.assert.collect();
    }),
    test('selects the configured profile matching a file set', async function (scope: TestScope) {
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
                                unit: { include: [ 'direct.test.ts' ] }
                            }
                        },
                        execution: { processModel: 'in-process', scheduling: 'serial' }
                    }
                }
            },
            fileName: 'direct.test.ts',
            files: [ 'other.test.ts' ]
        });
        const capturedRun = await runDirect(fixture, passingCase());
        const firstCase = capturedRun.facts.cases[0];

        scope.require.defined(firstCase);
        scope.assert.equal(capturedRun.facts.execution.profile, 'focused');
        scope.assert.equal(firstCase.fileSet, 'unit');

        return scope.assert.collect();
    }),
    test(
        'falls back to configured microtest when no profile matches',
        async function (scope) {
            const fixture = createDirectRunFixture({
                config: {
                    profiles: {
                        microtest: {
                            testFamily: 'microtest',
                            files: { include: [ 'other.test.ts' ] },
                            execution: { processModel: 'in-process', scheduling: 'serial' }
                        }
                    }
                },
                fileName: 'direct.test.ts',
                files: [ 'other.test.ts' ]
            });
            const capturedRun = await runDirect(fixture, passingCase());

            scope.assert.equal(capturedRun.facts.execution.profile, 'microtest');
            scope.assert.equal(capturedRun.facts.execution.scheduling, 'serial');

            return scope.assert.collect();
        }
    ),
    test(
        'rejects fallback profiles when the current file is outside every file set',
        async function (scope) {
            const fixture = createDirectRunFixture({
                config: {
                    profiles: {
                        microtest: {
                            testFamily: 'microtest',
                            files: {
                                sets: {
                                    unit: { include: [ 'other.test.ts' ] }
                                }
                            }
                        }
                    }
                },
                fileName: 'direct.test.ts',
                files: [ 'other.test.ts' ]
            });

            await scope.assert.rejects(async function runOutsideFileSet() {
                await fixture.runIfMain(fixture.project.meta, passingCase(), { reporters: [] });
            }, {
                message: 'runIfMain() file must match exactly one profile file set for "microtest": direct.test.ts.'
            });

            return scope.assert.collect();
        }
    ),
    test(
        'rejects profile file sets that overlap outside the current file',
        async function (scope) {
            const fixture = createDirectRunFixture({
                config: {
                    profiles: {
                        microtest: {
                            testFamily: 'microtest'
                        },
                        focused: {
                            testFamily: 'microtest',
                            files: {
                                sets: {
                                    integration: { include: [ 'other.test.ts' ] },
                                    duplicate: { include: [ 'other.test.ts' ] },
                                    unit: { include: [ 'direct.test.ts' ] }
                                }
                            }
                        }
                    }
                },
                fileName: 'direct.test.ts',
                files: [ 'other.test.ts' ]
            });

            await scope.assert.rejects(async function runOverlappingFileSets() {
                await fixture.runIfMain(fixture.project.meta, passingCase(), { reporters: [] });
            }, {
                message:
                    'runIfMain() profile file sets must not overlap: other.test.ts matched integration and duplicate.'
            });

            return scope.assert.collect();
        }
    ),
    test('rejects ambiguous profile file matches', async function (scope) {
        const fixture = createDirectRunFixture({
            config: {
                profiles: {
                    microtest: {
                        testFamily: 'microtest',
                        files: { include: [ 'direct.test.ts' ] }
                    },
                    focused: {
                        testFamily: 'microtest',
                        files: { include: [ 'direct.test.ts' ] }
                    }
                }
            },
            fileName: 'direct.test.ts',
            files: []
        });

        await scope.assert.rejects(async function runAmbiguousFile() {
            await fixture.runIfMain(fixture.project.meta, passingCase(), { reporters: [] });
        }, {
            message: 'runIfMain() matched multiple profiles for "direct.test.ts": microtest, focused.'
        });

        return scope.assert.collect();
    }),
    test('accepts integration profiles selected by file match', async function (scope) {
        const fixture = createDirectRunFixture({
            config: {
                profiles: {
                    integration: {
                        testFamily: 'integration',
                        files: { include: [ 'direct.integration.test.ts' ] }
                    }
                }
            },
            fileName: 'direct.integration.test.ts',
            files: []
        });

        await fixture.runIfMain(fixture.project.meta, integrationCase(), { reporters: [] });

        scope.assert.equal(fixture.exitCode(), null, { message: fixture.stderr() });

        return scope.assert.collect();
    }),
    test('does not warn for supervised profiles', async function (scope) {
        const fixture = createDirectRunFixture({
            config: null,
            fileName: 'direct.test.ts',
            files: []
        });

        await fixture.runIfMain(fixture.project.meta, passingCase(), { reporters: [] });

        scope.assert.equal(fixture.stderr(), '');

        return scope.assert.collect();
    }),
    test('rejects cases outside the selected test family', async function (scope) {
        const fixture = createDirectRunFixture({
            config: null,
            fileName: 'direct.test.ts',
            files: []
        });

        await scope.assert.rejects(async function runWrongCaseFamily() {
            await fixture.runIfMain(fixture.project.meta, integrationCase(), { reporters: [] });
        }, {
            message: /authored for "integration"/u,
            name: 'RunCollectionError'
        });

        return scope.assert.collect();
    }),
    test('rejects resource-attached microtest cases', async function (scope) {
        const fixture = createDirectRunFixture({
            config: null,
            fileName: 'direct.test.ts',
            files: []
        });

        await scope.assert.rejects(async function runResourceAttachedCase() {
            await fixture.runIfMain(fixture.project.meta, resourceAttachedCase(), { reporters: [] });
        }, {
            message: 'Run profile "microtest" cannot run test cases with resource descriptors.',
            name: 'RunCollectionError'
        });

        return scope.assert.collect();
    }),
    test('rejects selected-profile control policy violations', async function (scope) {
        const fixture = createDirectRunFixture({
            config: null,
            fileName: 'direct.test.ts',
            files: []
        });

        await scope.assert.rejects(async function runCaptureControlCase() {
            await fixture.runIfMain(
                fixture.project.meta,
                passingCase({ capture: 'live' }),
                { reporters: [] }
            );
        }, {
            message: 'Run profile "microtest" cannot run test cases with authored capture controls.',
            name: 'RunCollectionError'
        });
        await scope.assert.rejects(async function runLongTimeoutCase() {
            await fixture.runIfMain(
                fixture.project.meta,
                passingCase({ timeoutMilliseconds: 999_999 }),
                { reporters: [] }
            );
        }, {
            message: /timeoutMilliseconds 999999/u,
            name: 'RunCollectionError'
        });

        return scope.assert.collect();
    }),
    test('preserves an existing nonzero process exitCode', async function (scope) {
        const fixture = createDirectRunFixture({
            config: null,
            fileName: 'direct.test.ts',
            files: []
        });

        fixture.setExitCode(7);
        await fixture.runIfMain(fixture.project.meta, failingCase(), { reporters: [] });

        scope.assert.equal(fixture.exitCode(), 7);

        return scope.assert.collect();
    }),
    test('writes runner errors not delivered by reporters', async function (scope) {
        const fixture = createDirectRunFixture({
            config: null,
            fileName: 'direct.test.ts',
            files: []
        });

        fixture.setUndeliveredRunnerErrors([
            {
                attributedToAttempt: null,
                attributedTo: null,
                cause: null,
                diagnostics: [ { label: 'phase', value: 'collection' } ],
                message: 'Direct collection failed.',
                subtype: 'loader'
            }
        ]);
        await fixture.runIfMain(fixture.project.meta, passingCase(), { reporters: [] });

        scope.assert.match(fixture.stderr(), /Direct collection failed\./u);

        return scope.assert.collect();
    })
]);
