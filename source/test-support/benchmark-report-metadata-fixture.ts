import { normalizeConfig } from '../config/config.ts';
import type { RunCommand } from '../run/run-types.ts';
import { defaultRunRequest } from './run-command-factory.ts';

export function metadataCommand(processModel: 'supervised-process' | 'worker-pool'): RunCommand {
    return {
        config: normalizeConfig({
            profiles: {
                startup: {
                    testFamily: 'benchmark',
                    files: { include: [ 'fixture.bench.ts' ] },
                    execution: { processModel }
                }
            }
        }),
        cwd: '/project',
        engine: { kind: 'default' },
        request: defaultRunRequest({ profile: 'startup' })
    };
}
