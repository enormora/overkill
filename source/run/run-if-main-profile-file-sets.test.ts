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
import { runIfMain } from './run-if-main.ts';

type DirectProject = {
    readonly cwd: string;
    readonly file: string;
    readonly meta: Readonly<ImportMeta>;
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
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'overkill-run-if-main-file-sets-'));
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

function passingCase(): DirectTestNode {
    return createDirectTestCase({
        body: passingBody,
        definitionLocations: [ { kind: 'unknown' as const } ],
        metadata: {},
        title: 'passes'
    });
}

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/run-if-main-profile-file-sets.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'runIfMain() rejects empty file sets while selecting direct profiles',
            metadata: {},
            async body(scope: OverkillScope) {
                const project = await createDirectProject('direct.test.ts');

                await writeConfig(
                    project,
                    `export const config = {
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
                };`
                );

                await scope.assert.rejects(async function runEmptyFileSetProfile() {
                    await withCwd(project.cwd, async function runInProject() {
                        await runIfMain(project.meta, passingCase(), { reporters: [] });
                    });
                }, { message: 'Profile files.sets.empty matched no test files.' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'runIfMain() rejects a non-microtest fallback profile named microtest',
            metadata: {},
            async body(scope: OverkillScope) {
                const project = await createDirectProject('direct.test.ts');

                await writeConfig(
                    project,
                    `export const config = {
                    profiles: {
                        microtest: {
                            testFamily: 'integration',
                            files: { include: [ 'other.test.ts' ] }
                        }
                    }
                };`
                );
                await fs.writeFile(path.join(project.cwd, 'other.test.ts'), '', 'utf8');

                await scope.assert.rejects(async function runIntegrationFallbackProfile() {
                    await withCwd(project.cwd, async function runInProject() {
                        await runIfMain(project.meta, passingCase(), { reporters: [] });
                    });
                }, { message: 'runIfMain() requires the configured "microtest" profile.' });

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
