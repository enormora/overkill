import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { type TestScope, suite, test } from '@overkill-dev/test';

import { configFixtureCwd, createSingleConfigModuleLoader } from '../test-support/run-config-module-loader.ts';
import type { LoadedConfig } from './config-loader.ts';
import type { ProfileFiles } from './types.ts';

type ExpectedProfileFiles = {
    readonly exclude: readonly string[];
    readonly include: readonly [string, ...readonly string[]];
};

async function loadConfigValue(config: unknown): Promise<LoadedConfig> {
    const loadConfig = createSingleConfigModuleLoader('overkill.config.js', { config });

    return await loadConfig({ configPath: null, cwd: configFixtureCwd });
}

const assertProfileFiles = defineCompositeAssertion({
    name: 'profile files',
    assert(check, files: ProfileFiles | null, expected: ExpectedProfileFiles) {
        if (files === null) {
            return check.notNull(files);
        }
        return check.group([ check.notNull(files), check.deepEqual(files, expected) ]);
    }
});

export const testNode = suite('Profile file selection', [
    test('normalizes profile file discovery', async function (scope: TestScope) {
        const config = await loadConfigValue({
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
        });
        const microtestProfile = config.profiles.microtest;
        const safeProfile = config.profiles.safe;

        scope.require.defined(microtestProfile);
        scope.require.defined(safeProfile);
        scope.assert(assertProfileFiles, microtestProfile.files, {
            exclude: [],
            include: [ 'source/**/*.test.ts' ]
        });
        scope.assert(assertProfileFiles, safeProfile.files, {
            exclude: [ 'source/unit/**/*.slow.test.ts' ],
            include: [ 'source/unit/**/*.test.ts' ]
        });

        return scope.assert.collect();
    }),
    test('rejects invalid profile file globs', async function (scope) {
        await scope.assert.rejects(async function loadInvalidConfig() {
            await loadConfigValue({
                profiles: {
                    microtest: {
                        testFamily: 'microtest',
                        files: {
                            include: [ 'source/**/*.test.ts' ],
                            exclude: [ '!source/**/*.slow.test.ts' ]
                        }
                    }
                }
            });
        }, {
            message: /negated glob patterns are not supported/
        });

        return scope.assert.collect();
    }),
    test('normalizes profile file sets', async function (scope: TestScope) {
        const config = await loadConfigValue({
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
        });
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
    }),
    test('rejects invalid profile file sets', async function (scope) {
        await scope.assert.rejects(async function loadMixedFilePolicy() {
            await loadConfigValue({
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
            });
        }, { message: /invalid value: expected never/ });
        await scope.assert.rejects(async function loadEmptyFileSets() {
            await loadConfigValue({
                profiles: {
                    microtest: {
                        testFamily: 'microtest',
                        files: { sets: {} }
                    }
                }
            });
        }, { message: 'Invalid profile files.sets: at least one file set is required.' });
        await scope.assert.rejects(async function loadInvalidFileSetName() {
            await loadConfigValue({
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
            });
        }, { message: /Invalid profile file set name "unit tests"/ });
        await scope.assert.rejects(async function loadInvalidFileSetGlob() {
            await loadConfigValue({
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
            });
        }, { message: /files\.sets\.unit\.exclude negated glob patterns are not supported/ });

        return scope.assert.collect();
    })
]);
