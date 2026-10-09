export const strykerProfileScript = `
{
const { default: assert } = await import('node:assert/strict');
const { mkdtemp, readFile, rm, writeFile } = await import('node:fs/promises');
const { tmpdir } = await import('node:os');
const { join } = await import('node:path');
const { pathToFileURL } = await import('node:url');
const { strykerPlugins } = await import('@overkill-dev/stryker-runner');
const configApiUrl = import.meta.resolve('@overkill-dev/run/config');

const [plugin] = strykerPlugins;
const launchCwd = process.cwd();
const cwd = await mkdtemp(join(tmpdir(), 'overkill-stryker-profile-'));
const configPath = join(cwd, 'overkill.config.mjs');
const sentinel = join(cwd, 'never-imported.test.mjs');
await writeFile(sentinel, 'throw new Error("test module imported during initialization");');
const makeRunner = (overkill) => plugin.factory({ overkill });
const integration = { testFamily: 'integration', files: { include: ['never-imported.test.mjs'] } };
const microtest = {
    testFamily: 'microtest',
    files: { include: ['never-imported.test.mjs'] },
    execution: { processModel: 'in-process', scheduling: 'concurrent' }
};
let fixtureNumber = 0;

async function configuredRunner(profiles, profile) {
    const path = join(cwd, 'policy-' + fixtureNumber++ + '.mjs');
    await writeFile(path,
        'import { defineConfig } from ' + JSON.stringify(configApiUrl) + ';' +
        'export const config = defineConfig(' + JSON.stringify({ profiles }) + ');');
    return makeRunner({ configPath: path, profile });
}

try {
    process.chdir(cwd);
    await makeRunner(undefined).init();
    await writeFile(configPath, 'export const config = ' + JSON.stringify({ profiles: { microtest } }) + ';');
    await makeRunner({}).init();

    const selected = await configuredRunner({ unit: microtest, browser: integration }, 'unit');
    await Promise.all([selected.init(), selected.init()]);
    await selected.dispose();
    await selected.dispose();

    const inferred = await configuredRunner({ microtest: integration, unit: microtest }, null);
    await inferred.init();
    for (const [profiles, profile, message] of [
        [{ unit: microtest }, null, /Multiple microtest profiles exist: microtest, unit/],
        [{ microtest: integration }, null, /No eligible Node microtest profiles/],
        [{ unit: microtest }, 'absent', /Unknown mutation profile/],
        [{ browser: integration }, 'browser', /testFamily "integration"/],
        [{ microtest: { testFamily: 'benchmark', files: { include: ['never-imported.test.mjs'] } } },
            'microtest', /testFamily "benchmark"/]
    ]) {
        const runner = await configuredRunner(profiles, profile);
        await assert.rejects(runner.init(), { name: 'RunResolutionError', message });
        await runner.dispose();
    }

    for (const value of [
        { profile: ['unit', 'browser'] }, { profile: 1 }, { profiles: ['unit'] }, { browser: true }
    ]) {
        await assert.rejects(makeRunner(value).init(), { name: 'ConfigError' });
    }
    for (const malformed of [
        { testFamily: ['microtest', 'integration'] },
        { testFamily: 'browser' },
        { testFamily: 'microtest', browser: true }
    ]) {
        const runner = await configuredRunner({ unit: malformed }, 'unit');
        await assert.rejects(runner.init(), { name: 'ConfigError' });
    }

    const missing = makeRunner({ configPath: 'absent.config.mjs' });
    await assert.rejects(missing.init(), (error) => {
        assert.equal(error.name, 'ConfigError');
        assert.match(error.message, /Failed to load config file/);
        assert.ok(error.cause instanceof Error);
        return true;
    });
    const brokenPath = join(cwd, 'broken.config.mjs');
    await writeFile(brokenPath, 'throw new Error("config import failed");');
    await assert.rejects(makeRunner({ configPath: brokenPath }).init(), { name: 'ConfigError' });

    const oncePath = join(cwd, 'once.config.mjs');
    const countPath = join(cwd, 'load-count');
    await writeFile(oncePath,
        'import { appendFileSync } from "node:fs";' +
        'appendFileSync(' + JSON.stringify(countPath) + ', "load");' +
        'export const config = {};');
    const once = makeRunner({ configPath: oncePath });
    await Promise.all([once.init(), once.init()]);
    const { config: changedPolicy } = await import(pathToFileURL(oncePath).href);
    changedPolicy.profiles = { microtest: integration };
    await once.init();
    assert.equal(await readFile(countPath, 'utf8'), 'load');
    await assert.rejects(makeRunner({ configPath: oncePath }).init(), {
        name: 'RunResolutionError', message: /No eligible Node microtest profiles/
    });

    const failed = makeRunner({ configPath: 'later.config.mjs' });
    await assert.rejects(failed.init(), { name: 'ConfigError' });
    await writeFile(join(cwd, 'later.config.mjs'), 'export const config = {};');
    await assert.rejects(failed.init(), { name: 'ConfigError' });
    await makeRunner({ configPath: 'later.config.mjs' }).init();
} finally {
    process.chdir(launchCwd);
    await rm(cwd, { recursive: true, force: true });
}
}
`;
