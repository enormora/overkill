import {
    createTestCase as createDirectTestCase,
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestBody as DirectTestBody,
    type TestScope as DirectScope,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { createReportingContext } from '../engine/reporting-context.ts';
import type { TestPlan } from '../engine/test-plan.ts';
import {
    defineFixedOutputRenderer,
    defineFixedReporter,
    type FixedDefinedReporter
} from '../test-support/reporter-definition.ts';
import { defaultRunEngine } from './default-run-engine.ts';
import type { LoadedRunConfig } from './run-config.ts';
import {
    directRunFacts,
    runConfig
} from './run-if-main-facts.ts';
import {
    executionMode,
    rootAnnotations,
    rootControls,
    rootTitle,
    selectedOutputRenderer,
    selectedReporters,
    warnOnSupervisedDowngrade
} from './run-if-main-options.ts';
import type { RunMicrotestProfileConfig } from './run-types.ts';

type StderrCapture = {
    readonly read: () => string;
    readonly restore: () => void;
};

const outputRenderer = defineFixedOutputRenderer({
    render(): string {
        return '';
    }
});

function passingBody(scope: DirectScope): ReturnType<DirectTestBody> {
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
    reporters: RunMicrotestProfileConfig['reporters'],
    scheduling: 'concurrent' | 'serial'
): RunMicrotestProfileConfig {
    return {
        execution: {
            processModel: 'in-process',
            scheduling
        },
        files: null,
        reporters,
        resourceUsage: {
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
        timeouts: {
            collectionMilliseconds: 1000,
            hardMilliseconds: 1000,
            softMilliseconds: 500
        }
    };
}

function loadedConfig(reporters: LoadedRunConfig['reporters']): LoadedRunConfig {
    return {
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

function captureStderr(): StderrCapture {
    const originalWrite = process.stderr.write.bind(process.stderr);
    let captured = '';

    process.stderr.write = function writeCapturedStderr(chunk: Uint8Array | string): boolean {
        captured += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');

        return true;
    };

    return {
        read() {
            return captured;
        },
        restore() {
            process.stderr.write = originalWrite;
        }
    };
}

async function assertReporterSelection(scope: OverkillScope): Promise<void> {
    const optionReporter = createReporter('option');
    const profileReporter = createReporter('profile');
    const configReporter = createReporter('config');
    const defaultReporters = await selectedReporters(directProfile(null, 'concurrent'), loadedConfig(null), undefined);

    scope.assert.deepEqual(
        await selectedReporters(directProfile(null, 'concurrent'), loadedConfig([ configReporter ]), {
            reporters: [ optionReporter ]
        }),
        [ optionReporter ]
    );
    scope.assert.deepEqual(
        await selectedReporters(directProfile([ profileReporter ], 'serial'), loadedConfig(null), undefined),
        [ profileReporter ]
    );
    scope.assert.deepEqual(
        await selectedReporters(directProfile(null, 'concurrent'), loadedConfig([ configReporter ]), undefined),
        [ configReporter ]
    );
    const defaultReporter = defaultReporters[0];
    scope.require.defined(defaultReporter);
    scope.assert.equal(defaultReporter(createReportingContext({ projectRoot: null })).name, 'line');
}

function assertOutputAndRootOptions(scope: OverkillScope): void {
    scope.assert.equal(selectedOutputRenderer(loadedConfig(null), undefined), outputRenderer);
    scope.assert.equal(selectedOutputRenderer(loadedConfig(null), { outputRenderer, reporters: [] }), outputRenderer);
    scope.assert.deepEqual(rootAnnotations(undefined), {});
    scope.assert.deepEqual(rootControls(undefined), {});
    scope.assert.deepEqual(
        rootAnnotations({
            root: {
                annotations: { tags: [ 'direct' ] },
                title: 'root'
            }
        }),
        { tags: [ 'direct' ] }
    );
    scope.assert.deepEqual(
        rootControls({
            root: {
                controls: { timeoutMilliseconds: 50 },
                title: 'root'
            }
        }),
        { timeoutMilliseconds: 50 }
    );
    scope.assert.equal(
        rootTitle({
            root: {
                annotations: {},
                controls: {},
                title: 'root'
            }
        }),
        'root'
    );
}

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/run-if-main-options.test.ts',
    annotations: {},
    controls: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'runIfMain() resolves direct execution options',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const profile = directProfile(null, 'serial');
                const stderr = captureStderr();

                try {
                    warnOnSupervisedDowngrade(directProfile(null, 'concurrent'));
                } finally {
                    stderr.restore();
                }

                await assertReporterSelection(scope);
                assertOutputAndRootOptions(scope);
                scope.assert.equal(executionMode(profile), 'serial-in-process');
                scope.assert.equal(stderr.read(), '');

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'directRunFacts() rejects unknown direct profiles',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                scope.assert.throws(function readMissingDirectProfileFacts() {
                    directRunFacts({
                        config: runConfig(loadedConfig(null), []),
                        fileSet: null,
                        profileName: 'missing',
                        projectRoot: process.cwd(),
                        seed: { value: 42n },
                        testPlan: directTestPlan()
                    });
                }, {
                    message: 'Unknown direct run profile: missing.'
                });

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
