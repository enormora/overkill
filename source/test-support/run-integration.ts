import { loadConfig, orchestrator } from '#test-runner';
import { z } from 'zod/v4';
import { defaultRunRequest } from './run-command-factory.ts';

const shardArgumentIndex = 2;
const shard = z
    .tuple([ z.coerce.number().int().positive(), z.coerce.number().int().positive() ])
    .transform(function ([ index, total ]) {
        return { index, total };
    })
    .refine(function validIndex(value) {
        return value.index <= value.total;
    }, 'Shard index exceeds shard total.')
    .parse((process.argv[shardArgumentIndex] ?? '1/1').split('/'));
const cwd = process.cwd();
const config = await loadConfig({ cwd, configPath: null });
const result = await orchestrator.run({
    cwd,
    config,
    engine: { kind: 'default' },
    request: {
        ...defaultRunRequest({
            profile: 'integration',
            paths: [ 'source/integration-tests/repository.test.ts' ],
            shard
        }),
        debug: { mode: 'off', selectors: [] }
    }
});
process.exitCode = result.status === 'passed' ? 0 : 1;
