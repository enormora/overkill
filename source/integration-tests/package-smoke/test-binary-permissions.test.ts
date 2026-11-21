import { consumerEnvironment } from './support/consumer-environment.ts';
import { spawn } from 'node:child_process';
import { chmod, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { text } from 'node:stream/consumers';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { suite } from '@overkill-dev/test';
import { packageConsumer } from './support/package-consumer.ts';

const consumerFacade = packageConsumer('shipped CLI permission policies', function consumerFixture(consumerDirectory) {
    const consumerFolder = fileURLToPath(new URL('./permission-consumer/', pathToFileURL(`${consumerDirectory}/`)));
    const binaryPath = fileURLToPath(
        new URL(
            './node_modules/@overkill-dev/test/packages/test/overkill.entry-point.js',
            pathToFileURL(`${consumerDirectory}/`)
        )
    );
    async function runBinary(profile: string, file: string): Promise<CliResult> {
        await mkdir(consumerFolder, { recursive: true });
        await rm(path.join(consumerFolder, file.replace('.test.mjs', '-output.txt')), { force: true });
        await Promise.all([
            writeFile(path.join(consumerFolder, 'package.json'), '{"type":"module"}'),
            writeFile(path.join(consumerFolder, 'overkill.config.js'), configScript),
            writeFile(path.join(consumerFolder, 'pure.test.mjs'), pureScript),
            writeFile(path.join(consumerFolder, 'filesystem.test.mjs'), filesystemScript),
            writeFile(path.join(consumerFolder, 'subprocess.test.mjs'), subprocessScript)
        ]);
        await chmod(binaryPath, 0o755);
        const environment = readProcessEnvironment(process);
        const child = spawn(binaryPath, [ 'run', '--config', 'overkill.config.js', '--profile', profile, file ], {
            cwd: consumerFolder,
            env: consumerEnvironment({
                ...environment,
                PATH: `${path.dirname(process.execPath)}${path.delimiter}${environment.PATH ?? ''}`
            }, consumerDirectory),
            stdio: [ 'ignore', 'pipe', 'pipe' ]
        });
        const stdout = text(child.stdout);
        const stderr = text(child.stderr);
        const code = await new Promise<number | null>(function waitForExit(resolve, reject) {
            child.once('error', reject);
            child.once('close', resolve);
        });

        return {
            code,
            stderr: await stderr,
            stdout: await stdout
        };
    }

    return { runBinary, binaryPath, consumerFolder };
});
const { table } = consumerFacade;

import { readProcessEnvironment } from '../../run/node-host-readers.ts';

type CliResult = {
    readonly code: number | null;
    readonly stderr: string;
    readonly stdout: string;
};

const configScript = `
import { defineConfig } from '@overkill-dev/test/config';
export const config = defineConfig({
    profiles: {
        integration: {
            testFamily: 'integration',
            timeouts: { collectionMilliseconds: 30000 },
            execution: { processModel: 'supervised-process', scheduling: 'serial' },
            files: { include: ['*.test.mjs'] }
        },
        microtest: {
            testFamily: 'microtest',
            timeouts: { collectionMilliseconds: 30000 },
            execution: { processModel: 'supervised-process', scheduling: 'serial' },
            files: { include: ['*.test.mjs'] }
        },
        observed: {
            testFamily: 'microtest',
            timeouts: { collectionMilliseconds: 30000 },
            execution: { processModel: 'in-process', scheduling: 'serial' },
            files: { include: ['*.test.mjs'] }
        }
    }
});
`;
const filesystemScript = `
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from '@overkill-dev/test';
export const testNode = test('writes and reads a file', async function (scope) {
    try {
        await writeFile('filesystem-output.txt', 'ok');
    } catch (error) {
        scope.assert.equal(error.code, 'ERR_ACCESS_DENIED');
        scope.assert.equal(error.permission, 'FileSystemWrite');
        return scope.assert.collect();
    }
    const folder = await mkdtemp(path.join(process.cwd(), 'overkill-cli-permissions-'));
    try {
        const file = path.join(folder, 'example.txt');
        await writeFile(file, 'ok');
        scope.assert.equal(await readFile(file, 'utf8'), 'ok');
    } finally {
        await rm(folder, { recursive: true, force: true });
    }
    return scope.assert.collect();
});
`;
const subprocessScript = `
import { spawnSync } from 'node:child_process';
import { test } from '@overkill-dev/test';
export const testNode = test('spawns a subprocess', function (scope) {
    let child;
    try {
        child = spawnSync(process.execPath, [
            '-e',
            'require("node:fs").writeFileSync("subprocess-output.txt", "ok"); process.stdout.write("child")'
        ], { encoding: 'utf8' });
    } catch (error) {
        scope.assert.equal(error.code, 'ERR_ACCESS_DENIED');
        scope.assert.equal(error.permission, 'ChildProcess');
        return scope.assert.collect();
    }
    scope.assert.equal(child.status, 0);
    scope.assert.equal(child.stdout, 'child');
    return scope.assert.collect();
});
`;
const pureScript = `
import { test } from '@overkill-dev/test';
export const testNode = test('asserts without runtime effects', function (scope) {
    scope.assert.equal(1 + 1, 2);
    return scope.assert.collect();
});
`;

export const testNode = suite('shipped CLI permission policies', [
    table({
        title: 'pure microtests pass through the executable shebang',
        cases: [ 'microtest', 'observed' ],
        caseTitle(profile) {
            return profile;
        },
        async test(scope) {
            const { runBinary } = scope.resources.consumer;

            const profile = scope.parameters;

            const result = await runBinary(profile, 'pure.test.mjs');
            scope.assert.equal(result.code, 0);
            scope.assert.includes(result.stdout, '1 discovered, 1 planned, 1 executed');
            scope.assert.equal(result.stderr, '');
            return scope.assert.collect();
        }
    }),
    table({
        title: 'enforces permissions through the executable shebang',
        cases: [ 'integration', 'microtest', 'observed' ].flatMap(function profileTests(profile) {
            return [
                { file: 'filesystem.test.mjs', permission: 'FileSystemWrite' },
                { file: 'subprocess.test.mjs', permission: 'ChildProcess' }
            ]
                .map(function operationTest({ file, permission }) {
                    return { profile, file, permission };
                });
        }),
        caseTitle({ profile, permission }) {
            return [ profile, permission ].map(String).join(', ');
        },
        async test(scope) {
            const { binaryPath, runBinary, consumerFolder } = scope.resources.consumer;

            const { profile, file, permission } = scope.parameters;

            const binarySource = await readFile(binaryPath, 'utf8');
            scope.assert.equal(
                binarySource.split('\n', 1)[0],
                '#!/usr/bin/env -S node --permission-audit --allow-inspector --disable-warning=PERM0004'
            );

            const outputFile = file.replace('.test.mjs', '-output.txt');
            const result = await runBinary(profile, file);

            scope.assert.equal(result.code, profile === 'integration' ? 0 : 2);
            scope.assert.includes(result.stdout, '1 discovered, 1 planned, 1 executed');
            if (profile === 'integration') {
                scope.assert.false(result.stdout.includes('Runner error:'));
            } else {
                scope.assert.includes(result.stdout, `Permission denied: ${permission}`);
                if (profile === 'observed' && permission === 'FileSystemWrite') {
                    scope.assert.includes(result.stdout, 'Permission denied: FileSystemRead');
                }
            }
            scope.assert.equal(result.stderr, '');

            const consumerFiles = await readdir(consumerFolder);
            scope.assert.equal(consumerFiles.includes(outputFile), profile !== 'microtest');

            return scope.assert.collect();
        }
    })
]);
