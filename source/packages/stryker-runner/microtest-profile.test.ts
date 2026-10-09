import { suite, test } from '../test/test.entry-point.ts';
import {
    normalizeConfig,
    RunResolutionError,
    type ProjectProfilesConfig
} from '../run/run.entry-point.ts';
import { selectMicrotestProfile } from './microtest-profile.ts';

const integration = { testFamily: 'integration', files: { include: [ 'browser.test.ts' ] } } as const;
const benchmark = { testFamily: 'benchmark', files: { include: [ 'startup.bench.ts' ] } } as const;

type RejectedSelection = {
    readonly profiles: ProjectProfilesConfig;
    readonly name: string | null;
    readonly message: RegExp;
};

const rejectedSelections: readonly RejectedSelection[] = [
    { profiles: { microtest: integration }, name: null, message: /No eligible Node microtest profiles/ },
    { profiles: {}, name: 'absent', message: /Unknown mutation profile: "absent"/ },
    { profiles: {}, name: 'constructor', message: /Unknown mutation profile: "constructor"/ },
    { profiles: {}, name: '', message: /Unknown mutation profile: ""/ },
    { profiles: { browser: integration }, name: 'browser', message: /testFamily "integration"/ },
    { profiles: { microtest: benchmark }, name: 'microtest', message: /testFamily "benchmark"/ },
    {
        profiles: { zebra: { testFamily: 'microtest' }, alpha: { testFamily: 'microtest' } },
        name: null,
        message: /Multiple microtest profiles exist: alpha, microtest, zebra\. Set overkill\.profile/
    }
];

export const testNode = suite('mutation microtest profile selection', [
    test('infers the built-in fallback and a sole eligible configured profile', function (scope) {
        const fallback = normalizeConfig({});
        const configured = normalizeConfig({
            profiles: { microtest: benchmark, 'unit-fast': { testFamily: 'microtest' } }
        });

        scope.assert.equal(selectMicrotestProfile(fallback, null).name, 'microtest');
        scope.assert.equal(selectMicrotestProfile(configured, null).name, 'unit-fast');
        return scope.assert.collect();
    }),
    test('explicit selection preserves the complete profile and either process model', function (scope) {
        for (const processModel of [ 'in-process', 'supervised-process' ] as const) {
            const config = normalizeConfig({
                loader: { sourceMaps: true, stripMode: 'strip-only' },
                profiles: {
                    browser: {
                        testFamily: 'microtest',
                        files: { sets: { unit: { include: [ 'source/**/*.test.ts' ] } } },
                        execution: { processModel, scheduling: 'concurrent', maxConcurrency: 3 },
                        resourceUsage: { measure: true, budgets: { residentSetBytes: 1024 } },
                        timeouts: { softMilliseconds: 10, hardMilliseconds: 20 },
                        timings: { collection: 'precise' },
                        coverage: { outputs: [ 'json' ] }
                    }
                }
            });
            const selected = selectMicrotestProfile(config, 'browser');

            scope.assert.equal(selected.name, 'browser');
            scope.assert.equal(selected.profile, config.profiles.browser);
            scope.assert.equal(selected.profile.execution.processModel, processModel);
            scope.assert.equal(selected.profile.execution.scheduling, 'concurrent');
            scope.assert.deepEqual(config.loader, { sourceMaps: true, stripMode: 'strip-only' });
        }

        return scope.assert.collect();
    }),
    test('rejects missing, unknown, incompatible, and ambiguous selections', function (scope) {
        for (const scenario of rejectedSelections) {
            const config = normalizeConfig({ profiles: scenario.profiles });

            scope.assert.throws(function selectInvalidProfile() {
                return selectMicrotestProfile(config, scenario.name);
            }, {
                type: RunResolutionError,
                message: scenario.message
            });
        }

        return scope.assert.collect();
    }),
    test('counts a custom microtest together with the built-in fallback', function (scope) {
        const config = normalizeConfig({ profiles: { 'unit-fast': { testFamily: 'microtest' } } });

        scope.assert.throws(function inferAmbiguousProfile() {
            return selectMicrotestProfile(config, null);
        }, {
            type: RunResolutionError,
            message: /Multiple microtest profiles exist: microtest, unit-fast/
        });
        scope.assert.equal(selectMicrotestProfile(config, 'unit-fast').name, 'unit-fast');
        return scope.assert.collect();
    })
]);
