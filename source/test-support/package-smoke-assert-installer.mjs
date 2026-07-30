import fs from 'node:fs/promises';
import path from 'node:path';

const projectFolder = process.cwd();
const buildFolder = path.join(projectFolder, 'target/build/source');
const packageFolder = path.join(
    buildFolder,
    'integration-tests/package-smoke/node_modules/@overkill-dev/assert'
);
const packageJsonIndent = 4;
const packageJson = {
    exports: {
        '.': './packages/assert/assert.entry-point.js'
    },
    name: '@overkill-dev/assert',
    peerDependencies: {
        '@overkill-dev/engine': '0.0.0'
    },
    type: 'module',
    version: '0.0.0'
};

async function copyTextFile(sourcePath, targetPath, transform) {
    const source = await fs.readFile(sourcePath, 'utf8');
    const content = transform(source);

    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, content);
}

await fs.rm(packageFolder, { force: true, recursive: true });

await copyTextFile(
    path.join(buildFolder, 'packages/assert/assert.entry-point.js'),
    path.join(packageFolder, 'packages/assert/assert.entry-point.js'),
    function preserveContent(content) {
        return content;
    }
);
await copyTextFile(
    path.join(buildFolder, 'assert/assertion-extension.js'),
    path.join(packageFolder, 'assert/assertion-extension.js'),
    function rewriteProtocolImport(content) {
        return content.replace(
            '../packages/engine/assertion-protocol.entry-point.js',
            '@overkill-dev/engine/packages/engine/assertion-protocol.entry-point.js'
        );
    }
);
await fs.writeFile(
    path.join(packageFolder, 'package.json'),
    `${JSON.stringify(packageJson, null, packageJsonIndent)}\n`
);
