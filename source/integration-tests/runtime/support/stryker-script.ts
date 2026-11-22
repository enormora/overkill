import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

async function executeNode(args: readonly string[], cwd: string): Promise<string> {
    return await new Promise<string>(function receiveScriptOutput(resolve, reject) {
        execFile(
            process.execPath,
            [ '--disable-warning=PERM0004', ...args ],
            { cwd, timeout: 120_000 },
            function completeScript(error, stdout, stderr) {
                if (error === null) {
                    resolve(stdout);
                } else {
                    reject(new Error([ stdout, stderr ].join('\n'), { cause: error }));
                }
            }
        );
    });
}

export async function executeMutationScript(
    script: string,
    scriptArguments: readonly string[],
    cwd: string
): Promise<string> {
    return await executeNode([ '--input-type=module', '--eval', script, ...scriptArguments ], cwd);
}

export async function executeMutationModule(module: URL, args: readonly string[], cwd: string): Promise<string> {
    return await executeNode([ fileURLToPath(module), ...args ], cwd);
}
