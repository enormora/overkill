import type { FrozenMicrotestPolicy } from '../run/run-types.ts';
import { normalizeConfig } from '../packages/run/run.entry-point.ts';
import { createMutationRunCommand } from '../packages/stryker-runner/mutation-execution-policy.ts';
import { createUnitRunOrchestrator } from './create-deterministic-run-orchestrator.ts';

export async function frozenMicrotestPolicy(): Promise<FrozenMicrotestPolicy> {
    const config = normalizeConfig({
        profiles: {
            unit: {
                testFamily: 'microtest',
                files: { include: [ 'source/integration-tests/runtime/fixtures/passing.test.ts' ] },
                execution: { processModel: 'in-process' }
            }
        }
    });
    const command = createMutationRunCommand({ cwd: '/project', config, profile: 'unit' });
    return await createUnitRunOrchestrator().freezePolicy({
        moduleBoundary: null,
        command: {
            ...command,
            request: { ...command.request, paths: [ 'source/integration-tests/runtime/fixtures/passing.test.ts' ] }
        },
        source: { kind: 'memory' }
    });
}
