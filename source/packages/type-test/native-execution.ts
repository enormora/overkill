import type { Diagnostic } from 'typescript-beta/async';
import type { TestPlan } from '../engine/engine.entry-point.ts';
import { parseAdapterFacts } from '../../config/adapter-facts.ts';
import type { CheckerExecution } from './checker-plan.ts';
import {
    verifyFrozenProject,
    fingerprint,
    typeAnalysis,
    type FrozenProject
} from './frozen-project.ts';
import { collectOriginalAssertions, type OriginalAssertionPlan, type NativeSite } from './original-assertions.ts';
import { nativeCheckResult, type SiteEvidence } from './native-results.ts';
import { evaluateSite } from './original-evidence.ts';

import { createSourceAnalysis, type SourceAnalysis } from './source-analysis-port.ts';
import { compilerFileSystem } from './compiler-file-system.ts';
import { runCompilerOperation } from './compiler-lifetime.ts';

export function projectSourceAnalysis(project: FrozenProject): SourceAnalysis {
    const { checker } = project.configured;
    return createSourceAnalysis({
        realpath: compilerFileSystem.realpath,
        compiler: project.compiler.syntax,
        program: project.program,
        checker: {
            getSymbolAtLocation: checker.getSymbolAtLocation.bind(checker),
            getAliasedSymbol: checker.getAliasedSymbol.bind(checker),
            getShorthandAssignmentValueSymbol: checker.getShorthandAssignmentValueSymbol.bind(checker),
            async getResolvedSignature(node) {
                const signature = await checker.getResolvedSignature(node);
                return { declaration: signature.declaration };
            },
            async staticString(node) {
                const value = await checker.getTypeAtLocation(node);
                return value.isStringLiteralType() ? value.value : null;
            }
        }
    });
}

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
    const diagnostics: Diagnostic[] = [];
    for (
        const read of [
            project.program.getConfigFileParsingDiagnostics,
            project.program.getGlobalDiagnostics,
            project.program.getProgramDiagnostics,
            project.program.getSyntacticDiagnostics,
            project.program.getSemanticDiagnostics
        ]
    ) {
        signal.throwIfAborted();
        diagnostics.push(...await read.call(project.program));
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
    readonly check: (signal: AbortSignal) => Promise<CheckerExecution>;
};

export async function collectProject(
    plan: TestPlan,
    project: FrozenProject,
    collectionSignal: AbortSignal
): Promise<CompilerCheck> {
    let assertionPlan: OriginalAssertionPlan = { modules: [], sites: [], issues: [] };
    let collectionError: Error | null = null;
    try {
        assertionPlan = await runCompilerOperation(
            project.lifetime,
            collectionSignal,
            async function collectAssertions() {
                return await collectOriginalAssertions(projectSourceAnalysis(project), plan);
            }
        );
    } catch (error: unknown) {
        collectionSignal.throwIfAborted();
        collectionError = error instanceof Error
            ? error
            : new Error('Type-test source analysis failed.', { cause: error });
    }
    const configurationJson = JSON.stringify({
        options: project.project.options,
        files: project.project.fileNames,
        references: project.project.projectReferences ?? []
    });
    const sourceFacts = {
        identities: plan.cases.map(function (testCase) {
            return testCase.workId;
        }),
        compilerVersion: project.compiler.version,
        projectConfigPath: project.projectConfigPath,
        configuration: parseAdapterFacts(JSON.parse(configurationJson)),
        projectFingerprint: fingerprint(project.projectText),
        sources: assertionPlan.modules.map(function original(module) {
            return { path: module.path, fingerprint: fingerprint(module.originalText) };
        }),
        inputs: project.observation.snapshot(),
        issues: assertionPlan.issues,
        assertions: assertionPlan.sites.map(assertionFacts)
    };
    async function checkProject(signal: AbortSignal): Promise<readonly SiteEvidence[]> {
        await validateProject(project, signal);
        if (collectionError !== null) {
            throw collectionError;
        }
        return await checkOriginalAssertions(project, assertionPlan, signal);
    }
    const facts = parseAdapterFacts(sourceFacts);
    return {
        facts,
        async verify(signal) {
            await verifyFrozenProject(project, assertionPlan.modules, signal);
        },
        async check(signal) {
            const started = performance.now();
            try {
                const checked = await runCompilerOperation(project.lifetime, signal, async function checkAssertions() {
                    return await checkProject(signal);
                });
                return {
                    result: nativeCheckResult({ plan, assertionPlan, checked, error: null, started }),
                    facts: parseAdapterFacts({
                        ...sourceFacts,
                        inputs: project.observation.snapshot(),
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
