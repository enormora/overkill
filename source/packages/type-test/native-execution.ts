import type { Diagnostic } from 'typescript-beta/async';
import type { TestPlan } from '../engine/engine.entry-point.ts';
import { parseAdapterFacts } from '../../config/adapter-facts.ts';
import type { CheckerExecution } from './checker-plan.ts';
import {
    verifyFrozenProject,
    fingerprint,
    originalProjectFacts,
    typeAnalysis,
    type FrozenProject
} from './frozen-project.ts';
import { collectOriginalAssertions, type OriginalAssertionPlan, type NativeSite } from './original-assertions.ts';
import { nativeCheckResult, type SiteEvidence } from './native-results.ts';
import { evaluateSite } from './original-evidence.ts';

import { projectSourceAnalysis } from './project-source-analysis.ts';
import { validateCompilerProject, type RememberProjectValidation } from './project-validation-cache.ts';

function projectDiagnostic(diagnostic: Diagnostic): string {
    const position = diagnostic.startPosition;
    if (position === undefined) {
        return `${diagnostic.fileName ?? 'project'}: TS${diagnostic.code}: ${diagnostic.text}`;
    }
    const line = position.line + 1;
    const column = position.character + 1;
    return `${diagnostic.fileName}:${line}:${column}: TS${diagnostic.code}: ${diagnostic.text}`;
}

async function validateProject(project: FrozenProject, signal: AbortSignal): Promise<void> {
    const program = await project.diagnosticProgram();
    const diagnostics: Diagnostic[] = [];
    for (
        const read of [
            program.getConfigFileParsingDiagnostics,
            program.getGlobalDiagnostics,
            program.getProgramDiagnostics,
            program.getSyntacticDiagnostics,
            program.getSemanticDiagnostics
        ]
    ) {
        signal.throwIfAborted();
        diagnostics.push(...await read.call(program));
    }
    if (diagnostics.length > 0) {
        throw new Error(diagnostics.map(projectDiagnostic).join('\n'), { cause: diagnostics });
    }
}

async function checkOriginalAssertions(
    project: FrozenProject,
    assertionPlan: OriginalAssertionPlan,
    signal: AbortSignal
): Promise<readonly SiteEvidence[]> {
    const checked: SiteEvidence[] = [];
    const analysis = typeAnalysis(project);
    for (const site of assertionPlan.sites) {
        signal.throwIfAborted();
        checked.push(await evaluateSite(analysis, site, project.compiler.version));
    }
    return checked;
}

function assertionFacts(
    site: NativeSite
): Pick<NativeSite, 'column' | 'line' | 'message' | 'owners' | 'path' | 'range'> & {
    readonly relation: NativeSite['reference']['relation'];
    readonly negated: boolean;
} {
    const { path, range, owners, line, column, message, reference } = site;
    return { path, range, owners, line, column, message, relation: reference.relation, negated: reference.negated };
}

export type CompilerCheck = {
    readonly facts: CheckerExecution['facts'];
    readonly verify: (signal: AbortSignal) => Promise<void>;
    readonly check: (signal: AbortSignal, remember: RememberProjectValidation) => Promise<CheckerExecution>;
};

export async function collectProject(
    plan: TestPlan,
    project: FrozenProject,
    collectionSignal: AbortSignal
): Promise<CompilerCheck> {
    const assertionPlan = await project.execute(collectionSignal, async function collectAssertions() {
        return await collectOriginalAssertions(projectSourceAnalysis(project), plan);
    });
    const sourceFacts = {
        identities: plan.cases.map(function (testCase) {
            return testCase.workId;
        }),
        compilerVersion: project.compiler.version,
        projectConfigPath: project.projectConfigPath,
        configuration: originalProjectFacts(project),
        projectFingerprint: fingerprint(project.projectText),
        sources: assertionPlan.modules.map(function original(module) {
            return { path: module.path, fingerprint: fingerprint(module.originalText) };
        }),
        inputs: project.inputFacts(),
        issues: assertionPlan.issues,
        assertions: assertionPlan.sites.map(assertionFacts)
    };
    async function checkProject(
        signal: AbortSignal,
        remember: RememberProjectValidation
    ): Promise<readonly SiteEvidence[]> {
        await validateCompilerProject(project, signal, async function validate() {
            await validateProject(project, signal);
        }, remember);
        return await checkOriginalAssertions(project, assertionPlan, signal);
    }
    const facts = parseAdapterFacts(sourceFacts);
    return {
        facts,
        async verify(signal) {
            await verifyFrozenProject(project, assertionPlan.modules, signal);
        },
        async check(signal, remember) {
            const started = performance.now();
            try {
                const checked = await project.execute(signal, async function checkAssertions() {
                    return await checkProject(signal, remember);
                });
                return {
                    result: nativeCheckResult({ plan, assertionPlan, checked, error: null, started }),
                    facts: parseAdapterFacts({
                        ...sourceFacts,
                        inputs: project.inputFacts(),
                        evidence: checked.map(function (entry) {
                            return {
                                ...assertionFacts(entry.site),
                                actual: entry.actual,
                                expected: entry.expected,
                                compilerVersion: entry.compilerVersion,
                                result: entry.result
                            };
                        })
                    })
                };
            } catch (error: unknown) {
                signal.throwIfAborted();
                const failure = error instanceof Error
                    ? error
                    : new Error('Type-test checker failed.', { cause: error });
                return {
                    result: nativeCheckResult({ plan, assertionPlan, checked: null, error: failure, started }),
                    facts
                };
            }
        }
    };
}
