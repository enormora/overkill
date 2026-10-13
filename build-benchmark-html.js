import { mkdir, copyFile, readFile, readdir } from 'node:fs/promises';
import { dirname, basename, join } from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const libraryImports = createRequire(import.meta.url);
async function readLibraryAttribution(library) {
    const folder = dirname(libraryImports.resolve(`${library}/package.json`));
    const files = await readdir(folder, { recursive: true });
    const licenseFiles = files
        .filter(function attributionFile(file) {
            return /^(?:LICENSE|NOTICE)(?:[.-].*)?$/i.test(basename(file));
        })
        .toSorted(function (left, right) {
            return left.localeCompare(right);
        });
    const sections = await Promise.all(licenseFiles.map(async function readAttribution(file) {
        const text = await readFile(join(folder, file), 'utf8');
        return `${library}/${file}\n${text}`;
    }));
    return sections.join('\n\n');
}
const chartPackage = JSON.parse(await readFile(libraryImports.resolve('echarts/package.json'), 'utf8'));
const libraries = [ 'echarts', ...Object.keys(chartPackage.dependencies) ];
const licenses = await Promise.all(libraries.map(readLibraryAttribution));
const attribution = licenses.join('\n\n').replaceAll('*/', '* /');
const output = 'target/benchmark-html/client.txt';
await build({
    entryPoints: [ 'source/reporters/benchmark-html-browser.entry-point.ts' ],
    outfile: output,
    bundle: true,
    minify: true,
    platform: 'browser',
    format: 'iife',
    target: 'es2025',
    footer: { js: `/*\n${attribution}\n*/` }
});
for (
    const destination of [
        'target/build/source/reporters/benchmark-html-assets/client.txt',
        'target/package-build/source/reporters/benchmark-html-assets/client.txt'
    ]
) {
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(output, destination);
}
