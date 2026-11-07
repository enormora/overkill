import { serializeValue, type TestPlan, type RunResult } from '../engine/engine.entry-point.ts';
import type { CollectedAdapterRun } from '../run/run.entry-point.ts';
import { frozenProject, verifyFrozenProject, fingerprint } from './frozen-project.ts';
import { translateNativePlan, type NativeTranslation } from './native-translation.ts';
import { checkGeneratedInputs, type CheckerRequest } from './checker.entry-point.ts';
import { nativeCheckResult } from './native-results.ts';
import { typeTestSettingsSchema } from './profile-settings.ts';
import type { GeneratedModuleResult } from './generated-input-types.ts';

export { prepareNativePlan as prepare } from './frozen-project.ts';

type NativeExecution = {
    readonly plan: TestPlan;
    readonly translation: NativeTranslation;
    readonly request: CheckerRequest;
    readonly compilerVersion: string;
};
type NativeExecutionResult = { readonly result: RunResult; readonly provenance: readonly GeneratedModuleResult[]; };

async function checkNative(input: NativeExecution, started: number): Promise<NativeExecutionResult> {
    const checked = await checkGeneratedInputs(input.request);
    if (checked.compilerVersion !== input.compilerVersion) {
        throw new Error('Compiler identity changed after collection.');
    }
    return {
        result: nativeCheckResult({ ...input, checked, error: null, started }),
        provenance: checked.inputs.modules
    };
}

async function executeNative(input: NativeExecution): Promise<NativeExecutionResult> {
    const started = performance.now();
    if (input.translation.modules.length === 0) {
        return { result: nativeCheckResult({ ...input, checked: null, error: null, started }), provenance: [] };
    }
    try {
        return await checkNative(input, started);
    } catch (error: unknown) {
        return { result: nativeCheckResult({ ...input, checked: null, error, started }), provenance: [] };
    }
}

export async function collect(plan: TestPlan, settings: unknown): Promise<CollectedAdapterRun> {
    const options = typeTestSettingsSchema.parse(settings);
    const project = frozenProject(plan);
    const translation = translateNativePlan({
        compiler: project.compiler,
        program: project.program,
        checker: project.program.getTypeChecker()
    }, plan);
    const sourceFacts = {
        compilerVersion: project.compiler.version,
        projectConfigPath: project.projectConfigPath,
        projectFingerprint: fingerprint(project.projectText),
        sources: translation.modules.map(function original(module) {
            return { path: module.path, fingerprint: fingerprint(module.originalText) };
        }),
        assertions: translation.sites
    };
    const facts = serializeValue(sourceFacts);
    return {
        facts,
        async lower() {
            await verifyFrozenProject(project, translation);
            let provenance: readonly GeneratedModuleResult[] = [];
            return {
                get facts() {
                    return serializeValue({ ...sourceFacts, generatedInputs: provenance });
                },
                async execute(): Promise<RunResult> {
                    await verifyFrozenProject(project, translation);
                    const execution = await executeNative({
                        plan,
                        translation,
                        compilerVersion: project.compiler.version,
                        request: {
                            projectConfigPath: project.projectConfigPath,
                            compiler: options.compiler,
                            modules: translation.modules
                        }
                    });
                    provenance = execution.provenance;
                    return execution.result;
                }
            };
        }
    };
}
