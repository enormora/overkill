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
import type { Reporter } from '../engine/reporter.ts';
import { runIfMain } from './run-if-main.ts';

type DirectProject = {
    readonly cwd: string;
    readonly file: string;
    readonly meta: Readonly<ImportMeta>;
};

type CapturedExecution = {
    readonly profile: string;
    readonly scheduling: string;
};

type CapturedRun = {
    readonly execution: CapturedExecution;
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
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'overkill-run-if-main-selection-'));
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

function failingBody(scope: DirectScope): ReturnType<DirectTestBody> {
    scope.assert.true(false);

    return scope.assert.collect();
}

function passingCase(): DirectTestNode {
    return createDirectTestCase({
        body: passingBody,
        metadata: {},
        title: 'passes'
    });
}

function failingCase(): DirectTestNode {
    return createDirectTestCase({
        body: failingBody,
        metadata: {},
        title: 'fails'
    });
}

function createCapturingReporter(recordRun: (capturedRun: CapturedRun) => void): Reporter {
    return {
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

export const testSuite = createOverkillSuite({
    title: 'source/run/run-if-main-selection.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            title: 'runIfMain() falls back when a matching profile excludes the direct file',
            metadata: {},
            async body(scope: OverkillScope) {
                const project = await createDirectProject('direct.test.ts');

                await writeConfig(
                    project,
                    `export const config = {
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
                };`
                );

                const capturedRun = await runDirect(project, passingCase());

                scope.assert.equal(capturedRun.execution.profile, 'microtest');
                scope.assert.equal(capturedRun.execution.scheduling, 'serial');

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'runIfMain() rejects non-file import metadata',
            metadata: {},
            async body(scope: OverkillScope) {
                const project = await createDirectProject('direct.test.ts');

                await scope.assert.rejects(async function runWithoutFileUrl() {
                    await withCwd(project.cwd, async function runInProject() {
                        await runIfMain(
                            {
                                ...project.meta,
                                url: 'data:text/javascript,export{}'
                            },
                            passingCase(),
                            { reporters: [] }
                        );
                    });
                }, {
                    message: 'runIfMain() requires a file: import.meta.url.'
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'runIfMain() sets process exitCode for failed direct runs',
            metadata: {},
            async body(scope: OverkillScope) {
                const project = await createDirectProject('direct.test.ts');
                const previousExitCode = process.exitCode;

                process.exitCode = undefined;

                try {
                    await writeConfig(
                        project,
                        `export const config = {
                    profiles: {
                        microtest: {
                            testFamily: 'microtest',
                            execution: { processModel: 'in-process', scheduling: 'concurrent' },
                            resourceUsage: { measure: true }
                        }
                    }
                };`
                    );
                    await withCwd(project.cwd, async function runInProject() {
                        await runIfMain(project.meta, failingCase(), { reporters: [] });
                    });

                    scope.assert.equal(process.exitCode, 1);
                } finally {
                    process.exitCode = previousExitCode;
                }

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testSuite);
