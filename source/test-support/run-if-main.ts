import { createDeterministicWallClock } from '@enormora/wall-clock';
import { createExecute } from '../engine/execution.ts';
import { createReporterDispatcher } from '../engine/reporter-dispatcher.ts';
import {
    createPlainOutputRenderer,
    createRoot,
    createTestPlan,
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

type TestSupportRunIfMainOptions = {
    readonly outputRenderer?: DefinedOutputRenderer;
    readonly reporters?: readonly DefinedReporter[];
    readonly root?: TestSupportRunIfMainRootOptions;
};

type TestSupportRunIfMainDependencies = {
    readonly nodeVersion: string;
    readonly readExitCode: () => number | string | null | undefined;
    readonly setExitCode: (exitCode: number) => void;
};

export type TestSupportRunIfMain = (
    meta: Readonly<ImportMeta>,
    testNode: TestNode,
    options?: TestSupportRunIfMainOptions
) => Promise<void>;

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

function writeStdoutLine(line: string): void {
    process.stdout.write(`${line}\n`);
}

function writeStderrLine(line: string): void {
    process.stderr.write(`${line}\n`);
}

function readNoActiveResourceTypes(): readonly string[] {
    return [];
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

export function createTestSupportRunIfMain(dependencies: TestSupportRunIfMainDependencies): TestSupportRunIfMain {
    return async function runIfMain(meta, testNode, options) {
        if (!meta.main) {
            return;
        }

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
        const result = await execute(testPlan(meta, testNode, options), {
            execution: { mode: 'serial-in-process' },
            outputRenderer: selectedOutputRenderer(options),
            reporters: selectedReporters(options),
            runFacts: {
                nodeVersion: dependencies.nodeVersion
            },
            startedAt: startedAt()
        });

        if (hasFailure(result) && shouldSetFailureExitCode(dependencies.readExitCode())) {
            dependencies.setExitCode(1);
        }
    };
}

export const runIfMain = createTestSupportRunIfMain({
    nodeVersion: process.versions.node,
    readExitCode() {
        return process.exitCode;
    },
    setExitCode(exitCode) {
        process.exitCode = exitCode;
    }
});
