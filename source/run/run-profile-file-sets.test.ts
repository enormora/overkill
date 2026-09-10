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
                const discovery = createDiscovery([
                    'source/unit/a.test.ts',
                    'source/integration/b.test.ts',
                    'source/integration/slow.test.ts'
                ]);
                const files = await discovery.discoverRunFiles({
                    cwd,
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
                    discoveredFile('source/integration/b.test.ts', 'integration'),
                    discoveredFile('source/unit/a.test.ts', 'unit')
                ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'discoverRunFiles() rejects empty and overlapping profile file sets',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const discovery = createDiscovery([ 'source/unit/a.test.ts' ]);

                await scope.assert.rejects(async function discoverEmptySet() {
                    await discovery.discoverRunFiles({
                        cwd,
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
                    await discovery.discoverRunFiles({
                        cwd,
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

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'discoverRunFiles() filters profile file sets by directory operands',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const discovery = createDiscovery([
                    'source/unit/a.test.ts',
                    'source/integration/b.test.ts'
                ]);
                const files = await discovery.discoverRunFiles({
                    cwd,
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

                scope.assert.deepEqual(files, [ discoveredFile('source/unit/a.test.ts', 'unit') ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'discoverRunFiles() validates explicit files against profile file sets',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const discovery = createDiscovery([
                    'source/unit/a.test.ts',
                    'source/other/b.test.ts'
                ]);
                const files = profileFiles({
                    sets: {
                        unit: {
                            exclude: [],
                            include: [ 'source/unit/**/*.test.ts' ]
                        }
                    }
                });

                scope.assert.deepEqual(
                    await discovery.discoverRunFiles({
                        cwd,
                        paths: [ 'source/unit/a.test.ts' ],
                        profileFiles: files
                    }),
                    [ discoveredFile('source/unit/a.test.ts', 'unit') ]
                );
                await scope.assert.rejects(async function discoverExplicitOutsideSet() {
                    await discovery.discoverRunFiles({
                        cwd,
                        paths: [ 'source/other/b.test.ts' ],
                        profileFiles: files
                    });
                }, { message: 'Run file must match exactly one profile file set: source/other/b.test.ts' });
                await scope.assert.rejects(async function discoverExplicitWithOverlappingSets() {
                    await discovery.discoverRunFiles({
                        cwd,
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

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
