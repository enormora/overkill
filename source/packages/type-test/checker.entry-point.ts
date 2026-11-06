import { resolve, dirname } from 'node:path';
import pLimit from 'p-limit';
import { Config, EventEmitter, FileLocation, Runner, Store, type Event as CheckerEvent } from 'tstyche/api';
import type { ReadonlyDeep } from 'type-fest';
import {
    withGeneratedInputs,
    type GeneratedInputBatch,
    type GeneratedInputRequest
} from './generated-input.entry-point.ts';
import { withCheckerProject } from './checker-project.ts';
import { verifyCheckerEvidence } from './checker-evidence.ts';

export type CompilerSelection = { readonly kind: 'local'; } | { readonly kind: 'version'; readonly version: string; };
export type CheckerRequest = Pick<GeneratedInputRequest, 'modules' | 'projectConfigPath'> & {
    readonly compiler: CompilerSelection;
};
export type CheckerRun = {
    readonly originalProjectPath: string;
    readonly checkerConfigPath: string;
    readonly compilerVersion: string;
    readonly inputs: GeneratedInputBatch;
    readonly events: readonly ReadonlyDeep<CheckerEvent>[];
};
const serialize = pLimit(1);
async function runChecker(
    request: GeneratedInputRequest,
    target: string,
    events: readonly ReadonlyDeep<CheckerEvent>[],
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
                checkDeclarationFiles: false
            }
        }));
        await runner.run(paths.map(function location(path) {
            return new FileLocation(path);
        }));
        verifyCheckerEvidence(events, checkerConfigPath, request.compiler.version, paths);
        return {
            originalProjectPath: request.projectConfigPath,
            checkerConfigPath,
            compilerVersion: request.compiler.version,
            inputs,
            events
        };
    });
}
async function prepareCheck(
    request: CheckerRequest,
    events: readonly ReadonlyDeep<CheckerEvent>[]
): Promise<CheckerRun> {
    if (request.modules.length === 0) {
        throw new Error('No translated inputs to check.');
    }
    const target = request.compiler.kind === 'local' ? '*' : request.compiler.version;
    const compiler = await Store.load(target);
    if (compiler === undefined || request.compiler.kind === 'version' && compiler.version !== target) {
        throw new Error('Cannot load the expected exact compiler version.', { cause: events });
    }
    const inputRequest = { ...request, compiler, projectConfigPath: resolve(request.projectConfigPath) };
    return withGeneratedInputs(inputRequest, async function run(inputs) {
        return runChecker(inputRequest, target, events, inputs);
    });
}
async function check(request: CheckerRequest): Promise<CheckerRun> {
    const emitter = new EventEmitter();
    const events: ReadonlyDeep<CheckerEvent>[] = [];
    const handler = {
        on(event: ReadonlyDeep<CheckerEvent>): void {
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
