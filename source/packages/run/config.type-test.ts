import { describe, expect, test } from 'tstyche';
import type { DefinedReporter } from '../engine/engine.entry-point.ts';
import {
    ConfigError,
    type defineConfig,
    type loadConfig,
    type normalizeConfig,
    type NormalizedConfig,
    type ProjectBenchmarkProfileConfig,
    type ProfileConfig,
    type TestProfileConfig,
    type LoadedConfig,
    type ConfigLoadRequest,
    type Config,
    type ProjectCoverageOutput,
    type ProjectCoveragePolicy,
    type ProjectIntegrationProfileConfig,
    type ProjectMicrotestProfileConfig,
    type ProjectTimingProfilePolicy
} from './config.entry-point.ts';

describe('@overkill-dev/run/config', function () {
    test('exposes benchmark policy without adding it to ordinary execution profiles', function () {
        expect<typeof normalizeConfig>().type.toBe<(config: Config) => NormalizedConfig>();
        expect<ProfileConfig['testFamily']>().type.toBe<'benchmark' | 'integration' | 'microtest'>();
        expect<TestProfileConfig['testFamily']>().type.toBe<'integration' | 'microtest'>();
        expect<keyof ProjectBenchmarkProfileConfig>().type.toBe<'files' | 'testFamily'>();
        expect<ProjectBenchmarkProfileConfig>().type.toBeAssignableFrom<{
            readonly testFamily: 'benchmark';
            readonly files: { readonly include: readonly ['source/startup.bench.ts']; };
        }>();
        expect<ProjectBenchmarkProfileConfig>().type.not.toBeAssignableFrom<{
            readonly testFamily: 'benchmark';
        }>();
    });
    test('retries are integration-only and retain an explicit artifact policy', function () {
        expect<ProjectIntegrationProfileConfig>().type.toBeAssignableFrom<{
            readonly testFamily: 'integration';
            readonly files: { readonly include: readonly ['source/**/*.integration.test.ts']; };
            readonly retries: { readonly maxAttempts: number; readonly artifacts: 'all'; };
        }>();
        expect<ProjectMicrotestProfileConfig>().type.not.toBeAssignableFrom<{
            readonly testFamily: 'microtest';
            readonly retries: { readonly maxAttempts: number; };
        }>();
    });
    test('exposes configuration loading and authoring types', function () {
        expect<typeof defineConfig>().type.toBe<(config: Config) => Config>();
        expect<typeof loadConfig>().type.toBe<
            (request: ConfigLoadRequest) => Promise<LoadedConfig>
        >();
        expect<Config['reporters']>().type.toBe<
            readonly [DefinedReporter, ...DefinedReporter[]] | undefined
        >();
        expect<ProjectTimingProfilePolicy>().type.toBe<{
            readonly collection: 'precise' | 'summary';
        }>();
        expect<ProjectCoverageOutput>().type.toBe<'html' | 'json' | 'lcov' | 'text' | 'v8'>();
        expect<ProjectMicrotestProfileConfig['coverage']>().type.toBe<
            ProjectCoveragePolicy | undefined
        >();
        expect<ProjectIntegrationProfileConfig>().type.not.toBeAssignableFrom<{
            readonly coverage: { readonly outputs: readonly ['text']; };
            readonly files: { readonly include: readonly ['source/**/*.test.ts']; };
            readonly testFamily: 'integration';
        }>();
        expect(new ConfigError('Invalid config.')).type.toBe<ConfigError>();
    });
});
