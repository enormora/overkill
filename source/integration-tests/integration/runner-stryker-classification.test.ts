import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { table, type TestNode, suite } from '@overkill-dev/test';

import { adapterUrl, engineUrl, configUrl } from './support/stryker-lifecycle-fixture.ts';
import { executeMutationScript } from './support/stryker-script.ts';
import { strykerClassificationScript } from './support/stryker-classification-scripts.ts';

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

export const testNode: TestNode = suite(
    'Stryker mutant classification',
    [ table({
        title: 'classifies mutant outcomes across execution boundaries',
        cases: modes.flatMap(function executionMode(mode) {
            const cases = mode.freshState || mode.processModel === 'supervised-process'
                ? [ ...scenarios, 'pre-case' ]
                : scenarios;
            return cases.map(function classificationScenario(scenario) {
                return { mode, scenario };
            });
        }),
        caseTitle({ mode, scenario }) {
            return [ mode.processModel, String(mode.freshState), scenario ].map(String).join(', ');
        },
        async test(scope) {
            const { mode, scenario } = scope.parameters;

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
    }) ]
);
