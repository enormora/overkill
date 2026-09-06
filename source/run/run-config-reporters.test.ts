import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createLineReporter as createOverkillLineReporter } from '../packages/reporter-line/reporter-line.entry-point.ts';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { loadRunConfig, type LoadedRunConfig } from './run-config.ts';

const reporterConfigSource = `const reporterBrand = Symbol.for('@overkill-dev/engine/reporter');

function reporter(name) {
    return Object.assign({
        dispose: null,
        kind: 'real-time',
        name,
        onEvent() {},
        onFinish: null,
        sinks: [ { kind: 'memory' } ]
    }, { [reporterBrand]: true });
}

export const config = {
    reporters: [ reporter('global') ],
    profiles: {
        microtest: {
            testFamily: 'microtest',
            reporters: [ reporter('profile') ]
        }
    }
};`;

async function createTempFolder(): Promise<string> {
    return await fs.mkdtemp(path.join(os.tmpdir(), 'overkill-run-config-reporters-'));
}

async function writeConfig(folder: string): Promise<void> {
    await fs.writeFile(path.join(folder, 'overkill.config.js'), reporterConfigSource, 'utf8');
}

async function loadReporterConfig(): Promise<LoadedRunConfig> {
    const cwd = await createTempFolder();

    await writeConfig(cwd);

    return await loadRunConfig({ configPath: null, cwd });
}

function reporterNames(scope: OverkillScope, config: LoadedRunConfig): readonly [string, string] {
    const globalReporters = config.reporters;
    const profileReporters = config.profiles.microtest?.reporters;

    scope.require.defined(globalReporters);
    scope.require.defined(profileReporters);
    const globalReporter = globalReporters[0];
    const profileReporter = profileReporters[0];

    scope.require.defined(globalReporter);
    scope.require.defined(profileReporter);

    return [ globalReporter.name, profileReporter.name ];
}

export const testSuite = createOverkillSuite({
    title: 'source/run/run-config-reporters.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            title: 'loadRunConfig() preserves global reporter fallback and profile reporter overrides',
            metadata: {},
            async body(scope: OverkillScope) {
                scope.assert.deepEqual(reporterNames(scope, await loadReporterConfig()), [ 'global', 'profile' ]);

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
