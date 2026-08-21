import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createLineReporter as createOverkillLineReporter } from '@overkill-dev/reporter-line';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '@overkill-dev/engine';
import { loadRunConfig, RunConfigError } from './run-config.ts';

async function createTempFolder(): Promise<string> {
    return await fs.mkdtemp(path.join(os.tmpdir(), 'overkill-run-config-'));
}

async function writeConfig(folder: string, fileName: string, source: string): Promise<string> {
    const filePath = path.join(folder, fileName);

    await fs.writeFile(filePath, source, 'utf8');

    return filePath;
}

export const testSuite = createOverkillSuite({
    name: 'source/run/run-config-exports.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            name: 'loadRunConfig() accepts branded reporter and output renderer values',
            metadata: {},
            async body(scope: OverkillScope) {
                const cwd = await createTempFolder();
                await writeConfig(
                    cwd,
                    'custom.config.js',
                    `const outputRendererBrand = Symbol.for('@overkill-dev/engine/output-renderer');
                    const reporterBrand = Symbol.for('@overkill-dev/engine/reporter');

                    const outputRenderer = Object.assign({
                        render(intent) {
                            return \`rendered \${intent.text}\`;
                        }
                    }, { [outputRendererBrand]: true });

                    export const config = {
                        outputRenderer,
                        reporters: [
                            Object.assign({
                                dispose: null,
                                kind: 'real-time',
                                name: 'configured-memory',
                                onEvent() {},
                                onFinish: null,
                                sinks: [ { kind: 'memory' } ]
                            }, { [reporterBrand]: true })
                        ]
                    };`
                );
                const config = await loadRunConfig({ configPath: 'custom.config.js', cwd });

                scope.require.defined(config.reporters);
                scope.assert.equal(
                    config.outputRenderer.render({
                        annotation: null,
                        kind: 'stdout-line',
                        role: 'primary',
                        text: 'line'
                    }),
                    'rendered line'
                );
                scope.assert.equal(config.reporters[0].name, 'configured-memory');

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'loadRunConfig() rejects unbranded reporter values',
            metadata: {},
            async body(scope: OverkillScope) {
                const cwd = await createTempFolder();
                await writeConfig(
                    cwd,
                    'overkill.config.js',
                    `export const config = {
                        reporters: [
                            {
                                dispose: null,
                                kind: 'real-time',
                                name: 'unbranded',
                                onEvent() {},
                                onFinish: null,
                                sinks: [ { kind: 'memory' } ]
                            }
                        ]
                    };`
                );

                await scope.assert.rejects(async function loadInvalidConfig() {
                    await loadRunConfig({ configPath: null, cwd });
                }, {
                    message: /defineReporter/
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'loadRunConfig() rejects unbranded output renderer values',
            metadata: {},
            async body(scope: OverkillScope) {
                const cwd = await createTempFolder();
                await writeConfig(
                    cwd,
                    'overkill.config.js',
                    `export const config = {
                        outputRenderer: {
                            render(intent) {
                                return intent.text;
                            }
                        }
                    };`
                );

                await scope.assert.rejects(async function loadInvalidConfig() {
                    await loadRunConfig({ configPath: null, cwd });
                }, {
                    message: /defineOutputRenderer/
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'loadRunConfig() rejects config files without a named config export',
            metadata: {},
            async body(scope: OverkillScope) {
                const cwd = await createTempFolder();
                await writeConfig(cwd, 'overkill.config.js', 'export const projectConfig = {};');

                await scope.assert.rejects(async function loadInvalidConfig() {
                    await loadRunConfig({ configPath: null, cwd });
                }, {
                    type: RunConfigError,
                    message: /must export a named config value/
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'loadRunConfig() rejects config files with a default export',
            metadata: {},
            async body(scope: OverkillScope) {
                const cwd = await createTempFolder();
                await writeConfig(cwd, 'overkill.config.js', 'export default {};');

                await scope.assert.rejects(async function loadInvalidConfig() {
                    await loadRunConfig({ configPath: null, cwd });
                }, {
                    type: RunConfigError,
                    message: /must not export a default config/
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'loadRunConfig() rejects config files with named config and default exports',
            metadata: {},
            async body(scope: OverkillScope) {
                const cwd = await createTempFolder();
                await writeConfig(cwd, 'overkill.config.js', 'export const config = {}; export default {};');

                await scope.assert.rejects(async function loadInvalidConfig() {
                    await loadRunConfig({ configPath: null, cwd });
                }, {
                    type: RunConfigError,
                    message: /must not export a default config/
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'loadRunConfig() rejects config files with extra runtime exports',
            metadata: {},
            async body(scope: OverkillScope) {
                const cwd = await createTempFolder();
                await writeConfig(cwd, 'overkill.config.js', 'export const config = {}; export const extra = {};');

                await scope.assert.rejects(async function loadInvalidConfig() {
                    await loadRunConfig({ configPath: null, cwd });
                }, {
                    type: RunConfigError,
                    message: /must only export a named config value/
                });

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
