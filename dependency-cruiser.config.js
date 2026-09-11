const configFiles = [
    '^dependency-cruiser\\.config\\.js$',
    '^eslint\\.config\\.js$',
    '^packtory\\.config\\.js$'
];

const entryPointFiles = [
    '^source/packages/.+/.+\\.entry-point\\.ts$',
    '^source/reporters/',
    '^source/run/supervised-child\\.entry-point\\.ts$'
];
const testSupportFiles = [ '^source/test-support/' ];
const testFiles = [ '\\.(test|type-test)\\.ts$' ];
const testAggregatorFiles = [ '^source/test-support/unit-suite-groups/' ];
const testFixtureFiles = [ '^source/integration-tests/run/fixtures/' ];
const excludedFiles = [ '^(\\./)?target/', ...testFixtureFiles ];
const commandLineLazyModuleBoundaries = [
    '^source/packages/reporter-(dot|line)/',
    '^source/reporters/',
    '^source/.*/baseline',
    '^source/.*/bench',
    '^source/.*/benchmark',
    '^source/.*/coverage'
];
const testRootAuthoringFiles = [
    '^source/packages/test/authoring-input\\.ts$',
    '^source/packages/test/authoring-source-locations\\.ts$',
    '^source/packages/test/authoring-test-data\\.ts$',
    '^source/packages/test/harness-authoring\\.ts$',
    '^source/packages/test/interaction-transcript\\.ts$',
    '^source/packages/test/resource-attachment-boundary\\.ts$',
    '^source/packages/test/table-authoring\\.ts$',
    '^source/packages/test/test-authoring\\.ts$',
    '^source/packages/test/test\\.entry-point\\.ts$'
];
const testRootLazyModuleBoundaries = [
    '^source/packages/test/(baselines|bench|config|overkill|reporters|resources)\\.entry-point\\.ts$',
    '^source/packages/test/command-line-runner\\.ts$',
    '^source/packages/reporter-',
    '^source/packages/resources/',
    '^source/packages/run/(command-line|config|run)\\.entry-point\\.ts$',
    '^source/reporters/',
    '^source/resources/',
    '^source/run/(command-line|command-line-command|command-line-runner|config)',
    '^source/run/(current-process-run-orchestrator|default-direct-reporter|default-run-engine|node-)',
    '^source/run/(resource-usage|run-config|run-discovery|run-input|run-orchestrator|run-process-engine)',
    '^source/run/(run-selection|run-support|run-test|supervised)',
    '^source/.*/baseline',
    '^source/.*/bench',
    '^source/.*/benchmark',
    '^source/.*/coverage'
];

const ignoreFromOrphans = [ ...configFiles, ...entryPointFiles, ...testFiles, ...testSupportFiles ];

/** @type {import('dependency-cruiser').IConfiguration} */
export default {
    forbidden: [
        {
            name: 'no-circular',
            severity: 'error',
            from: {},
            to: {
                circular: true
            }
        },
        {
            name: 'no-orphans',
            severity: 'error',
            from: {
                orphan: true,
                pathNot: ignoreFromOrphans
            },
            to: {}
        },
        {
            name: 'no-internal-orphans',
            severity: 'error',
            from: {
                pathNot: []
            },
            module: {
                numberOfDependentsLessThan: 1,
                pathNot: ignoreFromOrphans
            }
        },
        {
            name: 'no-internal-but-tested-orphans',
            severity: 'error',
            from: {
                pathNot: testFiles
            },
            module: {
                numberOfDependentsLessThan: 1,
                pathNot: [
                    ...ignoreFromOrphans,
                    '.*(?<!\\.(ts|js))$',
                    '^node_modules/',
                    ...excludedFiles
                ]
            }
        },
        {
            name: 'no-unaggregated-unit-tests',
            severity: 'error',
            from: {
                pathNot: []
            },
            module: {
                numberOfDependentsLessThan: 1,
                path: '^source/(?!overkill\\.test\\.ts$)(?!integration-tests/).+\\.test\\.ts$'
            }
        },
        {
            name: 'no-deprecated-npm',
            severity: 'error',
            from: {},
            to: {
                dependencyTypes: [ 'deprecated' ]
            }
        },
        {
            name: 'no-duplicate-dep-types',
            severity: 'error',
            from: {},
            to: {
                dependencyTypes: [ 'npm' ],
                dependencyTypesNot: [ 'type-only' ],
                moreThanOneDependencyType: true
            }
        },
        {
            name: 'not-to-dev-dep',
            severity: 'error',
            from: {
                path: '^source/',
                pathNot: testFiles
            },
            to: {
                dependencyTypes: [ 'npm-dev' ],
                moreThanOneDependencyType: false,
                pathNot: [ '^node_modules/@types/', '\\.d\\.ts$' ]
            }
        },
        {
            name: 'no-non-package-json',
            severity: 'error',
            from: {},
            to: {
                dependencyTypes: [ 'npm-no-pkg', 'npm-unknown' ]
            }
        },
        {
            name: 'not-test-file-import',
            severity: 'error',
            from: {
                pathNot: [ ...testFiles, ...testAggregatorFiles ]
            },
            to: {
                path: testFiles
            }
        },
        {
            name: 'command-line-runner-keeps-lazy-command-boundaries',
            severity: 'error',
            from: {
                path: '^source/run/command-line-runner\\.ts$'
            },
            to: {
                dependencyTypesNot: [ 'type-only' ],
                dynamic: false,
                path: commandLineLazyModuleBoundaries
            }
        },
        {
            name: 'test-root-keeps-authoring-import-boundary',
            severity: 'error',
            from: {
                path: testRootAuthoringFiles
            },
            to: {
                dependencyTypesNot: [ 'type-only' ],
                dynamic: false,
                path: testRootLazyModuleBoundaries
            }
        }
    ],
    options: {
        doNotFollow: {
            path: 'node_modules|target/',
            dependencyTypes: [ 'npm', 'npm-dev', 'npm-optional', 'npm-peer', 'npm-bundled', 'npm-no-pkg' ]
        },
        exclude: {
            path: excludedFiles
        },
        moduleSystems: [ 'cjs', 'es6', 'tsd' ],
        tsPreCompilationDeps: true,
        tsConfig: {
            fileName: 'tsconfig.json'
        },
        preserveSymlinks: false,
        combinedDependencies: true,
        reporterOptions: {
            dot: {
                collapsePattern: 'node_modules/[^/]+'
            }
        }
    }
};
