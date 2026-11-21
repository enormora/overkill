import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { type TestScope, suite, test } from '@overkill-dev/test';

import {
    type TestPlan,
    defaultFailureArtifactPolicy,
    createTestCase as createDirectTestCase
} from '../packages/engine/engine.entry-point.ts';

import { createReportingContext } from '../engine/reporting-context.ts';
import {
    defineFixedOutputRenderer,
    defineFixedReporter,
    type FixedDefinedReporter
} from '../test-support/reporter-definition.ts';
import { normalizeConfig } from '../config/config.ts';
import type { LoadedConfig } from '../config/config-loader.ts';
import type { MicrotestProfileConfig } from '../config/types.ts';
import { defaultRunEngine } from './default-run-engine.ts';
import { directRunFacts, runConfig } from './run-if-main-facts.ts';
import {
    rootAnnotations,
    rootControls,
    rootTitle,
    selectedOutputRenderer,
    selectedReporters
} from './run-if-main-options.ts';

type PassingBodyAssertions = { readonly assert: Pick<TestScope['assert'], 'collect' | 'true'>; };

const outputRenderer = defineFixedOutputRenderer({
    render(): string {
        return '';
    }
});

function passingBody(
    scope: PassingBodyAssertions
): ReturnType<TestScope['assert']['collect']> {
    scope.assert.true(true);

    return scope.assert.collect();
}

function createReporter(name: string): FixedDefinedReporter {
    return defineFixedReporter({
        dispose: null,
        kind: 'real-time',
        name,
        onEvent() {
            return undefined;
        },
        onFinish: null,
        sinks: []
    });
}

function directProfile(
    reporters: MicrotestProfileConfig['reporters'],
    scheduling: 'concurrent' | 'serial'
): MicrotestProfileConfig {
    return {
        failureArtifacts: defaultFailureArtifactPolicy,
        baselines: { adapters: [], directory: 'test-baselines', snapshots: false, stale: 'fail' },
        runRecords: { persist: 'on-demand' },
        coverage: {
            outputDirectory: null,
            outputs: [ 'v8', 'lcov' ],
            sources: { exclude: [], mode: 'loaded' },
            thresholds: { branches: null, functions: null, lines: null }
        },
        execution: {
            maxConcurrency: 5,
            processModel: 'in-process',
            scheduling
        },
        files: null,
        reporters,
        processUsage: {
            budgets: {
                activeResourceCount: null,
                javaScriptEngineHeapBytes: null,
                residentSetBytes: null,
                residentSetGrowthBytesPerSecond: null
            },
            measure: false,
            samplingIntervalMilliseconds: 100
        },
        testFamily: 'microtest',
        timings: { collection: 'summary' },
        timeouts: {
            collectionMilliseconds: 1000,
            hardMilliseconds: 1000,
            softMilliseconds: 500
        }
    };
}

function loadedConfig(reporters: LoadedConfig['reporters']): LoadedConfig {
    return {
        history: normalizeConfig({}).history,
        configPath: null,
        loader: {
            sourceMaps: false,
            stripMode: 'strip-only'
        },
        outputRenderer,
        profiles: {
            microtest: directProfile(null, 'concurrent')
        },
        reporters,
        runtimeStateDir: '.overkill'
    };
}

function directTestPlan(): TestPlan {
    return defaultRunEngine.createTestPlan(defaultRunEngine.createRoot({
        children: [
            createDirectTestCase({
                body: passingBody,
                definitionLocations: [ { kind: 'unknown' as const } ],
                annotations: {},
                controls: {},
                title: 'passes'
            })
        ],
        annotations: {},
        controls: {},
        title: 'root'
    }));
}

const assertReporterSelection = defineCompositeAssertion({
    name: 'reporter selection',
    async assert(check) {
        const optionReporter = createReporter('option');
        const profileReporter = createReporter('profile');
        const configReporter = createReporter('config');
        const defaultReporters = await selectedReporters(
            directProfile(null, 'concurrent'),
            loadedConfig(null),
            undefined
        );
        const initialChecks = check.group([
            check.deepEqual(
                await selectedReporters(directProfile(null, 'concurrent'), loadedConfig([ configReporter ]), {
                    reporters: [ optionReporter ]
                }),
                [ optionReporter ]
            ),
            check.deepEqual(
                await selectedReporters(directProfile([ profileReporter ], 'serial'), loadedConfig(null), undefined),
                [ profileReporter ]
            ),
            check.deepEqual(
                await selectedReporters(directProfile(null, 'concurrent'), loadedConfig([ configReporter ]), undefined),
                [ configReporter ]
            )
        ]);
        const defaultReporter = defaultReporters[0];
        if (defaultReporter === undefined || defaultReporter === null) {
            return check.group([ initialChecks, check.defined(defaultReporter) ]);
        }
        return check.group([
            initialChecks,
            check.defined(defaultReporter),
            check.equal(defaultReporter(createReportingContext({ projectRoot: null })).name, 'line')
        ]);
    }
});

const assertOutputAndRootOptions = defineCompositeAssertion({
    name: 'output and root options',
    assert(check) {
        return check.group([
            check.equal(selectedOutputRenderer(loadedConfig(null), undefined), outputRenderer),
            check.equal(selectedOutputRenderer(loadedConfig(null), { outputRenderer, reporters: [] }), outputRenderer),
            check.deepEqual(rootAnnotations(undefined), {}),
            check.deepEqual(rootControls(undefined), {}),
            check.deepEqual(
                rootAnnotations({
                    root: {
                        annotations: { tags: [ 'direct' ] },
                        title: 'root'
                    }
                }),
                { tags: [ 'direct' ] }
            ),
            check.deepEqual(
                rootControls({
                    root: {
                        controls: { timeoutMilliseconds: 50 },
                        title: 'root'
                    }
                }),
                { timeoutMilliseconds: 50 }
            ),
            check.equal(
                rootTitle({
                    root: {
                        annotations: {},
                        controls: {},
                        title: 'root'
                    }
                }, '/project'),
                'root'
            )
        ]);
    }
});

export const testNode = suite('Run if main options', [
    test('resolves direct execution options', async function (scope) {
        await scope.assert(assertReporterSelection);
        scope.assert(assertOutputAndRootOptions);

        return scope.assert.collect();
    }),
    test('directRunFacts() rejects unknown direct profiles', function (scope) {
        scope.assert.throws(function readMissingDirectProfileFacts() {
            directRunFacts({
                config: runConfig(loadedConfig(null), []),
                fileSet: null,
                profileName: 'missing',
                projectRoot: '/project',
                seed: { value: 42n },
                testPlan: directTestPlan()
            });
        }, {
            message: 'Unknown direct run profile: missing.'
        });

        return scope.assert.collect();
    })
]);
