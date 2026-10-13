import { strykerProfileScript } from './stryker-profile-scripts.test.ts';
import { strykerSandboxScript } from './stryker-sandbox-scripts.test.ts';
import { strykerFreshStateScript } from './stryker-fresh-state-scripts.test.ts';

export const strykerRunnerScript = `
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import * as adapter from '@overkill-dev/stryker-runner';

assert.deepEqual(Object.keys(adapter), ['strykerPlugins', 'strykerValidationSchema']);
assert.equal(adapter.strykerPlugins.length, 1);
const [plugin] = adapter.strykerPlugins;
assert.equal(plugin.kind, 'TestRunner');
assert.equal(plugin.name, 'overkill');
assert.deepEqual(plugin.factory.inject, ['options', 'fileDescriptions', 'logger']);
const runner = plugin.factory({ overkill: { paths: ['stryker-runner.test.js'], seed: '42' } }, {
    [process.cwd() + '/stryker-runner.test.js']: { mutate: false }
}, {info() {}});
assert.notEqual(runner, plugin.factory({}, {}, {info() {}}));

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
await plugin.factory({}, {}, {info() {}}).dispose();

const manifestUrl = new URL('../../package.json', import.meta.resolve('@overkill-dev/stryker-runner'));
const manifest = JSON.parse(readFileSync(manifestUrl, 'utf8'));
assert.equal(manifest.name, '@overkill-dev/stryker-runner');
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
const { execFileSync } = await import('node:child_process');
const { mkdtempSync, rmSync } = await import('node:fs');
const { tmpdir } = await import('node:os');
const { join } = await import('node:path');
const profileCwd = mkdtempSync(join(tmpdir(), 'overkill-stryker-profile-'));
try {
    execFileSync(process.execPath, ['--input-type=module', '--eval', ${JSON.stringify(strykerProfileScript)},
        import.meta.resolve('@overkill-dev/stryker-runner'), import.meta.resolve('@overkill-dev/run/config')],
        { cwd: profileCwd, stdio: 'pipe' });
    execFileSync(process.execPath, ['--input-type=module', '--eval', ${JSON.stringify(strykerSandboxScript)},
        import.meta.resolve('@overkill-dev/stryker-runner')], { cwd: profileCwd, stdio: 'pipe' });
    execFileSync(process.execPath, ['--input-type=module', '--eval', ${JSON.stringify(strykerFreshStateScript)},
        import.meta.resolve('@overkill-dev/run'), import.meta.resolve('@overkill-dev/engine'),
        import.meta.resolve('@overkill-dev/stryker-runner')],
        { cwd: profileCwd, stdio: 'pipe' });
} finally {
    rmSync(profileCwd, { recursive: true, force: true });
}
console.log('stryker profile initialization passed');
`;
