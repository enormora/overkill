import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { table, suite } from '@overkill-dev/test';

import { z } from 'zod/v4';
import type { Config } from '../../config/config.ts';

const captureModes = [ 'buffered', 'live', 'authored' ] as const;
const executions = [
    { processModel: 'worker-pool', workerLifecycle: 'reuse' },
    { processModel: 'worker-pool', workerLifecycle: 'fresh-worker-per-unit' },
    { processModel: 'supervised-process' }
] as const;

async function runNode(args: readonly string[]): Promise<{ readonly stdout: string; readonly stderr: string; }> {
    return new Promise(function runProbe(resolve, reject) {
        execFile(
            process.execPath,
            [ '--disable-warning=PERM0004', ...args ],
            {
                env: {
                    ...z.object({}).catchall(z.string()).parse(Reflect.get(process, 'env')),
                    NODE_OPTIONS: '--disable-warning=PERM0004'
                }
            },
            function probeCompleted(error, stdout, stderr) {
                if (error !== null) {
                    reject(new Error(`${error.message}\n${stdout}\n${stderr}`, { cause: error }));
                    return;
                }
                resolve({ stdout, stderr });
            }
        );
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
                files: { include: [ `source/integration-tests/runtime/fixtures/${fixture}.test.ts` ] }
            }
        }
    };
}

type CapturedRunOutputEvidence = {
    readonly runOutputProbeResult: { readonly stdout: string; readonly stderr: string; };
    readonly capture: 'authored' | 'buffered' | 'live';
};

const capturedRunOutput = defineCompositeAssertion({
    name: 'captured run output',
    assert(
        check,
        { runOutputProbeResult, capture }: CapturedRunOutputEvidence
    ) {
        return check.group([
            check.match(runOutputProbeResult.stdout, /Run passed · 1 passed · [\d.]+ (?:µs|ms|s)$/mu),
            check.match(runOutputProbeResult.stdout, /^ {2}1 executed · [\d.]+ (?:µs|ms|s) execution · /mu),
            check.equal(runOutputProbeResult.stdout.includes('collection stdout'), capture === 'live'),
            check.equal(runOutputProbeResult.stdout.includes('case stdout'), capture !== 'buffered'),
            check.equal(runOutputProbeResult.stderr, capture === 'buffered' ? '' : 'case stderr\n')
        ]);
    }
});

export const testNode = suite('Runner output capture', [
    table({
        title: 'forwards output according to capture mode and execution boundary',
        cases: executions.flatMap(function (execution) {
            return captureModes.map(function (capture) {
                return { execution, capture };
            });
        }),
        caseTitle({ execution, capture }) {
            return `${JSON.stringify(execution)}, ${capture}`;
        },
        async test(scope) {
            const { execution, capture } = scope.parameters;

            const runOutputProbeDirectory = await mkdtemp(join(tmpdir(), 'overkill-output-'));
            scope.cleanup(async function removeProbe() {
                await rm(runOutputProbeDirectory, { recursive: true, force: true });
            });
            const runOutputProbeConfigPath = join(runOutputProbeDirectory, 'overkill.config.mjs');
            await writeFile(
                runOutputProbeConfigPath,
                `export const config = ${JSON.stringify(probeConfig(runOutputProbeDirectory, execution, capture))};\n`
            );
            const runOutputProbeResult = await runNode([
                'source/packages/test/overkill.entry-point.ts',
                'run',
                '--config',
                runOutputProbeConfigPath,
                '--profile',
                'probe',
                ...capture === 'live' ? [ '--no-capture' ] : []
            ]);
            scope.assert(capturedRunOutput, { runOutputProbeResult, capture });

            return scope.assert.collect();
        }
    })
]);
