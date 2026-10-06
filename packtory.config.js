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
        js: `${sourcePath}.js`,
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
        additionalPackageJsonAttributes: { ...packageMetadata, description },
        ...settings
    };
}

export const config = {
    registrySettings: {
        auth: {
            publish: { type: 'npm-oidc', provider: 'auto' },
            metadata: 'auto'
        }
    },
    checks: {
        typeScriptIntegrity: {
            enabled: true,
            declarations: 'all'
        }
    },
    commonPackageSettings: {
        sourcesFolder: path.join(projectFolder, 'target/build/source'),
        mainPackageJson: rootPackageJson,
        includeSourceMapFiles: true,
        publishSettings: {
            access: 'public',
            provenance: { type: 'auto' }
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
                attachmentConnection: { js: 'run/attachment-connection.js' },
                attachmentRun: { js: 'run/attachment-run.js' },
                commandLine: moduleRoot('packages/run/command-line.entry-point'),
                config: moduleRoot('packages/run/config.entry-point'),
                coverageSession: { js: 'run/coverage-session.js' },
                filters: moduleRoot('packages/run/filters.entry-point'),
                localCoverage: { js: 'run/run-local-coverage.js' },
                main: moduleRoot('packages/run/run.entry-point'),
                nodeCommandLineRunner: moduleRoot('run/node-command-line-runner'),
                recordedCoverage: { js: 'run/recorded-coverage-run.js' },
                resourceLifecycle: moduleRoot('packages/run/resource-lifecycle.entry-point'),
                transcriptStore: moduleRoot('packages/run/transcript-store.entry-point'),
                workerPoolWorker: { js: 'run/worker-pool-worker.js' }
            },
            packageInterface: {
                modules: packageModules({
                    '.': 'main',
                    './command-line': 'commandLine',
                    './config': 'config',
                    './filters': 'filters',
                    './resource-lifecycle': 'resourceLifecycle',
                    './transcript-store': 'transcriptStore'
                }),
                privateRoots: [
                    'attachmentConnection',
                    'attachmentRun',
                    'coverageSession',
                    'localCoverage',
                    'nodeCommandLineRunner',
                    'recordedCoverage',
                    'workerPoolWorker'
                ]
            }
        },
        {
            name: 'bench',
            description: 'Ordinary test-node authoring for Overkill benchmark suites.',
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
                '@overkill-dev/doubles',
                '@overkill-dev/engine',
                '@overkill-dev/output-renderer-github-actions',
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
                overkill: { js: 'packages/test/overkill.entry-point.js' },
                reporters: moduleRoot('packages/test/reporters.entry-point'),
                resources: moduleRoot('packages/test/resources.entry-point'),
                resourceWrapperSession: { js: 'packages/test/resource-wrapper-session.js' },
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
                    './reporters': 'reporters',
                    './resources': 'resources',
                    './simulation': 'simulation'
                }),
                bins: [
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
