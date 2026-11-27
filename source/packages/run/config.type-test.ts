import type { IsEqual } from 'type-fest';
import { suite, test } from '@overkill-dev/test';
import { acceptsCall, assignableFrom, sameType } from '@overkill-dev/type-test';
import type { DefinedTestFamily, DefinedReporter } from '../engine/engine.entry-point.ts';
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
    type ProjectPropertyProfileConfig,
    type ProjectTimingProfilePolicy
} from './config.entry-point.ts';

type ExpectedTestFamily = DefinedTestFamily | 'integration' | 'microtest' | 'property';

declare const defineConfigUnderTest: typeof defineConfig;

export const testNode = suite('@overkill-dev/run/config', [
    test('exposes property exploration settings without coverage or worker pools', function (typeScope) {
        typeScope.assert(assignableFrom<ProjectPropertyProfileConfig, {
            readonly testFamily: 'property';
            readonly files: { readonly include: readonly ['test/laws.ts']; };
            readonly property: { readonly newTrials: number; readonly maxWork: number; };
            readonly execution: { readonly processModel: 'supervised-process'; readonly scheduling: 'serial'; };
        }>());
        typeScope.assert(assignableFrom.not<keyof ProjectPropertyProfileConfig, 'coverage'>());
        typeScope.assert(assignableFrom.not<keyof ProjectPropertyProfileConfig, 'retries'>());
        typeScope.assert(assignableFrom.not<keyof ProjectPropertyProfileConfig, 'attachments'>());
        return typeScope.assert.collect();
    }),
    test('exposes benchmark policy without adding it to ordinary execution profiles', function (typeScope) {
        typeScope.assert(sameType<IsEqual<typeof normalizeConfig, (config: Config) => NormalizedConfig>, true>());
        typeScope.assert(sameType<ProfileConfig['testFamily'], ExpectedTestFamily | 'benchmark'>());
        typeScope.assert(sameType<TestProfileConfig['testFamily'], ExpectedTestFamily>());
        typeScope.assert(sameType<
            keyof ProjectBenchmarkProfileConfig,
            keyof {
                readonly attachments: true;
                readonly baselines: true;
                readonly execution: true;
                readonly failureArtifacts: true;
                readonly files: true;
                readonly garbageCollection: true;
                readonly host: true;
                readonly reporters: true;
                readonly processUsage: true;
                readonly runRecords: true;
                readonly testFamily: true;
                readonly timings: true;
                readonly timeouts: true;
            }
        >());
        typeScope.assert(assignableFrom<ProjectBenchmarkProfileConfig, {
            readonly testFamily: 'benchmark';
            readonly files: { readonly include: readonly ['source/startup.bench.ts']; };
        }>());
        typeScope.assert(assignableFrom.not<ProjectBenchmarkProfileConfig, {
            readonly testFamily: 'benchmark';
        }>());
        return typeScope.assert.collect();
    }),
    test('retries are integration-only and retain an explicit artifact policy', function (typeScope) {
        typeScope.assert(sameType<
            [{
                readonly testFamily: 'integration';
                readonly files: { readonly include: readonly ['source/**/*.integration.test.ts']; };
                readonly retries: { readonly maxAttempts: number; readonly artifacts: 'all'; };
            }] extends [ProjectIntegrationProfileConfig] ? true : false,
            true
        >());
        typeScope.assert(assignableFrom.not<ProjectMicrotestProfileConfig, {
            readonly testFamily: 'microtest';
            readonly retries: { readonly maxAttempts: number; };
        }>());
        return typeScope.assert.collect();
    }),
    test('exposes configuration loading and authoring types', function (typeScope) {
        typeScope.assert(acceptsCall, () => defineConfigUnderTest({ profiles: { unit: { testFamily: 'microtest' } } }));
        typeScope.assert(
            sameType<IsEqual<typeof loadConfig, (request: ConfigLoadRequest) => Promise<LoadedConfig>>, true>()
        );
        typeScope.assert(
            sameType<IsEqual<Config['reporters'], readonly [DefinedReporter, ...DefinedReporter[]] | undefined>, true>()
        );
        typeScope.assert(sameType<ProjectTimingProfilePolicy, {
            readonly collection: 'precise' | 'summary';
        }>());
        typeScope.assert(sameType<ProjectCoverageOutput, 'html' | 'json' | 'lcov' | 'text' | 'v8'>());
        typeScope.assert(sameType<ProjectMicrotestProfileConfig['coverage'], ProjectCoveragePolicy | undefined>());
        typeScope.assert(sameType<
            [{
                readonly coverage: { readonly outputs: readonly ['text']; };
                readonly files: { readonly include: readonly ['source/**/*.test.ts']; };
                readonly testFamily: 'integration';
            }] extends [ProjectIntegrationProfileConfig] ? true : false,
            false
        >());
        typeScope.assert(sameType.withActual<ConfigError>(), new ConfigError('Invalid config.'));
        return typeScope.assert.collect();
    })
]);
