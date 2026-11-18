import { processOutput, type ProcessOutput } from '../bench/process-output.ts';
import type { ProcessChild } from '../bench/process-child.ts';

type ProcessCompletionFixture = {
    readonly child: ProcessChild;
    readonly output: ProcessOutput;
    readonly calls: readonly string[];
};
const maximumOutputBytes = 100;
export function completionProcess(code: number | null, signal: string | null): ProcessCompletionFixture {
    const output = processOutput('pipes', maximumOutputBytes);
    const calls: string[] = [];
    const child: ProcessChild = {
        pid: 42,
        exit: Promise.resolve({ code, signal, time: 1234n }),
        closed: Promise.resolve(),
        async write(text) {
            calls.push(`write:${text}`);
            output.append('stdout', Buffer.from('answer'));
        },
        closeInput() {
            calls.push('close');
        },
        resize(columns, rows) {
            calls.push(`resize:${columns}:${rows}`);
        }
    };
    return { output, child, calls };
}
