import * as timers from 'node:timers';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node-pty';
import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { readProcessEnvironment } from './node-host-readers.ts';

const picker = fileURLToPath(new URL('./replay-terminal.ts', import.meta.url));
const script = `
    const { pickReplayRun } = await import(process.argv[1]);
    const result = await pickReplayRun([
        { id: 'newest', startedAt: '2026-10-30', profile: 'unit',
          testFamily: 'microtest', status: 'passed', durationMicroseconds: 12 },
        { id: 'older', startedAt: '2026-10-29', profile: 'unit',
          testFamily: 'microtest', status: 'interrupted', durationMicroseconds: null }
    ]);
    process.stdout.write('RESULT:' + JSON.stringify(result));
`;
type TerminalResult = { readonly code: number; readonly output: string; };
async function pickInTerminal(term: string, answer: string): Promise<TerminalResult> {
    return new Promise(function (resolve, reject) {
        const child = spawn(process.execPath, [ '--input-type=module', '-e', script, picker ], {
            cwd: process.cwd(),
            env: { ...readProcessEnvironment(process), TERM: term, NO_COLOR: '1' }
        });
        let output = '';
        let answered = false;
        const deadline = timers.setTimeout(function timeout() {
            child.kill();
            reject(new Error('Replay picker did not exit.'));
        }, 10_000);
        child.onData(function capture(chunk) {
            output += chunk;
            const prompt = term === 'dumb' ? 'Replay number' : 'Select a run to replay';
            if (!answered && output.includes(prompt)) {
                answered = true;
                child.write(answer);
            }
        });
        child.onExit(function complete(event) {
            timers.clearTimeout(deadline);
            resolve({ code: event.exitCode, output });
        });
    });
}
export const testNode = suite('replay terminal', [
    test('arrow navigation selects a different record', async function (scope: TestScope) {
        const result = await pickInTerminal('xterm-256color', '\u{1B}[B\r');
        scope.assert.equal(result.code, 0);
        scope.assert.includes(result.output, 'RESULT:"older"');
        return scope.assert.collect();
    }),
    test('Cancel, Ctrl+C and EOF leave without selection', async function (scope: TestScope) {
        for (const answer of [ '\u{1B}[B\u{1B}[B\r', '\u{3}', '\u{4}' ]) {
            const result = await pickInTerminal('xterm-256color', answer);
            scope.assert.equal(result.code, 0);
            scope.assert.includes(result.output, 'RESULT:null');
        }
        return scope.assert.collect();
    }),
    test('plain terminal retries invalid input and selects without ANSI', async function (scope: TestScope) {
        const result = await pickInTerminal('dumb', 'invalid\r2\r');
        scope.assert.equal(result.code, 0);
        scope.assert.includes(result.output, 'Enter a listed number');
        scope.assert.includes(result.output, 'RESULT:"older"');
        scope.assert.equal(result.output.includes('\u{1B}'), false);
        return scope.assert.collect();
    }),
    test('plain terminal cancellation closes input', async function (scope: TestScope) {
        for (const answer of [ '\r', 'q\r', '\u{3}', '\u{4}' ]) {
            const result = await pickInTerminal('dumb', answer);
            scope.assert.equal(result.code, 0);
            scope.assert.includes(result.output, 'RESULT:null');
        }
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);
