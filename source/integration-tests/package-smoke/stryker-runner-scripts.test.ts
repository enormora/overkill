import { strykerCampaignScript } from '../run/stryker-campaign-scripts.test.ts';
import { strykerCoverageScript } from '../run/stryker-coverage-scripts.test.ts';
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

assert.deepEqual(await runner.capabilities(), { reloadEnvironment: true });
await runner.init();
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
for (const processModel of ['in-process', 'supervised-process']) {
    for (const freshState of ['false', 'true']) {
        for (const coverageAnalysis of ['perTest', 'all', 'off']) {
            const campaignCwd = mkdtempSync(join(tmpdir(), 'overkill-stryker-packaged-campaign-'));
            try {
                execFileSync(process.execPath, [
                    '--input-type=module', '--eval', ${JSON.stringify(strykerCampaignScript)},
                    ${JSON.stringify(import.meta.resolve('@stryker-mutator/core'))},
                    import.meta.resolve('@overkill-dev/stryker-runner'), import.meta.resolve('@overkill-dev/engine'),
                    import.meta.resolve('@overkill-dev/run/config'), processModel, freshState, '1', coverageAnalysis],
                    { cwd: campaignCwd, stdio: 'pipe' });
            } finally {
                rmSync(campaignCwd, { recursive: true, force: true });
            }
            const coverageCwd = mkdtempSync(join(tmpdir(), 'overkill-stryker-packaged-coverage-'));
            try {
                execFileSync(process.execPath, [
                    '--input-type=module', '--eval', ${JSON.stringify(strykerCoverageScript)},
                    ${JSON.stringify(import.meta.resolve('@stryker-mutator/instrumenter'))},
                    import.meta.resolve('@overkill-dev/stryker-runner'), import.meta.resolve('@overkill-dev/engine'),
                    import.meta.resolve('@overkill-dev/run/config'), processModel, freshState, coverageAnalysis],
                    { cwd: coverageCwd, stdio: 'pipe' });
            } finally {
                rmSync(coverageCwd, { recursive: true, force: true });
            }
        }
    }
}
console.log('stryker profile initialization passed');
`;
