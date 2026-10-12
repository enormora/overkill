export const strykerProfileScript = `
{
const { default: assert } = await import('node:assert/strict');
const { readFile, writeFile } = await import('node:fs/promises');
const { join } = await import('node:path');
const { strykerPlugins } = await import(process.argv[1]);
const configApiUrl = process.argv[2];

const [plugin] = strykerPlugins;
const launchCwd = process.cwd();
const cwd = process.cwd();
const configPath = join(cwd, 'overkill.config.js');
const sentinel = join(cwd, 'never-imported.test.mjs');
await writeFile(sentinel, 'throw new Error("test module imported during initialization");');
const { readdirSync } = await import('node:fs');
const makeRunner = (overkill) => plugin.factory({ overkill }, Object.fromEntries(
    readdirSync(cwd).map((file) => [join(cwd, file), { mutate: false }])
));
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
    await assert.rejects(makeRunner(undefined).init(), { name: 'RunResolutionError' });
    await makeRunner({ paths: ['never-imported.test.mjs'] }).init();
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
    const once = makeRunner({ configPath: oncePath, paths: ['never-imported.test.mjs'] });
    await Promise.all([once.init(), once.init()]);
    await writeFile(oncePath,
        'export const config = ' + JSON.stringify({ profiles: { microtest: integration } }) + ';');
    await once.init();
    assert.equal(await readFile(countPath, 'utf8'), 'load');
    await assert.rejects(makeRunner({ configPath: oncePath }).init(), {
        name: 'RunResolutionError', message: /No eligible Node microtest profiles/
    });

    const failed = makeRunner({ configPath: 'later.config.mjs' });
    await assert.rejects(failed.init(), { name: 'ConfigError' });
    await writeFile(join(cwd, 'later.config.mjs'), 'export const config = {};');
    await assert.rejects(failed.init(), { name: 'ConfigError' });
    await makeRunner({ configPath: 'later.config.mjs', paths: ['never-imported.test.mjs'] }).init();

    for (const [name, source, message] of [
        ['malformed', 'process.send({ kind: "policy", policy: {} }); export const config = {};', /./],
        ['exited', 'process.exit(17);', /resolver exited without a result/]
    ]) {
        const path = join(cwd, name + '.config.mjs');
        await writeFile(path, source);
        const runner = makeRunner({ configPath: path, paths: ['never-imported.test.mjs'] });
        await assert.rejects(runner.init(), { message });
        await runner.dispose();
    }

    const pidPath = join(cwd, 'pending.pid');
    const pendingPath = join(cwd, 'pending.config.mjs');
    await writeFile(pendingPath,
        'import { writeFileSync } from "node:fs";' +
        'writeFileSync(' + JSON.stringify(pidPath) + ', String(process.pid));' +
        'setInterval(() => {}, 1000); await new Promise(() => {}); export const config = {};');
    const pending = makeRunner({ configPath: pendingPath });
    const canceled = assert.rejects(pending.init(), { name: 'AbortError' });
    let pid;
    for (let attempt = 0; attempt < 1000 && pid === undefined; attempt++) {
        try { pid = Number(await readFile(pidPath, 'utf8')); }
        catch { await new Promise((resolve) => setTimeout(resolve, 10)); }
    }
    assert.notEqual(pid, undefined);
    await pending.dispose();
    await canceled;
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
    await assert.rejects(pending.init(), { name: 'ConfigError', message: /disposed/ });

    const activeVariable = '__STRYKER_ACTIVE_MUTANT__';
    const instrumented = join(cwd, 'instrumented-policy.mjs');
    const activeConfig = join(cwd, 'active.config.mjs');
    await writeFile(instrumented,
        'globalThis.__stryker__ = globalThis.__stryker__ || {};' +
        'globalThis.__stryker__.activeMutant = process.env.' + activeVariable + ';' +
        'export const microtest = globalThis.__stryker__.activeMutant === "0"' +
        '? {testFamily:"integration",files:{include:["never-imported.test.mjs"]}}' +
        ': ' + JSON.stringify(microtest) + ';');
    await writeFile(activeConfig,
        'import { microtest } from "./instrumented-policy.mjs";' +
        'export const config = { profiles: { microtest } };');
    const previousActive = process.env[activeVariable];
    process.env[activeVariable] = '0';
    try {
        await makeRunner({ configPath: activeConfig }).init();
        assert.equal(globalThis.__stryker__, undefined);
    } finally {
        if (previousActive === undefined) delete process.env[activeVariable];
        else process.env[activeVariable] = previousActive;
    }
} finally {
    process.chdir(launchCwd);
}
}
`;
