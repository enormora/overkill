import { execFile } from 'node:child_process';
import { deserialize, serialize } from 'node:v8';
import type { ReplayRunCommand, RunCommand, RunnerResult } from '../../../packages/run/run.entry-point.ts';

const runnerUrl = new URL('../../../packages/run/run.entry-point.ts', import.meta.url);
const engineUrl = new URL('../../../packages/engine/engine.entry-point.ts', import.meta.url);
const script = `
import { deserialize, serialize } from 'node:v8';
import { orchestrator } from ${JSON.stringify(runnerUrl.href)};
import { createPlainOutputRenderer } from ${JSON.stringify(engineUrl.href)};
const action = deserialize(Buffer.from(process.argv[1], 'base64'));
const command = {
    ...action.command,
    config: { ...action.command.config, outputRenderer: createPlainOutputRenderer() }
};
const result = action.kind === 'run'
    ? await orchestrator.run(command)
    : await orchestrator.replay(command);
process.stdout.write(serialize(result).toString('base64'));
`;

type CoverageAction = {
    readonly kind: 'replay';
    readonly command: ReplayRunCommand;
} | {
    readonly kind: 'run';
    readonly command: RunCommand;
};

async function executeCoverage(action: CoverageAction): Promise<RunnerResult> {
    const input = serialize({
        ...action,
        command: { ...action.command, config: { ...action.command.config, outputRenderer: null } }
    })
        .toString('base64');
    const stdout = await new Promise<string>(function launchSourceCoverage(resolve, reject) {
        execFile(
            process.execPath,
            [
                '--allow-inspector',
                '--disable-warning=PERM0004',
                '--input-type=module',
                '--eval',
                script,
                input
            ],
            { cwd: action.command.cwd, timeout: 120_000, maxBuffer: 16 * 1024 * 1024 },
            function captureResult(error, output, diagnostics) {
                if (error === null) {
                    resolve(output);
                } else {
                    reject(new Error(diagnostics, { cause: error }));
                }
            }
        );
    });
    return deserialize(Buffer.from(stdout, 'base64')) as RunnerResult;
}

export const coverageSubject = {
    async run(command: RunCommand): Promise<RunnerResult> {
        return await executeCoverage({ kind: 'run', command });
    },
    async replay(command: ReplayRunCommand): Promise<RunnerResult> {
        return await executeCoverage({ kind: 'replay', command });
    }
};
