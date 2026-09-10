import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { discoverRunFiles } from './run-discovery.ts';
import type { RunProfileFiles } from './run-types.ts';

async function withTemporaryDirectory<Result>(run: (directory: string) => Promise<Result>): Promise<Result> {
    const directory = await mkdtemp(join(tmpdir(), 'overkill-file-sets-'));

    try {
        return await run(directory);
    } finally {
        await rm(directory, { force: true, recursive: true });
    }
}

function profileFiles(files: RunProfileFiles): RunProfileFiles {
    return files;
}

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/run-profile-file-sets.test.ts',
    annotations: {},
    controls: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'discoverRunFiles() discovers profile file sets',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                await withTemporaryDirectory(async function testTemporaryDirectory(directory) {
                    await mkdir(join(directory, 'source', 'integration'), { recursive: true });
                    await mkdir(join(directory, 'source', 'unit'), { recursive: true });
                    await writeFile(join(directory, 'source', 'unit', 'a.test.ts'), 'export const testNode = null;\n');
                    await writeFile(
                        join(directory, 'source', 'integration', 'b.test.ts'),
                        'export const testNode = null;\n'
                    );
                    await writeFile(
                        join(directory, 'source', 'integration', 'slow.test.ts'),
                        'export const testNode = null;\n'
                    );
                    const unitPath = await realpath(join(directory, 'source', 'unit', 'a.test.ts'));
                    const integrationPath = await realpath(join(directory, 'source', 'integration', 'b.test.ts'));

                    const files = await discoverRunFiles({
                        cwd: directory,
                        paths: [],
                        profileFiles: profileFiles({
                            sets: {
                                integration: {
                                    exclude: [ 'source/integration/slow.test.ts' ],
                                    include: [ 'source/integration/**/*.test.ts' ]
                                },
                                unit: {
                                    exclude: [],
                                    include: [ 'source/unit/**/*.test.ts' ]
                                }
                            }
                        })
                    });

                    scope.assert.deepEqual(files, [
                        {
                            fileSet: 'integration',
                            file: 'source/integration/b.test.ts',
                            href: pathToFileURL(integrationPath).href,
                            path: integrationPath
                        },
                        {
                            fileSet: 'unit',
                            file: 'source/unit/a.test.ts',
                            href: pathToFileURL(unitPath).href,
                            path: unitPath
                        }
                    ]);
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'discoverRunFiles() rejects empty and overlapping profile file sets',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                await withTemporaryDirectory(async function testTemporaryDirectory(directory) {
                    await mkdir(join(directory, 'source', 'unit'), { recursive: true });
                    await writeFile(join(directory, 'source', 'unit', 'a.test.ts'), 'export const testNode = null;\n');

                    await scope.assert.rejects(async function discoverEmptySet() {
                        await discoverRunFiles({
                            cwd: directory,
                            paths: [],
                            profileFiles: profileFiles({
                                sets: {
                                    empty: {
                                        exclude: [],
                                        include: [ 'source/missing/**/*.test.ts' ]
                                    }
                                }
                            })
                        });
                    }, { message: 'Profile files.sets.empty matched no test files.' });
                    await scope.assert.rejects(async function discoverOverlappingSets() {
                        await discoverRunFiles({
                            cwd: directory,
                            paths: [],
                            profileFiles: profileFiles({
                                sets: {
                                    first: {
                                        exclude: [],
                                        include: [ 'source/unit/**/*.test.ts' ]
                                    },
                                    second: {
                                        exclude: [],
                                        include: [ 'source/**/*.test.ts' ]
                                    }
                                }
                            })
                        });
                    }, {
                        message: 'Profile file sets must not overlap: source/unit/a.test.ts matched first and second.'
                    });
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'discoverRunFiles() filters profile file sets by directory operands',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                await withTemporaryDirectory(async function testTemporaryDirectory(directory) {
                    await mkdir(join(directory, 'source', 'integration'), { recursive: true });
                    await mkdir(join(directory, 'source', 'unit'), { recursive: true });
                    await writeFile(join(directory, 'source', 'unit', 'a.test.ts'), 'export const testNode = null;\n');
                    await writeFile(
                        join(directory, 'source', 'integration', 'b.test.ts'),
                        'export const testNode = null;\n'
                    );
                    const unitPath = await realpath(join(directory, 'source', 'unit', 'a.test.ts'));

                    const files = await discoverRunFiles({
                        cwd: directory,
                        paths: [ 'source/unit' ],
                        profileFiles: profileFiles({
                            sets: {
                                integration: {
                                    exclude: [],
                                    include: [ 'source/integration/**/*.test.ts' ]
                                },
                                unit: {
                                    exclude: [],
                                    include: [ 'source/unit/**/*.test.ts' ]
                                }
                            }
                        })
                    });

                    scope.assert.deepEqual(files, [
                        {
                            fileSet: 'unit',
                            file: 'source/unit/a.test.ts',
                            href: pathToFileURL(unitPath).href,
                            path: unitPath
                        }
                    ]);
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'discoverRunFiles() validates explicit files against profile file sets',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                await withTemporaryDirectory(async function testTemporaryDirectory(directory) {
                    await mkdir(join(directory, 'source', 'other'), { recursive: true });
                    await mkdir(join(directory, 'source', 'unit'), { recursive: true });
                    await writeFile(join(directory, 'source', 'unit', 'a.test.ts'), 'export const testNode = null;\n');
                    await writeFile(join(directory, 'source', 'other', 'b.test.ts'), 'export const testNode = null;\n');
                    const unitPath = await realpath(join(directory, 'source', 'unit', 'a.test.ts'));
                    const files = profileFiles({
                        sets: {
                            unit: {
                                exclude: [],
                                include: [ 'source/unit/**/*.test.ts' ]
                            }
                        }
                    });

                    scope.assert.deepEqual(
                        await discoverRunFiles({
                            cwd: directory,
                            paths: [ 'source/unit/a.test.ts' ],
                            profileFiles: files
                        }),
                        [
                            {
                                fileSet: 'unit',
                                file: 'source/unit/a.test.ts',
                                href: pathToFileURL(unitPath).href,
                                path: unitPath
                            }
                        ]
                    );
                    await scope.assert.rejects(async function discoverExplicitOutsideSet() {
                        await discoverRunFiles({
                            cwd: directory,
                            paths: [ 'source/other/b.test.ts' ],
                            profileFiles: files
                        });
                    }, { message: 'Run file must match exactly one profile file set: source/other/b.test.ts' });
                    await scope.assert.rejects(async function discoverExplicitWithOverlappingSets() {
                        await discoverRunFiles({
                            cwd: directory,
                            paths: [ 'source/unit/a.test.ts' ],
                            profileFiles: profileFiles({
                                sets: {
                                    first: {
                                        exclude: [],
                                        include: [ 'source/unit/**/*.test.ts' ]
                                    },
                                    second: {
                                        exclude: [],
                                        include: [ 'source/**/*.test.ts' ]
                                    }
                                }
                            })
                        });
                    }, {
                        message: 'Profile file sets must not overlap: source/unit/a.test.ts matched first and second.'
                    });
                });

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
