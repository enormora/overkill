import { describe, expect, test } from 'tstyche';
import type { DefinedReporter } from '../engine/engine.entry-point.ts';
import {
    RunConfigError,
    type defineConfig,
    type loadRunConfig,
    type LoadedRunConfig,
    type RunConfigLoadRequest,
    type RunProjectConfig,
    type RunProjectCoverageOutput,
    type RunProjectCoveragePolicy,
    type RunProjectIntegrationProfileConfig,
    type RunProjectMicrotestProfileConfig,
    type RunProjectTimingProfilePolicy
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
        expect<RunProjectTimingProfilePolicy>().type.toBe<{
            readonly collection: 'precise' | 'summary';
        }>();
        expect<RunProjectCoverageOutput>().type.toBe<'html' | 'json' | 'lcov' | 'text' | 'v8'>();
        expect<RunProjectMicrotestProfileConfig['coverage']>().type.toBe<
            RunProjectCoveragePolicy | undefined
        >();
        expect<RunProjectIntegrationProfileConfig>().type.not.toBeAssignableFrom<{
            readonly coverage: { readonly outputs: readonly ['text']; };
            readonly files: { readonly include: readonly ['source/**/*.test.ts']; };
            readonly testFamily: 'integration';
        }>();
        expect(new RunConfigError('Invalid config.')).type.toBe<RunConfigError>();
    });
});
