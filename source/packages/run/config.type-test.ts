import { describe, expect, test } from 'tstyche';
import type { DefinedReporter } from '../engine/engine.entry-point.ts';
import {
    RunConfigError,
    type defineConfig,
    type loadRunConfig,
    type LoadedRunConfig,
    type RunConfigLoadRequest,
    type RunProjectConfig
} from './config.entry-point.ts';

describe('@overkill-dev/run/config', function () {
    test('exposes configuration loading and authoring types', function () {
        expect<typeof defineConfig>().type.toBe<(config: RunProjectConfig) => RunProjectConfig>();
        expect<typeof loadRunConfig>().type.toBe<
            (request: RunConfigLoadRequest) => Promise<LoadedRunConfig>
        >();
        expect<RunProjectConfig['reporters']>().type.toBe<
            readonly [DefinedReporter, ...DefinedReporter[]] | undefined
        >();
        expect(new RunConfigError('Invalid config.')).type.toBe<RunConfigError>();
    });
});
