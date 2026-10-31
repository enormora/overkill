import { execFile } from 'node:child_process';
import { mkdtemp, rm, mkdir, writeFile, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { completedHistoryRecord } from '../test-support/history-record-fixture.ts';

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
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'overkill-history-command-'));
    const cwd = await realpath(temporary);
    try {
        await operation(cwd);
    } finally {
        await rm(cwd, { recursive: true, force: true });
    }
}
async function prepareRuns(cwd: string): Promise<string> {
    const now = new Date();
    const record = { ...completedHistoryRecord('completed'), startedAt: now.toISOString() };
    const runs = path.join(cwd, '.overkill/runs');
    await mkdir(runs, { recursive: true });
    await writeFile(
        path.join(cwd, 'overkill.config.js'),
        'export const config = { history: { detailedRunLimit: 0 } };'
    );
    await writeFile(path.join(runs, 'completed.json'), JSON.stringify(record));
    await writeFile(
        path.join(runs, 'interrupted.json'),
        JSON.stringify({
            ...record,
            id: 'interrupted',
            status: 'interrupted',
            result: null
        })
    );
    return record.startedAt;
}
export const testNode = suite('history CLI', [
    test('replay dispatch rejects nonterminals and forwards explicit ids', async function (scope: TestScope) {
        await inProject(async function replayCommands(cwd) {
            const missing = await execute(process.execPath, [ binary, 'replay' ], { cwd });
            scope.assert.equal(missing.code, 3);
            scope.assert.includes(missing.stderr, 'overkill history list');
            const explicit = await execute(process.execPath, [ binary, 'replay', 'chosen', '--config', 'custom.js' ], {
                cwd
            });
            scope.assert.equal(explicit.code, 3);
            scope.assert.includes(explicit.stderr, 'with 1 arguments is not implemented yet');
            const extra = await execute(process.execPath, [ binary, 'replay', 'a', 'b' ], { cwd });
            scope.assert.equal(extra.code, 3);
            const invalid = await execute(process.execPath, [ binary, 'replay', '--yes' ], { cwd });
            scope.assert.notEqual(invalid.code, 0);
        });
        return scope.assert.collect();
    }),
    test('list renders persisted outcomes and prune reports applied removals', async function (scope: TestScope) {
        await inProject(async function recordedCommands(cwd) {
            const startedAt = await prepareRuns(cwd);
            const compact = await execute(process.execPath, [ binary, 'history', 'compact' ], { cwd });
            scope.assert.equal(compact.code, 0);
            const list = await execute(process.execPath, [ binary, 'history', 'list' ], { cwd });
            scope.assert.includes(list.stdout, `completed\t${startedAt}\tunit\tmicrotest\tpassed\t100\tavailable`);
            scope.assert.includes(
                list.stdout,
                `interrupted\t${startedAt}\tunit\tmicrotest\tinterrupted\t\tavailable-interrupted`
            );
            const prune = await execute(process.execPath, [ binary, 'history', 'prune' ], { cwd });
            scope.assert.equal(prune.code, 0);
            scope.assert.includes(prune.stdout, `Removed ${path.join(cwd, '.overkill/runs/completed.json')}`);
        });
        return scope.assert.collect();
    }),
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
