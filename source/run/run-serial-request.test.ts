import { suite, test } from '../packages/test/test.entry-point.ts';
import { normalizeConfig } from '../config/config.ts';
import { createDeterministicRunOrchestrator } from '../test-support/create-deterministic-run-orchestrator.ts';
import { defaultRunRequest } from '../test-support/run-command-factory.ts';
import { RunResolutionError } from './run-errors.ts';
import type { RunCommand } from './run-types.ts';

function serialCommand(): RunCommand {
    return {
        config: normalizeConfig({
            profiles: {
                integration: { testFamily: 'integration', files: { include: [ 'never-imported.test.ts' ] } },
                benchmark: { testFamily: 'benchmark', files: { include: [ 'never-imported.test.ts' ] } }
            }
        }),
        cwd: process.cwd(),
        engine: { kind: 'default' },
        request: defaultRunRequest({ execution: { mode: 'serial' }, paths: [] })
    };
}

export const testNode = suite('serial request validation', [
    test('rejects unknown execution modes before discovery', async function (scope) {
        const command = serialCommand();
        Object.defineProperty(command.request.execution, 'mode', { value: 'concurrent' });

        await scope.assert.rejects(async function resolveInvalidExecution() {
            return await createDeterministicRunOrchestrator().resolve(command);
        }, { type: RunResolutionError, message: 'Execution mode must be "profile-default" or "serial".' });
        return scope.assert.collect();
    }),
    test('rejects serial overrides for integration and benchmark profiles before discovery', async function (scope) {
        const orchestrator = createDeterministicRunOrchestrator();
        const command = serialCommand();

        for (const profile of [ 'integration', 'benchmark' ]) {
            const selected = { ...command, request: { ...command.request, profile } };

            await scope.assert.rejects(async function resolveUnsupportedSerialRequest() {
                return profile === 'benchmark'
                    ? await orchestrator.bench.list(selected, { timing: null })
                    : await orchestrator.resolve(selected);
            }, { type: RunResolutionError, message: 'Serial execution overrides require a microtest profile.' });
        }

        return scope.assert.collect();
    })
]);
