import { resolve, dirname } from 'node:path';
import pLimit from 'p-limit';
import {
    Config,
    EventEmitter,
    FilePosition,
    Runner,
    environmentOptions,
    type Event as CheckerEvent
} from 'tstyche/api';
import {
    withGeneratedInputs,
    type GeneratedInputBatch,
    type GeneratedInputRequest
} from './generated-input.entry-point.ts';
import { withCheckerProject } from './checker-project.ts';
import { verifyCheckerEvidence } from './checker-evidence.ts';

export type { CompilerSelection } from './profile-settings.ts';
export type CheckerRequest = Pick<GeneratedInputRequest, 'modules' | 'project' | 'projectConfigPath'>;
export type CheckerRun = {
    readonly originalProjectPath: string;
    readonly checkerConfigPath: string;
    readonly compilerVersion: string;
    readonly inputs: GeneratedInputBatch;
    readonly events: readonly Readonly<CheckerEvent>[];
};
const serialize = pLimit(1);
async function runChecker(
    request: GeneratedInputRequest,
    target: string,
    events: readonly Readonly<CheckerEvent>[],
    inputs: GeneratedInputBatch
): Promise<CheckerRun> {
    const paths = inputs.modules.flatMap(function ready(module) {
        return module.kind === 'ready' ? [ module.path ] : [];
    });
    if (paths.length === 0) {
        throw new Error('No unambiguous generated inputs to check.', { cause: inputs.modules });
    }
    return withCheckerProject(request, paths, async function execute(checkerConfigPath) {
        const runner = new Runner(Config.resolve({
            commandLineOptions: { root: dirname(request.projectConfigPath) },
            configFileOptions: {
                tsconfig: checkerConfigPath,
                target: [ target ],
                reporters: [],
                quiet: true,
                checkSuppressedErrors: false,
                checkDeclarationFiles: false
            }
        }));
        await runner.run(paths.map(function location(path) {
            return new FilePosition(path);
        }));
        verifyCheckerEvidence(events, checkerConfigPath, request.project.compiler.version, paths);
        return {
            originalProjectPath: request.projectConfigPath,
            checkerConfigPath,
            compilerVersion: request.project.compiler.version,
            inputs,
            events
        };
    });
}

async function prepareCheck(
    request: CheckerRequest,
    events: readonly Readonly<CheckerEvent>[]
): Promise<CheckerRun> {
    if (request.modules.length === 0) {
        throw new Error('No translated inputs to check.');
    }
    if ((request.project.project.projectReferences?.length ?? 0) > 0) {
        throw new Error(
            'Project references require original-source checking; the generated checker cannot preserve them.'
        );
    }
    const inputRequest = {
        ...request,
        compiler: request.project.compiler.syntax,
        projectConfigPath: resolve(request.projectConfigPath)
    };
    using binding = new DisposableStack();
    const previous = environmentOptions.typescriptSpecifier;
    binding.defer(function restoreCompiler() {
        environmentOptions.typescriptSpecifier = previous;
    });
    environmentOptions.typescriptSpecifier = request.project.compiler.packageUrl;
    return await withGeneratedInputs(inputRequest, async function run(inputs) {
        return await runChecker(inputRequest, '*', events, inputs);
    });
}

async function check(request: CheckerRequest): Promise<CheckerRun> {
    const emitter = new EventEmitter();
    const events: Readonly<CheckerEvent>[] = [];
    const handler = {
        on(event: Readonly<CheckerEvent>): void {
            events.push(event);
        }
    };
    emitter.addHandler(handler);
    try {
        return await prepareCheck(request, events);
    } finally {
        emitter.removeHandler(handler);
    }
}

export async function checkGeneratedInputs(request: CheckerRequest): Promise<CheckerRun> {
    return serialize(check, request);
}
