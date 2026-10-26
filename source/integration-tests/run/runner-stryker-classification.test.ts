import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runIfMain } from '#test-runner';
import { suite, test } from '../../packages/test/test.entry-point.ts';
import { createLineReporter } from '../../packages/reporter-line/reporter-line.entry-point.ts';
import { adapterUrl, engineUrl, configUrl } from './stryker-lifecycle-fixture.test.ts';
import { executeMutationScript } from './stryker-script.test.ts';
import { strykerClassificationScript } from './stryker-classification-scripts.test.ts';

const consoleLines: Readonly<Record<string, string>> = {
    console: 'console sentinel\n',
    'cleanup-policy': 'cleanup policy sentinel\n'
};

const scenarios = [
    'assertion',
    'body',
    'contract',
    'console',
    'permission',
    'leak',
    'rejection',
    'exception',
    'cleanup',
    'cleanup-policy',
    'kill-cleanup-timeout',
    'kill-cleanup-error-timeout',
    'continued-timeout',
    'continued-cleanup-error-timeout'
];
const modes = [
    { processModel: 'in-process', freshState: false },
    { processModel: 'in-process', freshState: true },
    { processModel: 'supervised-process', freshState: false }
];

export const testNode = suite(
    'Stryker mutant classification',
    modes.flatMap(function executionMode(mode) {
        const cases = mode.freshState || mode.processModel === 'supervised-process'
            ? [ ...scenarios, 'pre-case' ]
            : scenarios;
        return cases.map(function classificationScenario(scenario) {
            return test(
                `${mode.processModel} freshState ${String(mode.freshState)} ${scenario}`,
                async function (scope) {
                    const cwd = await realpath(await mkdtemp(join(tmpdir(), 'overkill-stryker-classification-')));
                    scope.cleanup(async function removeProject() {
                        await rm(cwd, { recursive: true, force: true });
                    });
                    const output = await executeMutationScript(strykerClassificationScript, [
                        adapterUrl,
                        engineUrl,
                        configUrl,
                        import.meta.resolve('@stryker-mutator/instrumenter'),
                        mode.processModel,
                        String(mode.freshState),
                        scenario,
                        import.meta.resolve('@stryker-mutator/api/test-runner')
                    ], cwd);
                    const prefix = mode.processModel === 'in-process' && !mode.freshState
                        ? consoleLines[scenario] ?? ''
                        : '';
                    scope.assert.equal(output, `${prefix}classification passed\n`);
                    return scope.assert.collect();
                }
            );
        });
    })
);

await runIfMain(import.meta, testNode, { reporters: [ createLineReporter() ] });
