import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';

type CommandOptions = { readonly cwd: string; };
type CommandOutput = { readonly stdout: string; readonly stderr: string; readonly code: number; };
async function execute(command: string, args: readonly string[], options: CommandOptions): Promise<CommandOutput> {
    return new Promise(function (resolve, reject) {
        execFile(command, args, options, function (error, stdout, stderr) {
            const code: unknown = error === null ? 0 : Reflect.get(error, 'code');
            if (typeof code !== 'number') {
                reject(error ?? new Error('Command failed without an exit code.'));
                return;
            }
            resolve({ code, stdout, stderr });
        });
    });
}
const binary = fileURLToPath(new URL('../packages/test/overkill.entry-point.ts', import.meta.url));
async function inProject(operation: (cwd: string) => Promise<void>): Promise<void> {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'overkill-history-command-'));
    try {
        await operation(cwd);
    } finally {
        await rm(cwd, { recursive: true, force: true });
    }
}
export const testNode = suite('history CLI', [
    test(
        'binary dispatches compact, list, dry-run and confirmed clear without test profiles',
        async function (scope: TestScope) {
            await inProject(async function runCommands(cwd) {
                const compact = await execute(process.execPath, [ binary, 'history', 'compact' ], { cwd });
                scope.assert.includes(compact.stdout, 'Compacted 0 retained runs.');
                const list = await execute(process.execPath, [ binary, 'history', 'list' ], { cwd });
                scope.assert.includes(list.stdout, 'REPLAY');
                const prune = await execute(process.execPath, [ binary, 'history', 'prune', '--dry-run' ], { cwd });
                scope.assert.includes(prune.stdout, 'Would remove');
                const clear = await execute(process.execPath, [ binary, 'history', 'clear', '--yes' ], { cwd });
                scope.assert.includes(clear.stdout, 'History cleared.');
            });
            return scope.assert.collect();
        }
    ),
    test('noninteractive clear and unsupported flags fail as argument errors', async function (scope: TestScope) {
        await inProject(async function rejectCommands(cwd) {
            const clear = await execute(process.execPath, [ binary, 'history', 'clear' ], { cwd });
            scope.assert.equal(clear.code, 3);
            const invalid = await execute(process.execPath, [ binary, 'history', 'list', '--yes' ], { cwd });
            scope.assert.equal(invalid.code, 3);
        });
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);
