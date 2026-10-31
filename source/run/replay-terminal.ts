import { createInterface } from 'node:readline/promises';
import { readProcessEnvironment } from './node-host-readers.ts';
import type { HistoryRunSummary } from './history-types.ts';

function runLabel(run: HistoryRunSummary): string {
    return [
        run.id,
        run.startedAt,
        run.profile,
        run.testFamily,
        run.status,
        run.durationMicroseconds === null ? '' : `${run.durationMicroseconds} us`
    ]
        .join(' | ')
        .replaceAll(/\p{Control}/gu, ' ');
}

function numberedSelection(answer: string, runs: readonly HistoryRunSummary[]): string | null | undefined {
    const value = answer.trim();
    if (value === '' || value.toLowerCase() === 'q') {
        return null;
    }
    const index = /^\d+$/u.test(value) ? Number(value) - 1 : -1;
    return runs[index]?.id;
}

async function readNumberedRun(
    terminal: ReturnType<typeof createInterface>,
    runs: readonly HistoryRunSummary[]
): Promise<string | null> {
    for (const [ index, run ] of runs.entries()) {
        process.stderr.write(`${index + 1}. ${runLabel(run)}\n`);
    }
    process.stderr.write('Replay number (blank to cancel): ');
    for await (const answer of terminal) {
        const selected = numberedSelection(answer, runs);
        if (selected !== undefined) {
            return selected;
        }
        process.stderr.write('Enter a listed number, or leave blank to cancel.\n');
        process.stderr.write('Replay number (blank to cancel): ');
    }
    return null;
}

async function numberedRun(runs: readonly HistoryRunSummary[]): Promise<string | null> {
    const terminal = createInterface({ input: process.stdin, output: process.stderr, terminal: false });
    function cancel(): void {
        terminal.close();
    }
    process.once('SIGINT', cancel);
    try {
        return await readNumberedRun(terminal, runs);
    } finally {
        process.off('SIGINT', cancel);
        terminal.close();
    }
}

type TerminalKey = { readonly ctrl: boolean; readonly name: string; };
function observeInputEnd(cancel: () => void, keypress: (text: string, key: TerminalKey) => void): () => void {
    process.stdin.once('end', cancel);
    process.stdin.once('close', cancel);
    process.stdin.on('keypress', keypress);
    return function dispose() {
        process.stdin.off('end', cancel);
        process.stdin.off('close', cancel);
        process.stdin.off('keypress', keypress);
    };
}

async function arrowRun(runs: readonly HistoryRunSummary[]): Promise<string | null> {
    const { default: select } = await import('@inquirer/select');
    const controller = new AbortController();
    function cancel(): void {
        controller.abort();
    }
    const dispose = observeInputEnd(cancel, function cancelOnEnd(_text, key) {
        if (key.ctrl && key.name === 'd') {
            cancel();
        }
    });
    try {
        return await select<string | null>({
            message: 'Select a run to replay',
            choices: [
                ...runs.map(function choice(run) {
                    return { name: runLabel(run), value: run.id };
                }),
                { name: 'Cancel', value: null }
            ]
        }, { input: process.stdin, output: process.stderr, signal: controller.signal });
    } catch (error: unknown) {
        if (error instanceof Error && [ 'ExitPromptError', 'AbortPromptError' ].includes(error.name)) {
            return null;
        }
        throw error;
    } finally {
        dispose();
    }
}

export async function pickReplayRun(runs: readonly HistoryRunSummary[]): Promise<string | null> {
    return readProcessEnvironment(process).TERM === 'dumb' ? await numberedRun(runs) : await arrowRun(runs);
}
