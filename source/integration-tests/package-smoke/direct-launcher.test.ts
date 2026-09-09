import { pathToFileURL } from 'node:url';
import {
    createPlainOutputRenderer,
    createRoot,
    createTestPlan,
    execute,
    type DefinedReporter,
    type RunResult,
    type TestNode
} from '../../packages/engine/engine.entry-point.ts';

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

export async function runIfMain(
    meta: Readonly<ImportMeta>,
    testNode: TestNode,
    reporters: readonly DefinedReporter[]
): Promise<void> {
    if (!isMainModule(meta)) {
        return;
    }

    const startedAt = new Date(0);
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
