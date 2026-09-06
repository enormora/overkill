import { createLineReporter } from '@overkill-dev/reporter-line';
import {
    createPlainOutputRenderer,
    createRoot,
    createTestPlan,
    execute,
    type Metadata,
    type OutputRenderer,
    type Reporter,
    type RunResult,
    type TestNode,
    type TestPlan
} from '../packages/engine/engine.entry-point.ts';

type TestSupportRunIfMainRootOptions = {
    readonly metadata: Metadata;
    readonly title: string;
};

export type TestSupportRunIfMainOptions = {
    readonly outputRenderer?: OutputRenderer;
    readonly reporters?: readonly Reporter[];
    readonly root?: TestSupportRunIfMainRootOptions;
};

const successfulExitCodes = new Set<number | string | null | undefined>([
    undefined,
    null,
    0,
    '0'
]);

function shouldSetFailureExitCode(exitCode: number | string | null | undefined): boolean {
    return successfulExitCodes.has(exitCode);
}

function hasFailure(result: RunResult): boolean {
    return result.summary.failed > 0 || result.runnerErrors.length > 0;
}

function selectedReporters(options: TestSupportRunIfMainOptions | undefined): readonly Reporter[] {
    return options?.reporters ?? [ createLineReporter() ];
}

function selectedOutputRenderer(options: TestSupportRunIfMainOptions | undefined): OutputRenderer {
    return options?.outputRenderer ?? createPlainOutputRenderer();
}

function selectedRoot(
    meta: Readonly<ImportMeta>,
    options: TestSupportRunIfMainOptions | undefined
): TestSupportRunIfMainRootOptions {
    return options?.root ?? {
        metadata: {},
        title: meta.url
    };
}

function startedAt(): string {
    const start = new Date(0);

    return start.toISOString();
}

function testPlan(
    meta: Readonly<ImportMeta>,
    testNode: TestNode,
    options: TestSupportRunIfMainOptions | undefined
): TestPlan {
    const root = selectedRoot(meta, options);

    return createTestPlan(createRoot({
        children: [ testNode ],
        metadata: root.metadata,
        title: root.title
    }));
}

export async function runIfMain(
    meta: Readonly<ImportMeta>,
    testNode: TestNode,
    options?: TestSupportRunIfMainOptions
): Promise<void> {
    if (!meta.main) {
        return;
    }

    const result = await execute(testPlan(meta, testNode, options), {
        execution: { mode: 'serial-in-process' },
        outputRenderer: selectedOutputRenderer(options),
        reporters: selectedReporters(options),
        runFacts: {
            nodeVersion: process.versions.node
        },
        startedAt: startedAt()
    });

    if (hasFailure(result) && shouldSetFailureExitCode(process.exitCode)) {
        process.exitCode = 1;
    }
}
