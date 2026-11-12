import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runIfMain } from '#test-runner';
import { suite, test } from '../../packages/test/test.entry-point.ts';
import { readProcessEnvironment } from '../../run/node-host-readers.ts';

const fixturePath = fileURLToPath(new URL('./fixtures/permission-audit.test.ts', import.meta.url));

type AuditProbeOutput = { readonly stdout: string; readonly stderr: string; };

async function runAuditProbe(mode: 'argv' | 'environment'): Promise<AuditProbeOutput> {
    return new Promise(function captureAuditProbe(resolve, reject) {
        execFile(process.execPath, [
            ...mode === 'argv' ? [ '--permission-audit' ] : [],
            fixturePath
        ], {
            cwd: process.cwd(),
            encoding: 'utf8',
            timeout: 30_000,
            env: {
                ...readProcessEnvironment(process),
                NODE_OPTIONS: mode === 'environment' ? '--permission-audit' : ''
            }
        }, function finishAuditProbe(error, stdout, stderr) {
            if (error !== null) {
                reject(new Error([ stdout, stderr ].join('\n'), { cause: error }));
                return;
            }
            resolve({ stdout, stderr });
        });
    });
}

export const testNode = suite(
    'native permission audit',
    ([ 'argv', 'environment' ] as const).map(function auditMode(mode) {
        return test(
            `${mode} audit permits unrestricted reads and retains repeated restricted read diagnostics`,
            async function (scope) {
                const result = await runAuditProbe(mode);
                const observed: unknown = JSON.parse(result.stdout);
                scope.assert.equal(result.stderr, '');
                scope.assert.deepEqual(observed, {
                    unrestricted: { loadErrors: [], readable: true, attempts: [ [], [] ], runErrors: [] },
                    restricted: {
                        loadErrors: [],
                        readable: true,
                        attempts: [ [ 'FileSystemRead:fs-read:body' ], [ 'FileSystemRead:fs-read:body' ] ],
                        runErrors: []
                    }
                });
                return scope.assert.collect();
            }
        );
    })
);

await runIfMain(import.meta, testNode);
