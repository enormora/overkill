import fs from 'node:fs/promises';
import path from 'node:path';

const projectFolder = process.cwd();
const rootPackageJson = JSON.parse(await fs.readFile(path.join(projectFolder, 'package.json'), 'utf8'));

const packageMetadata = {
    author: rootPackageJson.author,
    bugs: rootPackageJson.bugs,
    homepage: rootPackageJson.homepage,
    keywords: rootPackageJson.keywords,
    license: rootPackageJson.license,
    repository: rootPackageJson.repository,
    engines: rootPackageJson.engines
};

const benchmarkHtmlClientAsset = {
    inputFilePath: path.join(projectFolder, 'target/benchmark-html/client.txt'),
    targetFilePath: 'reporters/benchmark-html-assets/client.txt'
};

const packageFilterEnvironmentVariable = 'PACKTORY_INCLUDED_PACKAGES';

function packageFilter() {
    const rawValue = process.env[packageFilterEnvironmentVariable];

    if (rawValue === undefined) {
        return null;
    }

    return new Set(
        rawValue
            .split(',')
            .map(function trimPackageName(name) {
                return name.trim();
            })
            .filter(Boolean)
    );
}

function selectPackages(packages) {
    const includedPackages = packageFilter();

    if (includedPackages === null) {
        return packages;
    }

    return packages.filter(function includePackage(packageConfig) {
        return includedPackages.has(packageConfig.name);
    });
}

function moduleRoot(sourcePath) {
    return {
        javaScript: `${sourcePath}.js`,
        declarationFile: `${sourcePath}.d.ts`
    };
}

function packageModules(exports) {
    return Object.entries(exports).map(function packageModule([ exportPath, root ]) {
        return { export: exportPath, root };
    });
}

function packageDefinition(packageSettings) {
    const { name, description, ...settings } = packageSettings;

    return {
        name: `@overkill-dev/${name}`,
        roots: { main: moduleRoot(`packages/${name}/${name}.entry-point`) },
        additionalFiles: [ {
            inputFilePath: path.join(projectFolder, `source/packages/${name}/readme.md`),
            targetFilePath: 'readme.md'
        } ],
        additionalPackageManifestAttributes: { ...packageMetadata, description },
        ...settings
    };
}

export const configuration = {
    registrySettings: {
        authentication: {
            publish: { type: 'npm-open-identity-connect', provider: 'automatic' },
            metadata: 'automatic'
        }
    },
    checks: {
        typeScriptIntegrity: { enabled: true, declarations: 'all' },
        noDevelopmentDependencyImports: { enabled: true },
        noUnusedBundleDependencies: { enabled: false },
        uniqueTargetPaths: { enabled: true },
        noUnexposedExecutables: { enabled: true },
        nodeEngineCompatibility: { enabled: true },
        noDuplicatedFiles: { enabled: false },
        requiredFiles: { enabled: true, files: [ 'LICENSE', 'readme.md' ] }
    },
    commonPackageSettings: {
        sourcesFolder: path.join(projectFolder, 'target/package-build/source'),
        mainPackageManifest: rootPackageJson,
        includeSourceMapFiles: true,
        publishSettings: {
            access: 'public',
            provenance: { type: 'automatic' }
        },
        additionalFiles: [ { inputFilePath: path.join(projectFolder, 'LICENSE'), targetFilePath: 'LICENSE' } ]
    },
    packages: selectPackages([
        {
            name: 'engine',
            description: 'Core Overkill engine primitives and execution model.',
            roots: {
                assertionProtocol: moduleRoot('packages/engine/assertion-protocol.entry-point'),
                main: moduleRoot('packages/engine/engine.entry-point'),
                rawComparison: moduleRoot('compare/raw-comparison')
            },
            defaultModuleRoot: 'main'
        },
        {
            name: 'assert',
            description: 'Reusable Overkill assertion-extension helpers.',
            bundlePeerDependencies: [ '@overkill-dev/engine' ]
        },
        {
            name: 'doubles',
            description: 'Explicit Overkill test doubles.',
            bundlePeerDependencies: [ '@overkill-dev/engine' ]
        },
        {
            name: 'simulation',
            description: 'Finite simulation descriptors and simulated server launchers for Overkill.',
            roots: {
                http: moduleRoot('packages/simulation/http.entry-point'),
                main: moduleRoot('packages/simulation/simulation.entry-point'),
                transcript: moduleRoot('packages/simulation/transcript.entry-point')
            },
            packageInterface: {
                modules: packageModules({
                    '.': 'main',
                    './http': 'http',
                    './transcript': 'transcript'
                })
            }
        },
        {
            name: 'resources',
            description: 'Typed Overkill resource and runtime descriptors.',
            roots: {
                main: moduleRoot('packages/resources/resources.entry-point'),
                attachmentContext: moduleRoot('packages/resources/attachment-context.entry-point')
            },
            packageInterface: {
                modules: packageModules({ '.': 'main', './attachment-context': 'attachmentContext' })
            },
            bundlePeerDependencies: [ '@overkill-dev/simulation' ]
        },
        {
            name: 'run',
            description: 'Overkill run resolution and orchestration.',
            roots: {
                attachmentConnection: { javaScript: 'run/attachment-connection.js' },
                attachmentRun: { javaScript: 'run/attachment-run.js' },
                benchmarkCommands: moduleRoot('run/benchmark-commands'),
                benchmarkBaselineCommands: { javaScript: 'run/benchmark-baseline-commands.js' },
                benchmarkBaselineOperations: { javaScript: 'run/benchmark-baseline-operations.js' },
                benchmarkBaselineRun: { javaScript: 'run/benchmark-baseline-run.js' },
                benchmarkBaselineSession: { javaScript: 'run/benchmark-baseline-session.js' },
                benchmarkCalibration: { javaScript: 'run/benchmark-calibration.js' },
                benchmarkCalibrationChild: { javaScript: 'run/benchmark-calibration.entry-point.js' },
                benchmarkHost: { javaScript: 'run/benchmark-host.js' },
                benchmarkGarbageCollection: { javaScript: 'run/benchmark-garbage-collection.js' },
                benchmarkExecutionEnvironment: { javaScript: 'run/benchmark-execution-environment.js' },
                benchmarkPlacement: { javaScript: 'run/benchmark-placement.js' },
                hostCalibration: moduleRoot('packages/run/benchmark-calibration.entry-point'),
                commandLine: moduleRoot('packages/run/command-line.entry-point'),
                config: moduleRoot('packages/run/config.entry-point'),
                coverageSession: { javaScript: 'run/coverage-session.js' },
                executionSessionEnvironment: { javaScript: 'run/execution-session-environment.js' },
                filters: moduleRoot('packages/run/filters.entry-point'),
                localCoverage: { javaScript: 'run/run-local-coverage.js' },
                main: moduleRoot('packages/run/run.entry-point'),
                nodeCommandLineRunner: moduleRoot('run/node-command-line-runner'),
                recordedCoverage: { javaScript: 'run/recorded-coverage-run.js' },
                resourceLifecycle: moduleRoot('packages/run/resource-lifecycle.entry-point'),
                transcriptStore: moduleRoot('packages/run/transcript-store.entry-point'),
                workerPoolWorker: { javaScript: 'run/worker-pool-worker.js' }
            },
            packageInterface: {
                modules: packageModules({
                    '.': 'main',
                    './benchmark-calibration': 'hostCalibration',
                    './command-line': 'commandLine',
                    './config': 'config',
                    './filters': 'filters',
                    './resource-lifecycle': 'resourceLifecycle',
                    './transcript-store': 'transcriptStore'
                }),
                privateRoots: [
                    'attachmentConnection',
                    'attachmentRun',
                    'benchmarkCommands',
                    'benchmarkBaselineCommands',
                    'benchmarkBaselineOperations',
                    'benchmarkBaselineRun',
                    'benchmarkBaselineSession',
                    'benchmarkCalibration',
                    'benchmarkCalibrationChild',
                    'benchmarkHost',
                    'benchmarkGarbageCollection',
                    'benchmarkExecutionEnvironment',
                    'benchmarkPlacement',
                    'coverageSession',
                    'executionSessionEnvironment',
                    'localCoverage',
                    'nodeCommandLineRunner',
                    'recordedCoverage',
                    'workerPoolWorker'
                ]
            }
        },
        {
            name: 'baselines',
            description: 'Shared Overkill baseline models and performance adapter contracts.',
            bundlePeerDependencies: [ '@overkill-dev/engine' ]
        },
        {
            name: 'bench',
            description: 'Workload measurement and performance budgets for Overkill benchmark suites.',
            roots: {
                main: moduleRoot('packages/bench/bench.entry-point'),
                calibration: moduleRoot('packages/bench/calibration.entry-point')
            },
            packageInterface: { modules: packageModules({ '.': 'main', './calibration': 'calibration' }) },
            bundlePeerDependencies: [
                '@overkill-dev/engine',
                '@overkill-dev/simulation',
                '@overkill-dev/resources',
                '@overkill-dev/run'
            ]
        },
        {
            name: 'stryker-runner',
            description: 'First-party Stryker TestRunner plugin for Overkill.',
            roots: {
                main: moduleRoot('packages/stryker-runner/stryker-runner.entry-point'),
                mutationLifecycle: { javaScript: 'packages/stryker-runner/mutation-lifecycle.js' }
            },
            packageInterface: {
                modules: packageModules({ '.': 'main' }),
                privateRoots: [ 'mutationLifecycle' ]
            },
            bundlePeerDependencies: [ '@overkill-dev/run' ]
        },
        {
            name: 'property',
            description: 'Generator-driven property test authoring for Overkill.',
            packageInterface: { modules: packageModules({ '.': 'main' }) },
            bundlePeerDependencies: [
                '@overkill-dev/engine',
                '@overkill-dev/simulation',
                '@overkill-dev/resources',
                '@overkill-dev/run'
            ]
        },
        {
            name: 'test',
            description: 'Standard Overkill distribution and command-line binary.',
            bundleDependencies: [
                '@overkill-dev/assert',
                '@overkill-dev/bench',
                '@overkill-dev/baselines',
                '@overkill-dev/doubles',
                '@overkill-dev/engine',
                '@overkill-dev/property',
                '@overkill-dev/output-renderer-github-actions',
                '@overkill-dev/reporter-benchmark-html',
                '@overkill-dev/reporter-brief',
                '@overkill-dev/reporter-dot',
                '@overkill-dev/reporter-line',
                '@overkill-dev/resources',
                '@overkill-dev/run',
                '@overkill-dev/simulation'
            ],
            roots: {
                assert: moduleRoot('packages/test/assert.entry-point'),
                baselines: moduleRoot('packages/test/baselines.entry-point'),
                bench: moduleRoot('packages/test/bench.entry-point'),
                compatibility: moduleRoot('packages/test/compatibility.entry-point'),
                config: moduleRoot('packages/test/config.entry-point'),
                main: moduleRoot('packages/test/test.entry-point'),
                overkill: { javaScript: 'packages/test/overkill.entry-point.js' },
                property: moduleRoot('packages/test/property.entry-point'),
                reporters: moduleRoot('packages/test/reporters.entry-point'),
                resources: moduleRoot('packages/test/resources.entry-point'),
                resourceWrapperSession: { javaScript: 'packages/test/resource-wrapper-session.js' },
                simulation: moduleRoot('packages/test/simulation.entry-point')
            },
            packageInterface: {
                modules: packageModules({
                    '.': 'main',
                    './assert': 'assert',
                    './baselines': 'baselines',
                    './bench': 'bench',
                    './compatibility': 'compatibility',
                    './config': 'config',
                    './property': 'property',
                    './reporters': 'reporters',
                    './resources': 'resources',
                    './simulation': 'simulation'
                }),
                executables: [
                    {
                        name: 'overkill',
                        root: 'overkill'
                    }
                ],
                privateRoots: [ 'resourceWrapperSession' ]
            }
        },
        {
            name: 'reporter-line',
            description: 'Human-readable Overkill line reporter family.',
            bundlePeerDependencies: [ '@overkill-dev/engine' ]
        },
        {
            name: 'reporter-brief',
            description: 'Token-conscious Overkill managed stdout reporter.',
            bundlePeerDependencies: [ '@overkill-dev/engine' ]
        },
        {
            name: 'reporter-dot',
            description: 'Compact Overkill dot progress reporter.',
            bundlePeerDependencies: [ '@overkill-dev/engine' ]
        },
        {
            name: 'reporter-benchmark-html',
            description: 'Interactive offline HTML reports for Overkill benchmarks.',
            bundlePeerDependencies: [ '@overkill-dev/engine', '@overkill-dev/baselines' ],
            additionalFiles: [
                {
                    inputFilePath: path.join(projectFolder, 'source/packages/reporter-benchmark-html/readme.md'),
                    targetFilePath: 'readme.md'
                },
                benchmarkHtmlClientAsset
            ]
        },
        {
            name: 'reporter-opentelemetry',
            description: 'OTLP JSON file reporter for Overkill timing data.',
            bundlePeerDependencies: [ '@overkill-dev/engine' ]
        },
        {
            name: 'output-renderer-github-actions',
            description: 'GitHub Actions renderer for Overkill managed output.',
            bundlePeerDependencies: [ '@overkill-dev/engine' ]
        }
    ]
        .map(packageDefinition))
};
