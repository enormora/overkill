import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runIfMain } from '#test-runner';
import { suite, test } from '../../packages/test/test.entry-point.ts';
import { createLineReporter } from '../../packages/reporter-line/reporter-line.entry-point.ts';
import { adapterUrl, engineUrl, configUrl } from './stryker-lifecycle-fixture.test.ts';
import { executeMutationScript } from './stryker-script.test.ts';
import { strykerTerminationScript, strykerTerminationCampaignScript } from './stryker-termination-scripts.test.ts';

const boundaries = [
    { processModel: 'in-process', freshState: false },
    { processModel: 'in-process', freshState: true },
    { processModel: 'supervised-process', freshState: false }
] as const;
const operations = [ 'exit-zero', 'exit-nonzero', 'abort', 'signal' ] as const;
const phases = [ 'collection', 'body' ] as const;
const scenarios = [
    ...boundaries.flatMap(function terminationBoundary(boundary) {
        return operations
            .flatMap(function nativeOperation(operation) {
                return phases.map(function terminationPhase(phase) {
                    return { ...boundary, operation, phase, invocation: 'mutant' };
                });
            })
            .concat([
                { ...boundary, operation: 'exit-zero', phase: 'collection', invocation: 'dry' },
                { ...boundary, operation: 'abort', phase: 'body', invocation: 'dry' }
            ]);
    }),
    {
        processModel: 'supervised-process',
        freshState: true,
        operation: 'exit-zero',
        phase: 'body',
        invocation: 'mutant'
    }
];

export const testNode = suite(
    'Stryker native termination',
    scenarios.map(function terminationScenario(scenario) {
        const { processModel, freshState, operation, phase, invocation } = scenario;
        return test(
            `${processModel} freshState ${String(freshState)} ${operation} ${phase} ${invocation}`,
            async function (scope) {
                const cwd = await realpath(await mkdtemp(join(tmpdir(), 'overkill-stryker-termination-')));
                scope.cleanup(async function removeProject() {
                    await rm(cwd, { recursive: true, force: true });
                });
                const campaign = processModel === 'in-process' && !freshState;
                const output = await executeMutationScript(
                    campaign ? strykerTerminationCampaignScript : strykerTerminationScript,
                    [
                        adapterUrl,
                        engineUrl,
                        configUrl,
                        processModel,
                        String(freshState),
                        operation,
                        phase,
                        invocation,
                        import.meta.resolve(campaign ? '@stryker-mutator/core' : '@stryker-mutator/instrumenter')
                    ],
                    cwd
                );
                scope.assert.equal(output, 'termination passed\n');
                return scope.assert.collect();
            }
        );
    })
);

await runIfMain(import.meta, testNode, { reporters: [ createLineReporter() ] });
