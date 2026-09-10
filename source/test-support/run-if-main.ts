import {
    createPlainOutputRenderer,
    createRoot,
    createTestPlan,
    execute,
    type DefinedOutputRenderer,
    type DefinedReporter,
    type RunResult,
    type TestAnnotationsInput,
    type TestControlsInput,
    type TestNode,
    type TestPlan
} from '../packages/engine/engine.entry-point.ts';
import { createLineReporter } from '../packages/reporter-line/reporter-line.entry-point.ts';

type TestSupportRunIfMainRootOptions = {
    readonly annotations?: TestAnnotationsInput;
    readonly controls?: TestControlsInput;
    readonly title: string;
};

export type TestSupportRunIfMainOptions = {
    readonly outputRenderer?: DefinedOutputRenderer;
    readonly reporters?: readonly DefinedReporter[];
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

function selectedReporters(options: TestSupportRunIfMainOptions | undefined): readonly DefinedReporter[] {
    return options?.reporters ?? [ createLineReporter() ];
}

function selectedOutputRenderer(options: TestSupportRunIfMainOptions | undefined): DefinedOutputRenderer {
    return options?.outputRenderer ?? createPlainOutputRenderer();
}

function selectedRoot(
    meta: Readonly<ImportMeta>,
    options: TestSupportRunIfMainOptions | undefined
): TestSupportRunIfMainRootOptions {
    return options?.root ?? {
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
        annotations: root.annotations ?? {},
        children: [ testNode ],
        controls: root.controls ?? {},
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
