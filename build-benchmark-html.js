import { mkdir, copyFile, readFile, readdir, appendFile } from 'node:fs/promises';
import { dirname, basename, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { rspack as createCompiler, SwcJsMinimizerRspackPlugin as JavaScriptMinimizer } from '@rspack/core';

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
const maximumClientBytes = 1_048_576;
const compiler = createCompiler({
    mode: 'production',
    entry: './source/reporters/benchmark-html-browser.entry-point.ts',
    target: [ 'web', 'es2025' ],
    devtool: false,
    output: { path: resolve(dirname(output)), filename: basename(output), iife: true },
    performance: { maxAssetSize: maximumClientBytes, maxEntrypointSize: maximumClientBytes, hints: 'error' },
    module: {
        rules: [ {
            test: /\.ts$/,
            loader: 'builtin:swc-loader',
            options: { jsc: { parser: { syntax: 'typescript' }, target: 'esnext' } }
        } ]
    },
    optimization: {
        runtimeChunk: false,
        splitChunks: false,
        minimize: true,
        minimizer: [ new JavaScriptMinimizer({ test: /\.txt$/, extractComments: false }) ]
    }
});
const stats = await promisify(compiler.run.bind(compiler))().finally(promisify(compiler.close.bind(compiler)));
if (stats.hasErrors() || stats.hasWarnings()) {
    throw new Error(stats.toString({ all: false, errors: true, warnings: true }));
}
await appendFile(output, `\n/*\n${attribution}\n*/\n`);
for (
    const destination of [
        'target/build/source/reporters/benchmark-html-assets/client.txt',
        'target/package-build/source/reporters/benchmark-html-assets/client.txt'
    ]
) {
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(output, destination);
}
