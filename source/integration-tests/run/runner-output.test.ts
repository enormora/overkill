import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runIfMain } from '#test-runner';
import type { Config } from '../../config/config.ts';
import { suite, test, type TestScope } from '../../packages/test/test.entry-point.ts';
import { createLineReporter } from '../../packages/reporter-line/reporter-line.entry-point.ts';

const captureModes = [ 'buffered', 'live', 'authored' ] as const;
const executions = [
    { processModel: 'worker-pool', workerLifecycle: 'reuse' },
    { processModel: 'worker-pool', workerLifecycle: 'fresh-worker-per-unit' },
    { processModel: 'supervised-process' }
] as const;

async function runNode(args: readonly string[]): Promise<{ readonly stdout: string; readonly stderr: string; }> {
    return new Promise(function runProbe(resolve, reject) {
        execFile(process.execPath, args, function probeCompleted(error, stdout, stderr) {
            if (error !== null) {
                reject(new Error(`${error.message}\n${stdout}\n${stderr}`, { cause: error }));
                return;
            }
            resolve({ stdout, stderr });
        });
    });
}

function probeConfig(
    directory: string,
    execution: typeof executions[number],
    capture: typeof captureModes[number]
): Config {
    const fixture = capture === 'authored' ? 'integration-capture-controls-output' : 'integration-output';
    return {
        runtimeStateDir: join(directory, 'state'),
        profiles: {
            probe: {
                testFamily: 'integration',
                timeouts: { collectionMilliseconds: 30_000, softMilliseconds: 60_000, hardMilliseconds: 65_000 },
                execution,
                files: { include: [ `source/integration-tests/run/fixtures/${fixture}.test.ts` ] }
            }
        }
    };
}

async function runOutputProbe(
    scope: TestScope,
    execution: typeof executions[number],
    capture: typeof captureModes[number]
): Promise<void> {
    const directory = await mkdtemp(join(tmpdir(), 'overkill-output-'));
    scope.cleanup(async function removeProbe() {
        await rm(directory, { recursive: true, force: true });
    });
    const configPath = join(directory, 'overkill.config.mjs');
    await writeFile(
        configPath,
        `export const config = ${JSON.stringify(probeConfig(directory, execution, capture))};\n`
    );
    const result = await runNode([
        'source/packages/test/overkill.entry-point.ts',
        'run',
        '--config',
        configPath,
        '--profile',
        'probe',
        ...capture === 'live' ? [ '--no-capture' ] : []
    ]);
    scope.assert.includes(result.stdout, '1 discovered, 1 planned, 1 executed (1 pass, 0 fail, 0 skip)');
    scope.assert.equal(result.stdout.includes('collection stdout'), capture === 'live');
    scope.assert.equal(result.stdout.includes('case stdout'), capture !== 'buffered');
    scope.assert.equal(result.stderr, capture === 'buffered' ? '' : 'case stderr\n');
}

export const testNode = suite(
    'runner output capture',
    executions.map(function executionTests(execution) {
        return suite(
            JSON.stringify(execution),
            captureModes.map(function captureTest(capture) {
                return test(`forwards ${capture} output`, async function (scope: TestScope) {
                    await runOutputProbe(scope, execution, capture);
                    return scope.assert.collect();
                });
            })
        );
    })
);

await runIfMain(import.meta, testNode, { reporters: [ createLineReporter() ] });
