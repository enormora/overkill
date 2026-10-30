import { createInterface } from 'node:readline/promises';
import { RunResolutionError } from './run-errors.ts';

async function askClear(): Promise<boolean> {
    const terminal = createInterface({ input: process.stdin, output: process.stderr });
    try {
        const closed = new Promise<string>(function (resolve) {
            terminal.once('close', function () {
                resolve('');
            });
        });
        const answer = await Promise.race([ terminal.question('Delete run history? [y/N] '), closed ]);
        return answer.toLowerCase() === 'y';
    } catch (error: unknown) {
        if (error instanceof Error && Reflect.get(error, 'code') === 'ERR_USE_AFTER_CLOSE') {
            return false;
        }
        throw error;
    } finally {
        terminal.close();
    }
}
export async function confirmHistoryClear(yes: boolean): Promise<boolean> {
    if (yes) {
        return true;
    }
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
        throw new RunResolutionError(
            'History clear requires --yes outside a terminal.',
            undefined,
            'unsupported-request'
        );
    }
    return await askClear();
}
