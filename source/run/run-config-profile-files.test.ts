import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { loadRunConfig } from './run-config.ts';
import type { RunProfileFiles } from './run-types.ts';

type LoadedConfig = Awaited<ReturnType<typeof loadRunConfig>>;
type ExpectedProfileFiles = {
    readonly exclude: readonly string[];
    readonly include: readonly [string, ...readonly string[]];
};

async function createTempFolder(): Promise<string> {
    return await fs.mkdtemp(path.join(os.tmpdir(), 'overkill-run-config-profile-files-'));
}

async function writeConfig(folder: string, source: string): Promise<void> {
    await fs.writeFile(path.join(folder, 'overkill.config.js'), source, 'utf8');
}

async function loadConfigFromSource(source: string): Promise<LoadedConfig> {
    const cwd = await createTempFolder();
    await writeConfig(cwd, source);

    return await loadRunConfig({ configPath: null, cwd });
}

function assertProfileFiles(
    files: RunProfileFiles | null,
    expected: ExpectedProfileFiles,
    scope: OverkillScope
): void {
    scope.require.notNull(files);
    scope.assert.deepEqual(files, expected);
}

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/run-config-profile-files.test.ts',
    annotations: {},
    controls: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'loadRunConfig() normalizes profile file discovery',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const config = await loadConfigFromSource(`export const config = {
                    profiles: {
                        microtest: {
                            testFamily: 'microtest',
                            files: {
                                include: [ 'source/**/*.test.ts' ]
                            }
                        },
                        safe: {
                            testFamily: 'microtest',
                            files: {
                                include: [ 'source/unit/**/*.test.ts' ],
                                exclude: [ 'source/unit/**/*.slow.test.ts' ]
                            }
                        }
                    }
                };`);
                const microtestProfile = config.profiles.microtest;
                const safeProfile = config.profiles.safe;

                scope.require.defined(microtestProfile);
                scope.require.defined(safeProfile);
                assertProfileFiles(microtestProfile.files, {
                    exclude: [],
                    include: [ 'source/**/*.test.ts' ]
                }, scope);
                assertProfileFiles(safeProfile.files, {
                    exclude: [ 'source/unit/**/*.slow.test.ts' ],
                    include: [ 'source/unit/**/*.test.ts' ]
                }, scope);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'loadRunConfig() rejects invalid profile file globs',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                await scope.assert.rejects(async function loadInvalidConfig() {
                    await loadConfigFromSource(`export const config = {
                        profiles: {
                            microtest: {
                                testFamily: 'microtest',
                                files: {
                                    include: [ 'source/**/*.test.ts' ],
                                    exclude: [ '!source/**/*.slow.test.ts' ]
                                }
                            }
                        }
                    };`);
                }, {
                    message: /negated glob patterns are not supported/
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'loadRunConfig() normalizes profile file sets',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const config = await loadConfigFromSource(`export const config = {
                    profiles: {
                        microtest: {
                            testFamily: 'microtest',
                            files: {
                                sets: {
                                    unit: {
                                        include: [ 'source/unit/**/*.test.ts' ]
                                    },
                                    integration: {
                                        include: [ 'source/integration/**/*.test.ts' ],
                                        exclude: [ 'source/integration/**/*.slow.test.ts' ]
                                    }
                                }
                            }
                        }
                    }
                };`);
                const microtestProfile = config.profiles.microtest;

                scope.require.defined(microtestProfile);
                scope.require.notNull(microtestProfile.files);
                scope.assert.deepEqual(microtestProfile.files, {
                    sets: {
                        integration: {
                            exclude: [ 'source/integration/**/*.slow.test.ts' ],
                            include: [ 'source/integration/**/*.test.ts' ]
                        },
                        unit: {
                            exclude: [],
                            include: [ 'source/unit/**/*.test.ts' ]
                        }
                    }
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'loadRunConfig() rejects invalid profile file sets',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                await scope.assert.rejects(async function loadMixedFilePolicy() {
                    await loadConfigFromSource(`export const config = {
                        profiles: {
                            microtest: {
                                testFamily: 'microtest',
                                files: {
                                    include: [ 'source/**/*.test.ts' ],
                                    sets: {
                                        unit: { include: [ 'source/unit/**/*.test.ts' ] }
                                    }
                                }
                            }
                        }
                    };`);
                }, { message: /invalid value: expected never/ });
                await scope.assert.rejects(async function loadEmptyFileSets() {
                    await loadConfigFromSource(`export const config = {
                        profiles: {
                            microtest: {
                                testFamily: 'microtest',
                                files: { sets: {} }
                            }
                        }
                    };`);
                }, { message: 'Invalid profile files.sets: at least one file set is required.' });
                await scope.assert.rejects(async function loadInvalidFileSetName() {
                    await loadConfigFromSource(`export const config = {
                        profiles: {
                            microtest: {
                                testFamily: 'microtest',
                                files: {
                                    sets: {
                                        'unit tests': { include: [ 'source/unit/**/*.test.ts' ] }
                                    }
                                }
                            }
                        }
                    };`);
                }, { message: /Invalid profile file set name "unit tests"/ });
                await scope.assert.rejects(async function loadInvalidFileSetGlob() {
                    await loadConfigFromSource(`export const config = {
                        profiles: {
                            microtest: {
                                testFamily: 'microtest',
                                files: {
                                    sets: {
                                        unit: {
                                            exclude: [ '!source/**/*.slow.test.ts' ],
                                            include: [ 'source/unit/**/*.test.ts' ]
                                        }
                                    }
                                }
                            }
                        }
                    };`);
                }, { message: /files\.sets\.unit\.exclude negated glob patterns are not supported/ });

                return scope.assert.collect();
            }
        })
    ]
});
