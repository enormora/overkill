import { execFile } from 'node:child_process';

export async function executeMutationScript(
    script: string,
    scriptArguments: readonly string[],
    cwd: string
): Promise<string> {
    return await new Promise<string>(function receiveScriptOutput(resolve, reject) {
        execFile(
            process.execPath,
            [ '--input-type=module', '--eval', script, ...scriptArguments ],
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
