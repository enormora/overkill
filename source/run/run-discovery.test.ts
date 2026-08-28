import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createLineReporter as createOverkillLineReporter } from '@overkill-dev/reporter-line';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '@overkill-dev/engine';
import { discoverRunFiles } from './run-discovery.ts';
import type { RunProfileFiles } from './run-types.ts';

async function withTemporaryDirectory<Result>(run: (directory: string) => Promise<Result>): Promise<Result> {
    const directory = await mkdtemp(join(tmpdir(), 'overkill-discovery-'));

    try {
        return await run(directory);
    } finally {
        await rm(directory, { force: true, recursive: true });
    }
}

async function rejectMissingInputs(scope: OverkillScope, directory: string, filePath: string): Promise<void> {
    await scope.assert.rejects(async function discoverEmptyInput() {
        await discoverRunFiles({ cwd: directory, paths: [], profileFiles: null });
    }, { message: 'No run paths were provided and the selected profile has no file discovery policy.' });
    await scope.assert.rejects(async function discoverMissingCwd() {
        await discoverRunFiles({ cwd: join(directory, 'missing-cwd'), paths: [ filePath ], profileFiles: null });
    }, { message: `Run cwd does not exist: ${join(directory, 'missing-cwd')}` });
    await scope.assert.rejects(async function discoverEmptyPath() {
        await discoverRunFiles({ cwd: directory, paths: [ ' ' ], profileFiles: null });
    }, { message: 'Run path must not be empty.' });
    await scope.assert.rejects(async function discoverMissingPath() {
        await discoverRunFiles({ cwd: directory, paths: [ 'missing.test.ts' ], profileFiles: null });
    }, { message: 'Run path does not exist: missing.test.ts' });
}

async function rejectInvalidFileShapes(
    scope: OverkillScope,
    directory: string,
    filePath: string,
    outsideFilePath: string
): Promise<void> {
    await scope.assert.rejects(async function discoverDirectoryPath() {
        await discoverRunFiles({ cwd: directory, paths: [ '.' ], profileFiles: null });
    }, { message: 'Directory run paths require selected profile file discovery.' });
    await scope.assert.rejects(async function discoverOutsidePath() {
        await discoverRunFiles({ cwd: directory, paths: [ outsideFilePath ], profileFiles: null });
    }, { message: `Run path must stay inside cwd: ${outsideFilePath}` });
    await scope.assert.rejects(async function discoverDuplicatePath() {
        await discoverRunFiles({ cwd: directory, paths: [ 'example.test.ts', filePath ], profileFiles: null });
    }, { message: 'Run path must not be duplicated: example.test.ts' });
}

function profileFiles(files: RunProfileFiles): RunProfileFiles {
    return files;
}

type ProfileDiscoveryTestFiles = {
    readonly firstPath: string;
    readonly secondPath: string;
};

async function createProfileDiscoveryFiles(directory: string): Promise<ProfileDiscoveryTestFiles> {
    const unitDirectory = join(directory, 'source', 'unit');
    const integrationDirectory = join(directory, 'source', 'integration');
    await Promise.all([ mkdir(unitDirectory, { recursive: true }), mkdir(integrationDirectory, { recursive: true }) ]);
    const firstFilePath = join(unitDirectory, 'a.test.ts');
    const secondFilePath = join(unitDirectory, 'b.test.ts');
    const excludedFilePath = join(integrationDirectory, 'slow.test.ts');
    await Promise.all([
        writeFile(firstFilePath, 'export const testNode = null;\n'),
        writeFile(secondFilePath, 'export const testNode = null;\n'),
        writeFile(excludedFilePath, 'export const testNode = null;\n')
    ]);

    return {
        firstPath: await realpath(firstFilePath),
        secondPath: await realpath(secondFilePath)
    };
}

export const testSuite = createOverkillSuite({
    name: 'source/run/run-discovery.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            name: 'discoverRunFiles() resolves canonical file identities under cwd',
            metadata: {},
            async body(scope: OverkillScope) {
                await withTemporaryDirectory(async function testTemporaryDirectory(directory) {
                    const nestedDirectory = join(directory, 'nested');
                    const filePath = join(nestedDirectory, 'example.test.ts');

                    await mkdir(nestedDirectory);
                    await writeFile(filePath, 'export const testNode = null;\n');
                    const realFilePath = await realpath(filePath);

                    const files = await discoverRunFiles({
                        cwd: directory,
                        paths: [ 'nested/example.test.ts' ],
                        profileFiles: null
                    });

                    scope.assert.deepEqual(files, [
                        {
                            file: 'nested/example.test.ts',
                            href: pathToFileURL(realFilePath).href,
                            path: realFilePath
                        }
                    ]);
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'discoverRunFiles() discovers profile files with separate excludes',
            metadata: {},
            async body(scope: OverkillScope) {
                await withTemporaryDirectory(async function testTemporaryDirectory(directory) {
                    const discoveryFiles = await createProfileDiscoveryFiles(directory);

                    const files = await discoverRunFiles({
                        cwd: directory,
                        paths: [],
                        profileFiles: profileFiles({
                            exclude: [ 'source/integration/**/*.test.ts' ],
                            include: [ 'source/**/*.test.ts', 'source/unit/a.test.ts' ]
                        })
                    });

                    scope.assert.deepEqual(files, [
                        {
                            file: 'source/unit/a.test.ts',
                            href: pathToFileURL(discoveryFiles.firstPath).href,
                            path: discoveryFiles.firstPath
                        },
                        {
                            file: 'source/unit/b.test.ts',
                            href: pathToFileURL(discoveryFiles.secondPath).href,
                            path: discoveryFiles.secondPath
                        }
                    ]);
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'discoverRunFiles() ignores profile glob matches that are not files',
            metadata: {},
            async body(scope: OverkillScope) {
                await withTemporaryDirectory(async function testTemporaryDirectory(directory) {
                    await mkdir(join(directory, 'source', 'unit'), { recursive: true });
                    const filePath = join(directory, 'source', 'unit', 'a.test.ts');
                    await writeFile(filePath, 'export const testNode = null;\n');
                    const realFilePath = await realpath(filePath);

                    const files = await discoverRunFiles({
                        cwd: directory,
                        paths: [],
                        profileFiles: profileFiles({
                            exclude: [],
                            include: [ 'source/**' ]
                        })
                    });

                    scope.assert.deepEqual(files, [
                        {
                            file: 'source/unit/a.test.ts',
                            href: pathToFileURL(realFilePath).href,
                            path: realFilePath
                        }
                    ]);
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'discoverRunFiles() reports empty profile discovery',
            metadata: {},
            async body(scope: OverkillScope) {
                await withTemporaryDirectory(async function testTemporaryDirectory(directory) {
                    await scope.assert.rejects(async function discoverEmptyProfileFiles() {
                        await discoverRunFiles({
                            cwd: directory,
                            paths: [],
                            profileFiles: profileFiles({
                                exclude: [],
                                include: [ 'source/**/*.test.ts' ]
                            })
                        });
                    }, { message: 'Profile file discovery matched no test files.' });
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'discoverRunFiles() filters profile discovery by directory operands',
            metadata: {},
            async body(scope: OverkillScope) {
                await withTemporaryDirectory(async function testTemporaryDirectory(directory) {
                    await mkdir(join(directory, 'source', 'integration'), { recursive: true });
                    await mkdir(join(directory, 'source', 'unit', 'nested'), { recursive: true });
                    await writeFile(join(directory, 'source', 'unit', 'a.test.ts'), 'export const testNode = null;\n');
                    await writeFile(
                        join(directory, 'source', 'unit', 'nested', 'b.test.ts'),
                        'export const testNode = null;\n'
                    );
                    await writeFile(
                        join(directory, 'source', 'integration', 'c.test.ts'),
                        'export const testNode = null;\n'
                    );
                    const firstFilePath = await realpath(join(directory, 'source', 'unit', 'a.test.ts'));
                    const secondFilePath = await realpath(join(directory, 'source', 'unit', 'nested', 'b.test.ts'));

                    const files = await discoverRunFiles({
                        cwd: directory,
                        paths: [ 'source/unit', 'source/unit/nested' ],
                        profileFiles: profileFiles({
                            exclude: [],
                            include: [ 'source/**/*.test.ts' ]
                        })
                    });

                    scope.assert.deepEqual(files, [
                        {
                            file: 'source/unit/a.test.ts',
                            href: pathToFileURL(firstFilePath).href,
                            path: firstFilePath
                        },
                        {
                            file: 'source/unit/nested/b.test.ts',
                            href: pathToFileURL(secondFilePath).href,
                            path: secondFilePath
                        }
                    ]);
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'discoverRunFiles() rejects ineffective and mixed directory filters',
            metadata: {},
            async body(scope: OverkillScope) {
                await withTemporaryDirectory(async function testTemporaryDirectory(directory) {
                    await mkdir(join(directory, 'source', 'empty'), { recursive: true });
                    await mkdir(join(directory, 'source', 'unit'), { recursive: true });
                    await writeFile(join(directory, 'source', 'unit', 'a.test.ts'), 'export const testNode = null;\n');
                    const files = profileFiles({
                        exclude: [],
                        include: [ 'source/**/*.test.ts' ]
                    });

                    await scope.assert.rejects(async function discoverMixedPaths() {
                        await discoverRunFiles({
                            cwd: directory,
                            paths: [ 'source/unit/a.test.ts', 'source/unit' ],
                            profileFiles: files
                        });
                    }, { message: 'Run paths must not mix files and directories.' });
                    await scope.assert.rejects(async function discoverIneffectiveDirectory() {
                        await discoverRunFiles({
                            cwd: directory,
                            paths: [ 'source' ],
                            profileFiles: files
                        });
                    }, { message: 'Directory run path did not narrow profile file discovery: source' });
                    await scope.assert.rejects(async function discoverEmptyDirectory() {
                        await discoverRunFiles({
                            cwd: directory,
                            paths: [ 'source/empty' ],
                            profileFiles: files
                        });
                    }, { message: 'Directory run path matched no profile-discovered test files: source/empty' });
                    await scope.assert.rejects(async function discoverDuplicateDirectory() {
                        await discoverRunFiles({
                            cwd: directory,
                            paths: [ 'source/unit', 'source/unit' ],
                            profileFiles: files
                        });
                    }, { message: 'Run path must not be duplicated: source/unit' });
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'discoverRunFiles() rejects directory symlinks outside cwd',
            metadata: {},
            async body(scope: OverkillScope) {
                await withTemporaryDirectory(async function testTemporaryDirectory(directory) {
                    const outsideDirectory = await mkdtemp(join(tmpdir(), 'overkill-outside-'));

                    try {
                        await symlink(outsideDirectory, join(directory, 'outside-link'), 'dir');

                        await scope.assert.rejects(async function discoverOutsideDirectoryLink() {
                            await discoverRunFiles({
                                cwd: directory,
                                paths: [ 'outside-link' ],
                                profileFiles: profileFiles({
                                    exclude: [],
                                    include: [ '**/*.test.ts' ]
                                })
                            });
                        }, { message: 'Run path must stay inside cwd: outside-link' });
                    } finally {
                        await rm(outsideDirectory, { force: true, recursive: true });
                    }
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'discoverRunFiles() rejects unsupported profile glob syntax',
            metadata: {},
            async body(scope: OverkillScope) {
                await withTemporaryDirectory(async function testTemporaryDirectory(directory) {
                    await scope.assert.rejects(async function discoverBlankInclude() {
                        await discoverRunFiles({
                            cwd: directory,
                            paths: [],
                            profileFiles: profileFiles({
                                exclude: [],
                                include: [ ' ' ]
                            })
                        });
                    }, { message: 'Profile files.include glob pattern must not be blank.' });
                    await scope.assert.rejects(async function discoverNegatedInclude() {
                        await discoverRunFiles({
                            cwd: directory,
                            paths: [],
                            profileFiles: profileFiles({
                                exclude: [],
                                include: [ '!source/**/*.test.ts' ]
                            })
                        });
                    }, { message: 'Profile files.include negated glob patterns are not supported.' });
                    await scope.assert.rejects(async function discoverNegatedExclude() {
                        await discoverRunFiles({
                            cwd: directory,
                            paths: [],
                            profileFiles: profileFiles({
                                exclude: [ '!source/**/*.slow.test.ts' ],
                                include: [ 'source/**/*.test.ts' ]
                            })
                        });
                    }, { message: 'Profile files.exclude negated glob patterns are not supported.' });
                    await scope.assert.rejects(async function discoverAbsoluteInclude() {
                        await discoverRunFiles({
                            cwd: directory,
                            paths: [],
                            profileFiles: profileFiles({
                                exclude: [],
                                include: [ join(directory, 'source/**/*.test.ts') ]
                            })
                        });
                    }, { message: 'Profile files.include glob pattern must be relative to cwd.' });
                    await scope.assert.rejects(async function discoverParentExclude() {
                        await discoverRunFiles({
                            cwd: directory,
                            paths: [],
                            profileFiles: profileFiles({
                                exclude: [ '../outside/**/*.test.ts' ],
                                include: [ 'source/**/*.test.ts' ]
                            })
                        });
                    }, { message: 'Profile files.exclude glob pattern must not contain parent segments.' });
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'discoverRunFiles() rejects invalid explicit inputs before import',
            metadata: {},
            async body(scope: OverkillScope) {
                await withTemporaryDirectory(async function testTemporaryDirectory(directory) {
                    const outsideDirectory = await mkdtemp(join(tmpdir(), 'overkill-outside-'));

                    try {
                        const filePath = join(directory, 'example.test.ts');
                        const outsideFilePath = join(outsideDirectory, 'outside.test.ts');

                        await writeFile(filePath, 'export const testNode = null;\n');
                        await writeFile(outsideFilePath, 'export const testNode = null;\n');

                        await rejectMissingInputs(scope, directory, filePath);
                        await rejectInvalidFileShapes(scope, directory, filePath, outsideFilePath);
                        await scope.assert.rejects(async function discoverSpecialFile() {
                            await discoverRunFiles({ cwd: directory, paths: [ '/dev/null' ], profileFiles: null });
                        }, { message: 'Run path must be a file or directory: /dev/null' });
                    } finally {
                        await rm(outsideDirectory, { force: true, recursive: true });
                    }
                });

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
