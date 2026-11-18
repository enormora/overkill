import { loadConfig, orchestrator } from '#test-runner';
import { defaultRunRequest } from './run-command-factory.ts';

const cwd = process.cwd();
const config = await loadConfig({ cwd, configPath: null });
const result = await orchestrator.run({
    cwd,
    config,
    engine: { kind: 'default' },
    request: {
        ...defaultRunRequest({
            profile: 'integration',
            paths: [ 'source/integration-tests/repository.test.ts' ]
        }),
        debug: { mode: 'off', selectors: [] }
    }
});
process.exitCode = result.status === 'passed' ? 0 : 1;
