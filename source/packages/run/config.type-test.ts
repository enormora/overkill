import type { IsEqual } from 'type-fest';
import { suite, test } from '../test/test.entry-point.ts';
import { acceptsCall, assignableFrom, sameType } from '../type-test/type-test.entry-point.ts';
import type { DefinedTestFamily, DefinedReporter } from '../engine/engine.entry-point.ts';
import { type IsAssignable, isEqualTo } from '../../test-support/type-relations.ts';
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

export const testNode = suite('Public configuration authoring', [
    test('exposes property exploration settings without coverage or worker pools', function (scope) {
        scope.assert(sameType<
            IsAssignable<{
                readonly testFamily: 'property';
                readonly files: { readonly include: readonly ['test/laws.ts']; };
                readonly property: { readonly newTrials: number; readonly maxWork: number; };
                readonly execution: { readonly processModel: 'supervised-process'; readonly scheduling: 'serial'; };
            }, ProjectPropertyProfileConfig>,
            true
        >());
        scope.assert(assignableFrom.not<keyof ProjectPropertyProfileConfig, 'coverage'>());
        scope.assert(assignableFrom.not<keyof ProjectPropertyProfileConfig, 'retries'>());
        scope.assert(assignableFrom.not<keyof ProjectPropertyProfileConfig, 'attachments'>());
        return scope.assert.collect();
    }),
    test('exposes benchmark policy without adding it to ordinary execution profiles', function (scope) {
        scope.assert(sameType<IsEqual<typeof normalizeConfig, (config: Config) => NormalizedConfig>, true>());
        scope.assert(sameType<IsEqual<ProfileConfig['testFamily'], ExpectedTestFamily | 'benchmark'>, true>());
        scope.assert(sameType<IsEqual<TestProfileConfig['testFamily'], ExpectedTestFamily>, true>());
        scope.assert(sameType<
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
        scope.assert(sameType<
            IsAssignable<{
                readonly testFamily: 'benchmark';
                readonly files: { readonly include: readonly ['source/startup.bench.ts']; };
            }, ProjectBenchmarkProfileConfig>,
            true
        >());
        scope.assert(sameType<
            IsAssignable<{
                readonly testFamily: 'benchmark';
            }, ProjectBenchmarkProfileConfig>,
            false
        >());
        return scope.assert.collect();
    }),
    test('retries are integration-only and retain an explicit artifact policy', function (scope) {
        scope.assert(sameType<
            [{
                readonly testFamily: 'integration';
                readonly files: { readonly include: readonly ['source/**/*.integration.test.ts']; };
                readonly retries: { readonly maxAttempts: number; readonly artifacts: 'all'; };
            }] extends [ProjectIntegrationProfileConfig] ? true : false,
            true
        >());
        scope.assert(sameType<
            IsAssignable<{
                readonly testFamily: 'microtest';
                readonly retries: { readonly maxAttempts: number; };
            }, ProjectMicrotestProfileConfig>,
            false
        >());
        return scope.assert.collect();
    }),
    test('exposes configuration loading and authoring types', function (scope) {
        scope.assert(acceptsCall, function () {
            return defineConfigUnderTest({ profiles: { unit: { testFamily: 'microtest' } } });
        });
        scope.assert(
            sameType<IsEqual<typeof loadConfig, (request: ConfigLoadRequest) => Promise<LoadedConfig>>, true>()
        );
        scope.assert(
            sameType<IsEqual<Config['reporters'], readonly [DefinedReporter, ...DefinedReporter[]] | undefined>, true>()
        );
        scope.assert(sameType<
            IsEqual<ProjectTimingProfilePolicy, {
                readonly collection: 'precise' | 'summary';
            }>,
            true
        >());
        scope.assert(sameType<ProjectCoverageOutput, 'html' | 'json' | 'lcov' | 'text' | 'v8'>());
        scope.assert(
            sameType<IsEqual<ProjectMicrotestProfileConfig['coverage'], ProjectCoveragePolicy | undefined>, true>()
        );
        scope.assert(sameType<
            [{
                readonly coverage: { readonly outputs: readonly ['text']; };
                readonly files: { readonly include: readonly ['source/**/*.test.ts']; };
                readonly testFamily: 'integration';
            }] extends [ProjectIntegrationProfileConfig] ? true : false,
            false
        >());
        scope.assert(sameType.withActual<true>(), isEqualTo<ConfigError>()(new ConfigError('Invalid config.')));
        return scope.assert.collect();
    })
]);
