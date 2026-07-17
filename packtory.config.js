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

export const config = {
    registrySettings: {
        token: process.env.NPM_TOKEN ?? 'packtory-dry-run-token'
    },
    commonPackageSettings: {
        sourcesFolder: path.join(projectFolder, 'target/build/source'),
        mainPackageJson: rootPackageJson,
        publishSettings: { access: 'public' },
        additionalFiles: [ { sourceFilePath: path.join(projectFolder, 'LICENSE'), targetFilePath: 'LICENSE' } ]
    },
    packages: [
        {
            name: '@overkill-dev/engine',
            roots: {
                main: {
                    js: 'packages/engine/engine.entry-point.js',
                    declarationFile: 'packages/engine/engine.entry-point.d.ts'
                }
            },
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
            name: '@overkill-dev/run',
            roots: {
                main: {
                    js: 'packages/run/run.entry-point.js',
                    declarationFile: 'packages/run/run.entry-point.d.ts'
                }
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
        }
    ]
};
