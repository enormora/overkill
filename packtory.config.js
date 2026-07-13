import fs from 'node:fs';
import path from 'node:path';

const projectFolder = process.cwd();
const rootPackageJson = JSON.parse(fs.readFileSync(path.join(projectFolder, 'package.json'), 'utf8'));

const packageMetadata = {
    author: rootPackageJson.author,
    bugs: rootPackageJson.bugs,
    homepage: rootPackageJson.homepage,
    keywords: rootPackageJson.keywords,
    license: rootPackageJson.license,
    repository: rootPackageJson.repository
};

export const config = {
    registrySettings: {
        token: process.env.NPM_TOKEN ?? 'packtory-dry-run-token'
    },
    commonPackageSettings: {
        sourcesFolder: path.join(projectFolder, 'target/build/source'),
        mainPackageJson: rootPackageJson,
        additionalFiles: [ { sourceFilePath: path.join(projectFolder, 'LICENSE'), targetFilePath: 'LICENSE' } ]
    },
    packages: [
        {
            name: '@overkill/engine',
            entryPoints: [
                {
                    js: 'packages/engine/entry-point.js',
                    declarationFile: 'packages/engine/entry-point.d.ts'
                }
            ],
            additionalPackageJsonAttributes: {
                ...packageMetadata,
                description: 'Core Overkill engine primitives and execution model.'
            }
        }
    ]
};
