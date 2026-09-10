import {
    createTestCase as createDirectTestCase,
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestBody as DirectTestBody,
    type TestNode as DirectTestNode,
    type TestScope as DirectScope,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import type { DefinedReporter } from '../engine/reporter.ts';
import {
    createDirectRunFixture,
    type DirectRunFixture
} from '../test-support/direct-run-fixture.ts';
import { defineFixedReporter } from '../test-support/reporter-definition.ts';

type CapturedExecution = {
    readonly profile: string;
    readonly scheduling: string;
};

type CapturedRun = {
    readonly execution: CapturedExecution;
};

function passingBody(scope: DirectScope): ReturnType<DirectTestBody> {
    scope.assert.true(true);

    return scope.assert.collect();
}

function failingBody(scope: DirectScope): ReturnType<DirectTestBody> {
    scope.assert.true(false);

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

function failingCase(): DirectTestNode {
    return createDirectTestCase({
        body: failingBody,
        definitionLocations: [ { kind: 'unknown' as const } ],
        annotations: {},
        controls: {},
        title: 'fails'
    });
}

function createCapturingReporter(recordRun: (capturedRun: CapturedRun) => void): DefinedReporter {
    return defineFixedReporter({
        dispose: null,
        kind: 'real-time',
        name: 'capture-direct-run',
        onEvent(event) {
            if (event.kind === 'run-start') {
                const facts = event.facts as { readonly execution: CapturedExecution; };

                recordRun({ execution: facts.execution });
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
    title: 'source/run/run-if-main-selection.test.ts',
    annotations: {},
    controls: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'runIfMain() falls back when a matching profile excludes the direct file',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const fixture = createDirectRunFixture({
                    config: {
                        profiles: {
                            microtest: {
                                testFamily: 'microtest',
                                execution: { processModel: 'in-process', scheduling: 'serial' }
                            },
                            focused: {
                                testFamily: 'microtest',
                                files: {
                                    include: [ 'direct.test.ts' ],
                                    exclude: [ 'direct.test.ts' ]
                                },
                                execution: { processModel: 'in-process', scheduling: 'concurrent' }
                            }
                        }
                    },
                    fileName: 'direct.test.ts',
                    files: []
                });
                const capturedRun = await runDirect(fixture, passingCase());

                scope.assert.equal(capturedRun.execution.profile, 'microtest');
                scope.assert.equal(capturedRun.execution.scheduling, 'serial');

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'runIfMain() rejects non-file import metadata',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const fixture = createDirectRunFixture({
                    config: null,
                    fileName: 'direct.test.ts',
                    files: []
                });

                await scope.assert.rejects(async function runWithoutFileUrl() {
                    await fixture.runIfMain(
                        {
                            ...fixture.project.meta,
                            url: 'data:text/javascript,export{}'
                        },
                        passingCase(),
                        { reporters: [] }
                    );
                }, {
                    message: 'runIfMain() requires a file: import.meta.url.'
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'runIfMain() sets process exitCode for failed direct runs',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const fixture = createDirectRunFixture({
                    config: {
                        profiles: {
                            microtest: {
                                testFamily: 'microtest',
                                execution: { processModel: 'in-process', scheduling: 'concurrent' },
                                resourceUsage: { measure: true }
                            }
                        }
                    },
                    fileName: 'direct.test.ts',
                    files: []
                });

                fixture.setExitCode(undefined);
                await fixture.runIfMain(fixture.project.meta, failingCase(), { reporters: [] });

                scope.assert.equal(fixture.exitCode(), 1);

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
