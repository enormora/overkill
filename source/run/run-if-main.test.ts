import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
    createTestCase as createDirectTestCase,
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestBody as DirectTestBody,
    type TestNode as DirectTestNode,
    type TestScope as DirectScope,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import type {
    DefinedReporter,
    ReporterEvent
} from '../engine/reporter.ts';
import { defineFixedReporter } from '../test-support/reporter-definition.ts';
import { runIfMain } from './run-if-main.ts';
import type { RunFacts } from './run-types.ts';

type DirectProject = {
    readonly cwd: string;
    readonly file: string;
    readonly meta: Readonly<ImportMeta>;
};

type CapturedRun = {
    readonly facts: RunFacts;
    readonly rootTitle: string;
};

type StderrCapture = {
    readonly read: () => string;
    readonly restore: () => void;
};

function importMeta(file: string): Readonly<ImportMeta> {
    return {
        dirname: path.dirname(file),
        filename: file,
        main: true,
        resolve(specifier: string) {
            return import.meta.resolve(specifier);
        },
        url: pathToFileURL(file).href
    };
}

async function createDirectProject(fileName: string): Promise<DirectProject> {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'overkill-run-if-main-'));
    const file = path.join(cwd, fileName);

    await fs.writeFile(file, '', 'utf8');

    return {
        cwd,
        file,
        meta: importMeta(file)
    };
}

async function writeConfig(project: DirectProject, source: string): Promise<void> {
    await fs.writeFile(path.join(project.cwd, 'overkill.config.js'), source, 'utf8');
}

async function withCwd<Value>(cwd: string, work: () => Promise<Value>): Promise<Value> {
    const originalCwd = process.cwd();

    process.chdir(cwd);

    try {
        return await work();
    } finally {
        process.chdir(originalCwd);
    }
}

function passingBody(scope: DirectScope): ReturnType<DirectTestBody> {
    scope.assert.true(true);

    return scope.assert.collect();
}

function passingCase(metadata: DirectTestNode['metadata'] = {}): DirectTestNode {
    return createDirectTestCase({
        body: passingBody,
        definitionLocations: [ { kind: 'unknown' as const } ],
        metadata,
        title: 'passes'
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

function captureStderr(): StderrCapture {
    const originalWrite = process.stderr.write.bind(process.stderr);
    let captured = '';

    process.stderr.write = function writeCapturedStderr(chunk: Uint8Array | string): boolean {
        captured += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');

        return true;
    };

    return {
        read() {
            return captured;
        },
        restore() {
            process.stderr.write = originalWrite;
        }
    };
}

async function runDirect(project: DirectProject, testNode: DirectTestNode): Promise<CapturedRun> {
    const capturedRuns: CapturedRun[] = [];

    await withCwd(project.cwd, async function runInProject() {
        await runIfMain(project.meta, testNode, {
            reporters: [
                createCapturingReporter(function recordRun(capturedRun) {
                    capturedRuns.push(capturedRun);
                })
            ]
        });
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
    metadata: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'runIfMain() returns before config loading when imported',
            metadata: {},
            async body(scope: OverkillScope) {
                const project = await createDirectProject('direct.test.ts');

                await writeConfig(project, 'throw new Error("config should not load");');
                await withCwd(project.cwd, async function runImportedModule() {
                    await runIfMain(
                        {
                            ...project.meta,
                            main: false
                        },
                        passingCase(),
                        { reporters: [] }
                    );
                });

                scope.assert.true(true);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'runIfMain() selects the configured profile matching the current file',
            metadata: {},
            async body(scope: OverkillScope) {
                const project = await createDirectProject('direct.test.ts');

                await writeConfig(
                    project,
                    `export const config = {
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
                };`
                );

                const capturedRun = await runDirect(project, passingCase());

                scope.assert.equal(capturedRun.facts.execution.profile, 'focused');
                scope.assert.equal(capturedRun.facts.execution.scheduling, 'serial');
                scope.assert.equal(capturedRun.facts.execution.processModel, 'in-process');
                scope.assert.equal(capturedRun.rootTitle, await fs.realpath(project.cwd));

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'runIfMain() falls back to configured microtest when no profile matches',
            metadata: {},
            async body(scope: OverkillScope) {
                const project = await createDirectProject('direct.test.ts');

                await writeConfig(
                    project,
                    `export const config = {
                    profiles: {
                        microtest: {
                            testFamily: 'microtest',
                            files: { include: [ 'other.test.ts' ] },
                            execution: { processModel: 'in-process', scheduling: 'serial' }
                        }
                    }
                };`
                );

                const capturedRun = await runDirect(project, passingCase());

                scope.assert.equal(capturedRun.facts.execution.profile, 'microtest');
                scope.assert.equal(capturedRun.facts.execution.scheduling, 'serial');

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'runIfMain() rejects ambiguous profile file matches',
            metadata: {},
            async body(scope: OverkillScope) {
                const project = await createDirectProject('direct.test.ts');

                await writeConfig(
                    project,
                    `export const config = {
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
                };`
                );

                await scope.assert.rejects(async function runAmbiguousFile() {
                    await withCwd(project.cwd, async function runInProject() {
                        await runIfMain(project.meta, passingCase(), { reporters: [] });
                    });
                }, {
                    message: 'runIfMain() matched multiple profiles for "direct.test.ts": microtest, focused.'
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'runIfMain() warns when direct execution downgrades supervised profiles',
            metadata: {},
            async body(scope: OverkillScope) {
                const project = await createDirectProject('direct.test.ts');
                const stderr = captureStderr();

                try {
                    await withCwd(project.cwd, async function runDefaultProfile() {
                        await runIfMain(project.meta, passingCase(), { reporters: [] });
                    });
                } finally {
                    stderr.restore();
                }

                scope.assert.equal(
                    stderr.read(),
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
            title: 'runIfMain() rejects root metadata outside the selected test family',
            metadata: {},
            async body(scope: OverkillScope) {
                const project = await createDirectProject('direct.test.ts');

                await scope.assert.rejects(async function runWrongRootFamily() {
                    await withCwd(project.cwd, async function runInProject() {
                        await runIfMain(project.meta, passingCase(), {
                            reporters: [],
                            root: {
                                metadata: { kind: 'integration' },
                                title: 'root'
                            }
                        });
                    });
                }, {
                    message: 'runIfMain() root metadata.kind must be "microtest".'
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'runIfMain() rejects cases outside the selected test family',
            metadata: {},
            async body(scope: OverkillScope) {
                const project = await createDirectProject('direct.test.ts');

                await scope.assert.rejects(async function runWrongCaseFamily() {
                    await withCwd(project.cwd, async function runInProject() {
                        await runIfMain(project.meta, passingCase({ kind: 'integration' }), { reporters: [] });
                    });
                }, {
                    message: /metadata\.kind "integration"/u,
                    name: 'RunCollectionError'
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'runIfMain() preserves an existing nonzero process exitCode',
            metadata: {},
            async body(scope: OverkillScope) {
                const project = await createDirectProject('direct.test.ts');
                const previousExitCode = process.exitCode;

                process.exitCode = 7;

                try {
                    await withCwd(project.cwd, async function runFailingCase() {
                        await runIfMain(
                            project.meta,
                            createDirectTestCase({
                                body(testScope) {
                                    testScope.assert.true(false);

                                    return testScope.assert.collect();
                                },
                                definitionLocations: [ { kind: 'unknown' as const } ],
                                metadata: {},
                                title: 'fails'
                            }),
                            { reporters: [] }
                        );
                    });

                    scope.assert.equal(process.exitCode, 7);
                } finally {
                    process.exitCode = previousExitCode;
                }

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
