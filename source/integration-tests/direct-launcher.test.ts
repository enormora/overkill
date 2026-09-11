import { pathToFileURL } from 'node:url';
import { createDeterministicWallClock } from '@enormora/wall-clock';
import { createExecute } from '../engine/execution.ts';
import { createReporterDispatcher } from '../engine/reporter-dispatcher.ts';
import {
    createPlainOutputRenderer,
    createRoot,
    createTestPlan,
    type DefinedReporter,
    type RunResult,
    type TestNode
} from '../packages/engine/engine.entry-point.ts';

const successExitCodes = new Set<number | string | null | undefined>([ undefined, null, 0, '0' ]);

function isMainModule(meta: Readonly<ImportMeta>): boolean {
    const entrypoint = process.argv[1];

    return entrypoint !== undefined && meta.url === pathToFileURL(entrypoint).href;
}

function hasFailure(result: RunResult): boolean {
    return result.summary.failed > 0 || result.runnerErrors.length > 0;
}

function setFailureExitCode(result: RunResult): void {
    if (hasFailure(result) && successExitCodes.has(process.exitCode)) {
        process.exitCode = 1;
    }
}

function writeStdoutLine(line: string): void {
    process.stdout.write(`${line}\n`);
}

function writeStderrLine(line: string): void {
    process.stderr.write(`${line}\n`);
}

function readNoActiveResourceTypes(): readonly string[] {
    return [];
}

export async function runIfMain(
    meta: Readonly<ImportMeta>,
    testNode: TestNode,
    reporters: readonly DefinedReporter[]
): Promise<void> {
    if (!isMainModule(meta)) {
        return;
    }

    const startedAt = new Date(0);
    const wallClock = createDeterministicWallClock();
    const execute = createExecute({
        asyncLeakDiagnostics: 'disabled',
        readActiveResourceTypes: readNoActiveResourceTypes,
        reporterDispatcher: createReporterDispatcher({
            stderr: { writeLine: writeStderrLine },
            stdout: { writeLine: writeStdoutLine },
            wallClock
        }),
        wallClock
    });
    const result = await execute(
        createTestPlan(createRoot({
            children: [ testNode ],
            annotations: {},
            controls: {},
            title: meta.url
        })),
        {
            execution: { mode: 'serial-in-process' },
            outputRenderer: createPlainOutputRenderer(),
            reporters,
            runFacts: { seed: 1 },
            startedAt: startedAt.toISOString()
        }
    );

    setFailureExitCode(result);
}
