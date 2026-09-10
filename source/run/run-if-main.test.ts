import {
    createTestCase as createDirectTestCase,
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    stampTestNodeFamily,
    type TestBody as DirectTestBody,
    type TestNode as DirectTestNode,
    type TestScope as DirectScope,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { markResourceAttachedTestBody } from '../engine/test-body-resource-attachment.ts';
import type {
    DefinedReporter,
    ReporterEvent
} from '../engine/reporter.ts';
import {
    createDirectRunFixture,
    type DirectRunFixture
} from '../test-support/direct-run-fixture.ts';
import { defineFixedReporter } from '../test-support/reporter-definition.ts';
import type { RunFacts } from './run-types.ts';

type CapturedRun = {
    readonly facts: RunFacts;
    readonly rootTitle: string;
};

function passingBody(scope: DirectScope): ReturnType<DirectTestBody> {
    scope.assert.true(true);

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
        body: markResourceAttachedTestBody(passingBody),
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

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/run-if-main.test.ts',
    annotations: {},
    controls: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'runIfMain() returns before config loading when imported',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
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
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'runIfMain() selects the configured profile matching the current file',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
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
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'runIfMain() selects the configured profile matching a file set',
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
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'runIfMain() falls back to configured microtest when no profile matches',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
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
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'runIfMain() rejects fallback profiles when the current file is outside every file set',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
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
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'runIfMain() rejects profile file sets that overlap outside the current file',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
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
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'runIfMain() rejects ambiguous profile file matches',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
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
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'runIfMain() rejects integration profiles selected by file match',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
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

                await scope.assert.rejects(async function runIntegrationFile() {
                    await fixture.runIfMain(fixture.project.meta, passingCase(), { reporters: [] });
                }, {
                    message: [
                        'runIfMain() does not support integration profile "integration" yet.',
                        'Use the overkill CLI with --profile integration.'
                    ]
                        .join(' ')
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'runIfMain() warns when direct execution downgrades supervised profiles',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const fixture = createDirectRunFixture({
                    config: null,
                    fileName: 'direct.test.ts',
                    files: []
                });

                await fixture.runIfMain(fixture.project.meta, passingCase(), { reporters: [] });

                scope.assert.equal(
                    fixture.stderr(),
                    [
                        'Overkill warning: runIfMain() executes in the current process;',
                        'supervised-process isolation is unavailable for direct Node execution.\n'
                    ]
                        .join(' ')
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'runIfMain() rejects cases outside the selected test family',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
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
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'runIfMain() rejects resource-attached microtest cases',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const fixture = createDirectRunFixture({
                    config: null,
                    fileName: 'direct.test.ts',
                    files: []
                });

                await scope.assert.rejects(async function runResourceAttachedCase() {
                    await fixture.runIfMain(fixture.project.meta, resourceAttachedCase(), { reporters: [] });
                }, {
                    message: 'Run profile "microtest" cannot run test cases with resource or runtime attachments.',
                    name: 'RunCollectionError'
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'runIfMain() preserves an existing nonzero process exitCode',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const fixture = createDirectRunFixture({
                    config: null,
                    fileName: 'direct.test.ts',
                    files: []
                });

                fixture.setExitCode(7);
                await fixture.runIfMain(fixture.project.meta, failingCase(), { reporters: [] });

                scope.assert.equal(fixture.exitCode(), 7);

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
