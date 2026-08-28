import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '@overkill-dev/engine';
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

export const testSuite = createOverkillSuite({
    name: 'source/run/run-config-profile-files.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            name: 'loadRunConfig() normalizes profile file discovery',
            metadata: {},
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
            name: 'loadRunConfig() rejects invalid profile file globs',
            metadata: {},
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
        })
    ]
});
