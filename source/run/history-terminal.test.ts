import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node-pty';
import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { createHistory, normalizeConfig } from '../packages/run/run.entry-point.ts';

const binary = fileURLToPath(new URL('../packages/test/overkill.entry-point.ts', import.meta.url));
type TerminalOutput = { readonly code: number; readonly output: string; };
async function clearInTerminal(root: string, answer: string): Promise<TerminalOutput> {
    return new Promise(function (resolve) {
        const child = spawn(process.execPath, [ binary, 'history', 'clear' ], { cwd: root });
        let output = '';
        let answered = false;
        child.onData(function capture(chunk) {
            output += chunk;
            if (!answered && output.includes('Delete run history?')) {
                answered = true;
                child.write(answer);
            }
        });
        child.onExit(function complete(event) {
            resolve({ code: event.exitCode, output });
        });
    });
}
type TerminalProject = { readonly root: string; readonly indexPath: string; readonly source: string; };
async function inProject(operation: (project: TerminalProject) => Promise<void>): Promise<void> {
    const root = await mkdtemp(path.join(os.tmpdir(), 'overkill-history-terminal-'));
    const history = createHistory({ projectRoot: root, config: normalizeConfig({}) });
    try {
        await history.compact();
        const indexPath = path.join(root, '.overkill/history/index.json');
        const source = await readFile(indexPath, 'utf8');
        await operation({ root, indexPath, source });
    } finally {
        await rm(root, { recursive: true, force: true });
    }
}
export const testNode = suite('history terminal confirmation', [
    test('accepting confirmation clears persisted history', async function (scope: TestScope) {
        await inProject(async function accepted({ root, indexPath }) {
            const result = await clearInTerminal(root, 'Y\r');
            scope.assert.equal(result.code, 0);
            scope.assert.includes(result.output, 'History cleared.');
            await scope.assert.rejects(async function () {
                return readFile(indexPath);
            }, { code: 'ENOENT' });
        });
        return scope.assert.collect();
    }),
    test('declining confirmation preserves persisted history', async function (scope: TestScope) {
        await inProject(async function declined({ root, indexPath, source }) {
            const result = await clearInTerminal(root, 'n\r');
            scope.assert.equal(result.code, 0);
            scope.assert.equal(result.output.includes('History cleared.'), false);
            scope.assert.equal(await readFile(indexPath, 'utf8'), source);
        });
        return scope.assert.collect();
    }),
    test('terminal EOF cancels confirmation and preserves persisted history', async function (scope: TestScope) {
        await inProject(async function ended({ root, indexPath, source }) {
            const result = await clearInTerminal(root, '\u{4}');
            scope.assert.equal(result.code, 0);
            scope.assert.equal(result.output.includes('History cleared.'), false);
            scope.assert.equal(await readFile(indexPath, 'utf8'), source);
        });
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);
