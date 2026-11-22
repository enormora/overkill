import { spawn } from 'node:child_process';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { text } from 'node:stream/consumers';
import { suite, type TestScope } from '@overkill-dev/test';
import { consumerEnvironment } from './support/consumer-environment.ts';
import { packageConsumer } from './support/package-consumer.ts';

type CliResult = {
    readonly code: number | null;
    readonly stderr: string;
    readonly stdout: string;
};

const configScript = `
import { defineConfig } from '@overkill-dev/test/config';
export const config = defineConfig({
    profiles: {
        microtest: {
            testFamily: 'microtest',
            timeouts: { collectionMilliseconds: 30000 },
            execution: { processModel: 'supervised-process', scheduling: 'serial' },
            files: { include: ['*.test.mjs'] }
        }
    }
});
`;
const filesystemScript = `
import { writeFile } from 'node:fs/promises';
import { test } from '@overkill-dev/test';

export const testNode = test('denies a filesystem write', async function (scope) {
    await writeFile('filesystem-output.txt', 'unexpected write');
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

const { test } = packageConsumer('Shipped CLI permissions', function consumerFixture(directory) {
    const binary = join(directory, 'node_modules/@overkill-dev/test/packages/test/overkill.entry-point.js');
    async function runBinary(file: string, source: string): Promise<CliResult> {
        await Promise.all([
            writeFile(join(directory, 'package.json'), '{"type":"module"}'),
            writeFile(join(directory, 'overkill.config.js'), configScript),
            writeFile(join(directory, file), source)
        ]);
        const child = spawn(binary, [ 'run', '--profile', 'microtest', file ], {
            cwd: directory,
            env: consumerEnvironment(directory),
            stdio: [ 'ignore', 'pipe', 'pipe' ]
        });
        const stdout = text(child.stdout);
        const stderr = text(child.stderr);
        const code = await new Promise<number | null>(function waitForExit(resolve, reject) {
            child.once('error', reject);
            child.once('close', resolve);
        });

        return { code, stderr: await stderr, stdout: await stdout };
    }

    return { binary, directory, runBinary };
});

function assertExecuted(assert: TestScope['assert'], result: CliResult): void {
    assert.match(result.stdout, /^ {2}1 executed · [\d.]+ (?:µs|ms|s) execution · /mu);
    assert.equal(result.stderr, '');
}

export const testNode = suite('Shipped CLI permissions', [
    test('runs a microtest through the executable shebang', async function (scope) {
        const { binary, runBinary } = scope.resources.consumer;
        const source = await readFile(binary, 'utf8');
        const result = await runBinary('pure.test.mjs', pureScript);

        scope.assert.equal(
            source.split('\n', 1)[0],
            '#!/usr/bin/env -S node --permission-audit --allow-inspector --disable-warning=PERM0004'
        );
        scope.assert.equal(result.code, 0);
        assertExecuted(scope.assert, result);
        return scope.assert.collect();
    }),
    test('enforces filesystem permissions through the executable shebang', async function (scope) {
        const { directory, runBinary } = scope.resources.consumer;
        const result = await runBinary('filesystem.test.mjs', filesystemScript);

        scope.assert.equal(result.code, 2);
        scope.assert.includes(result.stdout, 'Permission denied: FileSystemWrite');
        scope.assert.false((await readdir(directory)).includes('filesystem-output.txt'));
        assertExecuted(scope.assert, result);
        return scope.assert.collect();
    })
]);
