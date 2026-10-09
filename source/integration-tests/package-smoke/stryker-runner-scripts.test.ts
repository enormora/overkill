import { strykerProfileScript } from './stryker-profile-scripts.test.ts';

export const strykerRunnerScript = `
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import * as adapter from '@overkill-dev/stryker-runner';

assert.deepEqual(Object.keys(adapter), ['strykerPlugins', 'strykerValidationSchema']);
assert.equal(adapter.strykerPlugins.length, 1);
const [plugin] = adapter.strykerPlugins;
assert.equal(plugin.kind, 'TestRunner');
assert.equal(plugin.name, 'overkill');
assert.deepEqual(plugin.factory.inject, ['options']);
const runner = plugin.factory({});
assert.notEqual(runner, plugin.factory({}));

assert.throws(() => runner.capabilities(), {
    name: 'Error',
    message: '@overkill-dev/stryker-runner: capabilities() is not implemented.'
});
await runner.init();
await assert.rejects(runner.dryRun({
    coverageAnalysis: 'perTest',
    disableBail: false,
    timeout: 1000
}), {
    name: 'Error',
    message: '@overkill-dev/stryker-runner: dryRun() is not implemented.'
});
await assert.rejects(runner.mutantRun({
    activeMutant: {
        fileName: 'subject.js',
        id: '0',
        location: { start: { line: 0, column: 0 }, end: { line: 0, column: 4 } },
        mutatorName: 'BooleanLiteral',
        replacement: 'false'
    },
    disableBail: false,
    mutantActivation: 'runtime',
    reloadEnvironment: false,
    sandboxFileName: 'subject.js',
    timeout: 1000
}), {
    name: 'Error',
    message: '@overkill-dev/stryker-runner: mutantRun() is not implemented.'
});
await runner.dispose();
await runner.dispose();
await plugin.factory({}).dispose();

const manifestUrl = new URL('../../package.json', import.meta.resolve('@overkill-dev/stryker-runner'));
const manifest = JSON.parse(readFileSync(manifestUrl, 'utf8'));
assert.equal(manifest.name, '@overkill-dev/stryker-runner');
assert.equal(typeof manifest.peerDependencies['@overkill-dev/run'], 'string');
const runManifestUrl = new URL('node_modules/@overkill-dev/run/package.json', manifestUrl);
assert.equal(JSON.parse(readFileSync(runManifestUrl, 'utf8')).name, '@overkill-dev/run');
assert.deepEqual(manifest.exports, {
    '.': {
        import: './packages/stryker-runner/stryker-runner.entry-point.js',
        types: './packages/stryker-runner/stryker-runner.entry-point.d.ts'
    }
});
const apiManifestUrl = new URL('node_modules/@stryker-mutator/api/package.json', manifestUrl);
const apiManifest = JSON.parse(readFileSync(apiManifestUrl, 'utf8'));
assert.equal(apiManifest.version, '10.0.0');
assert.equal(existsSync(new URL('LICENSE', manifestUrl)), true);
assert.match(readFileSync(new URL('readme.md', manifestUrl), 'utf8'), /requires an explicit name/);
const standardManifestUrl = new URL('../../package.json', import.meta.resolve('@overkill-dev/test'));
const standardManifest = JSON.parse(readFileSync(standardManifestUrl, 'utf8'));
for (const dependencies of [standardManifest.dependencies, standardManifest.peerDependencies]) {
    assert.equal(Object.hasOwn(dependencies ?? {}, '@overkill-dev/stryker-runner'), false);
    assert.equal(Object.keys(dependencies ?? {}).some((name) => name.startsWith('@stryker-mutator/')), false);
}
assert.equal(existsSync(new URL('node_modules/@overkill-dev/stryker-runner', standardManifestUrl)), false);
assert.equal(existsSync(new URL('node_modules/@stryker-mutator', standardManifestUrl)), false);
${strykerProfileScript}
console.log('stryker profile initialization passed');
`;
