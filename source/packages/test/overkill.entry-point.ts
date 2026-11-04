#!/usr/bin/env -S node --permission-audit
import type { CommandLineRunner } from '../run/command-line.entry-point.ts';
import { runOverkillCommandLine } from './command-line-runner.ts';

const commandArgumentStartIndex = 2;

await runOverkillCommandLine({
    async writePreview(lines) {
        for (const line of lines) {
            await new Promise<void>(function deliver(resolve, reject) {
                process.stdout.write(`${line}\n`, function delivered(error) {
                    if (error === null || error === undefined) {
                        resolve();
                    } else {
                        reject(error);
                    }
                });
            });
        }
    },
    arguments: process.argv.slice(commandArgumentStartIndex),
    applyExitCode(exitCode) {
        process.exitCode = exitCode;
    },
    cwd: process.cwd(),
    async loadRunner(): Promise<CommandLineRunner> {
        const [ defaultEngine, runnerModule ] = await Promise.all([
            import('../engine/engine.entry-point.ts'),
            import('../run/command-line.entry-point.ts')
        ]);

        return runnerModule.createNodeCommandLineRunner({ defaultEngine });
    },
    stderr: process.stderr,
    stdout: process.stdout
});
