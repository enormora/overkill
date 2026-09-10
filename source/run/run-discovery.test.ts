import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { createVirtualRunDiscovery } from '../test-support/virtual-run-discovery.ts';
import type { DiscoveredRunFile, RunDiscovery } from './run-discovery-types.ts';
import type { RunProfileFiles } from './run-types.ts';

const cwd = '/project';

function discoveredFile(file: string, fileSet: string | null): DiscoveredRunFile {
    const filePath = resolve(cwd, file);

    return {
        file,
        fileSet,
        href: pathToFileURL(filePath).href,
        path: filePath
    };
}

function createDiscovery(files: readonly string[]): RunDiscovery {
    return createVirtualRunDiscovery({
        cwd,
        directories: [],
        files,
        realpaths: {}
    });
}

function profileFiles(files: RunProfileFiles): RunProfileFiles {
    return files;
}

async function rejectMissingInputs(scope: OverkillScope, filePath: string): Promise<void> {
    const discovery = createDiscovery([ filePath ]);

    await scope.assert.rejects(async function discoverEmptyInput() {
        await discovery.discoverRunFiles({ cwd, paths: [], profileFiles: null });
    }, { message: 'No run paths were provided and the selected profile has no file discovery policy.' });
    await scope.assert.rejects(async function discoverMissingCwd() {
        await discovery.discoverRunFiles({ cwd: '/missing-cwd', paths: [ filePath ], profileFiles: null });
    }, { message: 'Run cwd does not exist: /missing-cwd' });
    await scope.assert.rejects(async function discoverEmptyPath() {
        await discovery.discoverRunFiles({ cwd, paths: [ ' ' ], profileFiles: null });
    }, { message: 'Run path must not be empty.' });
    await scope.assert.rejects(async function discoverMissingPath() {
        await discovery.discoverRunFiles({ cwd, paths: [ 'missing.test.ts' ], profileFiles: null });
    }, { message: 'Run path does not exist: missing.test.ts' });
}

async function rejectInvalidFileShapes(
    scope: OverkillScope,
    filePath: string,
    outsideFilePath: string
): Promise<void> {
    const discovery = createVirtualRunDiscovery({
        cwd,
        directories: [ '/outside' ],
        files: [ filePath, outsideFilePath ],
        realpaths: {}
    });

    await scope.assert.rejects(async function discoverDirectoryPath() {
        await discovery.discoverRunFiles({ cwd, paths: [ '.' ], profileFiles: null });
    }, { message: 'Directory run paths require selected profile file discovery.' });
    await scope.assert.rejects(async function discoverOutsidePath() {
        await discovery.discoverRunFiles({ cwd, paths: [ outsideFilePath ], profileFiles: null });
    }, { message: `Run path must stay inside cwd: ${outsideFilePath}` });
    await scope.assert.rejects(async function discoverDuplicatePath() {
        await discovery.discoverRunFiles({ cwd, paths: [ 'example.test.ts', filePath ], profileFiles: null });
    }, { message: 'Run path must not be duplicated: example.test.ts' });
}

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/run-discovery.test.ts',
    annotations: {},
    controls: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'discoverRunFiles() resolves canonical file identities under cwd',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const discovery = createDiscovery([ 'nested/example.test.ts' ]);
                const files = await discovery.discoverRunFiles({
                    cwd,
                    paths: [ 'nested/example.test.ts' ],
                    profileFiles: null
                });

                scope.assert.deepEqual(files, [ discoveredFile('nested/example.test.ts', null) ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'discoverRunFiles() discovers profile files with separate excludes',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const discovery = createDiscovery([
                    'source/unit/a.test.ts',
                    'source/unit/b.test.ts',
                    'source/integration/slow.test.ts'
                ]);
                const files = await discovery.discoverRunFiles({
                    cwd,
                    paths: [],
                    profileFiles: profileFiles({
                        exclude: [ 'source/integration/**/*.test.ts' ],
                        include: [ 'source/**/*.test.ts', 'source/unit/a.test.ts' ]
                    })
                });

                scope.assert.deepEqual(files, [
                    discoveredFile('source/unit/a.test.ts', null),
                    discoveredFile('source/unit/b.test.ts', null)
                ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'discoverRunFiles() ignores profile glob matches that are not files',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const discovery = createVirtualRunDiscovery({
                    cwd,
                    directories: [ 'source/unit' ],
                    files: [ 'source/unit/a.test.ts' ],
                    realpaths: {}
                });
                const files = await discovery.discoverRunFiles({
                    cwd,
                    paths: [],
                    profileFiles: profileFiles({
                        exclude: [],
                        include: [ 'source/**' ]
                    })
                });

                scope.assert.deepEqual(files, [ discoveredFile('source/unit/a.test.ts', null) ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'discoverRunFiles() reports empty profile discovery',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const discovery = createDiscovery([]);

                await scope.assert.rejects(async function discoverEmptyProfileFiles() {
                    await discovery.discoverRunFiles({
                        cwd,
                        paths: [],
                        profileFiles: profileFiles({
                            exclude: [],
                            include: [ 'source/**/*.test.ts' ]
                        })
                    });
                }, { message: 'Profile file discovery matched no test files.' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'discoverRunFiles() filters profile discovery by directory operands',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const discovery = createDiscovery([
                    'source/unit/a.test.ts',
                    'source/unit/nested/b.test.ts',
                    'source/integration/c.test.ts'
                ]);
                const files = await discovery.discoverRunFiles({
                    cwd,
                    paths: [ 'source/unit', 'source/unit/nested' ],
                    profileFiles: profileFiles({
                        exclude: [],
                        include: [ 'source/**/*.test.ts' ]
                    })
                });

                scope.assert.deepEqual(files, [
                    discoveredFile('source/unit/a.test.ts', null),
                    discoveredFile('source/unit/nested/b.test.ts', null)
                ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'discoverRunFiles() rejects ineffective and mixed directory filters',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const discovery = createVirtualRunDiscovery({
                    cwd,
                    directories: [ 'source/empty' ],
                    files: [ 'source/unit/a.test.ts' ],
                    realpaths: {}
                });
                const files = profileFiles({
                    exclude: [],
                    include: [ 'source/**/*.test.ts' ]
                });

                await scope.assert.rejects(async function discoverMixedPaths() {
                    await discovery.discoverRunFiles({
                        cwd,
                        paths: [ 'source/unit/a.test.ts', 'source/unit' ],
                        profileFiles: files
                    });
                }, { message: 'Run paths must not mix files and directories.' });
                await scope.assert.rejects(async function discoverIneffectiveDirectory() {
                    await discovery.discoverRunFiles({
                        cwd,
                        paths: [ 'source' ],
                        profileFiles: files
                    });
                }, { message: 'Directory run path did not narrow profile file discovery: source' });
                await scope.assert.rejects(async function discoverEmptyDirectory() {
                    await discovery.discoverRunFiles({
                        cwd,
                        paths: [ 'source/empty' ],
                        profileFiles: files
                    });
                }, { message: 'Directory run path matched no profile-discovered test files: source/empty' });
                await scope.assert.rejects(async function discoverDuplicateDirectory() {
                    await discovery.discoverRunFiles({
                        cwd,
                        paths: [ 'source/unit', 'source/unit' ],
                        profileFiles: files
                    });
                }, { message: 'Run path must not be duplicated: source/unit' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'discoverRunFiles() rejects directory symlinks outside cwd',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const discovery = createVirtualRunDiscovery({
                    cwd,
                    directories: [ 'outside-link', '/outside' ],
                    files: [],
                    realpaths: {
                        'outside-link': '/outside'
                    }
                });

                await scope.assert.rejects(async function discoverOutsideDirectoryLink() {
                    await discovery.discoverRunFiles({
                        cwd,
                        paths: [ 'outside-link' ],
                        profileFiles: profileFiles({
                            exclude: [],
                            include: [ '**/*.test.ts' ]
                        })
                    });
                }, { message: 'Run path must stay inside cwd: outside-link' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'discoverRunFiles() rejects unsupported profile glob syntax',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const discovery = createDiscovery([]);

                await scope.assert.rejects(async function discoverBlankInclude() {
                    await discovery.discoverRunFiles({
                        cwd,
                        paths: [],
                        profileFiles: profileFiles({
                            exclude: [],
                            include: [ ' ' ]
                        })
                    });
                }, { message: 'Profile files.include glob pattern must not be blank.' });
                await scope.assert.rejects(async function discoverNegatedInclude() {
                    await discovery.discoverRunFiles({
                        cwd,
                        paths: [],
                        profileFiles: profileFiles({
                            exclude: [],
                            include: [ '!source/**/*.test.ts' ]
                        })
                    });
                }, { message: 'Profile files.include negated glob patterns are not supported.' });
                await scope.assert.rejects(async function discoverNegatedExclude() {
                    await discovery.discoverRunFiles({
                        cwd,
                        paths: [],
                        profileFiles: profileFiles({
                            exclude: [ '!source/**/*.slow.test.ts' ],
                            include: [ 'source/**/*.test.ts' ]
                        })
                    });
                }, { message: 'Profile files.exclude negated glob patterns are not supported.' });
                await scope.assert.rejects(async function discoverAbsoluteInclude() {
                    await discovery.discoverRunFiles({
                        cwd,
                        paths: [],
                        profileFiles: profileFiles({
                            exclude: [],
                            include: [ '/project/source/**/*.test.ts' ]
                        })
                    });
                }, { message: 'Profile files.include glob pattern must be relative to cwd.' });
                await scope.assert.rejects(async function discoverParentExclude() {
                    await discovery.discoverRunFiles({
                        cwd,
                        paths: [],
                        profileFiles: profileFiles({
                            exclude: [ '../outside/**/*.test.ts' ],
                            include: [ 'source/**/*.test.ts' ]
                        })
                    });
                }, { message: 'Profile files.exclude glob pattern must not contain parent segments.' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'discoverRunFiles() rejects invalid explicit inputs before import',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                await rejectMissingInputs(scope, 'example.test.ts');
                await rejectInvalidFileShapes(scope, 'example.test.ts', '/outside/outside.test.ts');
                await scope.assert.rejects(async function discoverSpecialFile() {
                    await createDiscovery([ 'example.test.ts' ]).discoverRunFiles({
                        cwd,
                        paths: [ '/dev/null' ],
                        profileFiles: null
                    });
                }, { message: 'Run path does not exist: /dev/null' });

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
