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
        additionalFiles: [ { sourceFilePath: path.join(projectFolder, 'LICENSE'), targetFilePath: 'LICENSE' } ]
    },
    packages: selectPackages([
        {
            name: '@overkill-dev/engine',
            roots: {
                assertionProtocol: {
                    js: 'packages/engine/assertion-protocol.entry-point.js',
                    declarationFile: 'packages/engine/assertion-protocol.entry-point.d.ts'
                },
                main: {
                    js: 'packages/engine/engine.entry-point.js',
                    declarationFile: 'packages/engine/engine.entry-point.d.ts'
                },
                rawComparison: {
                    js: 'compare/raw-comparison.js',
                    declarationFile: 'compare/raw-comparison.d.ts'
                }
            },
            defaultModuleRoot: 'main',
            additionalFiles: [
                {
                    sourceFilePath: path.join(projectFolder, 'source/packages/engine/readme.md'),
                    targetFilePath: 'readme.md'
                }
            ],
            additionalPackageJsonAttributes: {
                ...packageMetadata,
                description: 'Core Overkill engine primitives and execution model.'
            }
        },
        {
            name: '@overkill-dev/assert',
            bundlePeerDependencies: [ '@overkill-dev/engine' ],
            roots: {
                main: {
                    js: 'packages/assert/assert.entry-point.js',
                    declarationFile: 'packages/assert/assert.entry-point.d.ts'
                }
            },
            additionalFiles: [
                {
                    sourceFilePath: path.join(projectFolder, 'source/packages/assert/readme.md'),
                    targetFilePath: 'readme.md'
                }
            ],
            additionalPackageJsonAttributes: {
                ...packageMetadata,
                description: 'Reusable Overkill assertion-extension helpers.'
            }
        },
        {
            name: '@overkill-dev/doubles',
            bundlePeerDependencies: [ '@overkill-dev/engine' ],
            roots: {
                main: {
                    js: 'packages/doubles/doubles.entry-point.js',
                    declarationFile: 'packages/doubles/doubles.entry-point.d.ts'
                }
            },
            additionalFiles: [
                {
                    sourceFilePath: path.join(projectFolder, 'source/packages/doubles/readme.md'),
                    targetFilePath: 'readme.md'
                }
            ],
            additionalPackageJsonAttributes: {
                ...packageMetadata,
                description: 'Explicit Overkill test doubles.'
            }
        },
        {
            name: '@overkill-dev/run',
            roots: {
                commandLine: {
                    js: 'packages/run/command-line.entry-point.js',
                    declarationFile: 'packages/run/command-line.entry-point.d.ts'
                },
                filters: {
                    js: 'packages/run/filters.entry-point.js',
                    declarationFile: 'packages/run/filters.entry-point.d.ts'
                },
                main: {
                    js: 'packages/run/run.entry-point.js',
                    declarationFile: 'packages/run/run.entry-point.d.ts'
                }
            },
            packageInterface: {
                modules: [
                    {
                        export: '.',
                        root: 'main'
                    },
                    {
                        export: './command-line',
                        root: 'commandLine'
                    },
                    {
                        export: './filters',
                        root: 'filters'
                    }
                ]
            },
            additionalFiles: [
                {
                    sourceFilePath: path.join(projectFolder, 'source/packages/run/readme.md'),
                    targetFilePath: 'readme.md'
                }
            ],
            additionalPackageJsonAttributes: {
                ...packageMetadata,
                description: 'Overkill run resolution and orchestration.'
            }
        },
        {
            name: '@overkill-dev/test',
            bundleDependencies: [ '@overkill-dev/run' ],
            roots: {
                overkill: {
                    js: 'packages/test/overkill.entry-point.js'
                }
            },
            packageInterface: {
                bins: [
                    {
                        name: 'overkill',
                        root: 'overkill'
                    }
                ]
            },
            additionalFiles: [
                {
                    sourceFilePath: path.join(projectFolder, 'source/packages/test/readme.md'),
                    targetFilePath: 'readme.md'
                }
            ],
            additionalPackageJsonAttributes: {
                ...packageMetadata,
                description: 'Standard Overkill distribution and command-line binary.'
            }
        },
        {
            name: '@overkill-dev/reporter-line',
            bundlePeerDependencies: [ '@overkill-dev/engine' ],
            roots: {
                main: {
                    js: 'packages/reporter-line/reporter-line.entry-point.js',
                    declarationFile: 'packages/reporter-line/reporter-line.entry-point.d.ts'
                }
            },
            additionalFiles: [
                {
                    sourceFilePath: path.join(projectFolder, 'source/packages/reporter-line/readme.md'),
                    targetFilePath: 'readme.md'
                }
            ],
            additionalPackageJsonAttributes: {
                ...packageMetadata,
                description: 'Human-readable Overkill line reporter.'
            }
        },
        {
            name: '@overkill-dev/reporter-brief',
            bundlePeerDependencies: [ '@overkill-dev/engine' ],
            roots: {
                main: {
                    js: 'packages/reporter-brief/reporter-brief.entry-point.js',
                    declarationFile: 'packages/reporter-brief/reporter-brief.entry-point.d.ts'
                }
            },
            additionalFiles: [
                {
                    sourceFilePath: path.join(projectFolder, 'source/packages/reporter-brief/readme.md'),
                    targetFilePath: 'readme.md'
                }
            ],
            additionalPackageJsonAttributes: {
                ...packageMetadata,
                description: 'Token-conscious Overkill managed stdout reporter.'
            }
        },
        {
            name: '@overkill-dev/reporter-dot',
            bundlePeerDependencies: [ '@overkill-dev/engine' ],
            roots: {
                main: {
                    js: 'packages/reporter-dot/reporter-dot.entry-point.js',
                    declarationFile: 'packages/reporter-dot/reporter-dot.entry-point.d.ts'
                }
            },
            additionalFiles: [
                {
                    sourceFilePath: path.join(projectFolder, 'source/packages/reporter-dot/readme.md'),
                    targetFilePath: 'readme.md'
                }
            ],
            additionalPackageJsonAttributes: {
                ...packageMetadata,
                description: 'Compact Overkill dot progress reporter.'
            }
        },
        {
            name: '@overkill-dev/output-renderer-github-actions',
            bundlePeerDependencies: [ '@overkill-dev/engine' ],
            roots: {
                main: {
                    js: 'packages/output-renderer-github-actions/output-renderer-github-actions.entry-point.js',
                    declarationFile:
                        'packages/output-renderer-github-actions/output-renderer-github-actions.entry-point.d.ts'
                }
            },
            additionalFiles: [
                {
                    sourceFilePath: path.join(
                        projectFolder,
                        'source/packages/output-renderer-github-actions/readme.md'
                    ),
                    targetFilePath: 'readme.md'
                }
            ],
            additionalPackageJsonAttributes: {
                ...packageMetadata,
                description: 'GitHub Actions renderer for Overkill managed output.'
            }
        }
    ])
};
