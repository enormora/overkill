import type { Diagnostic } from 'typescript-beta/async';
import type { TestPlan, RunResult } from '../engine/engine.entry-point.ts';
import { parseAdapterFacts } from '../../config/adapter-facts.ts';
import type { CollectedCheckerRun } from './checker-plan.ts';
import { verifyFrozenProject, fingerprint, sourceAnalysis, type FrozenProject } from './frozen-project.ts';
import { collectOriginalAssertions, type OriginalAssertionPlan } from './original-assertions.ts';
import { nativeCheckResult, type SiteEvidence } from './native-results.ts';
import { evaluateSite } from './original-evidence.ts';

function projectDiagnostic(diagnostic: Diagnostic): string {
    const position = diagnostic.startPosition;
    if (position === undefined) {
        return `${diagnostic.fileName ?? 'project'}: TS${diagnostic.code}: ${diagnostic.text}`;
    }
    const line = position.line + 1;
    const column = position.character + 1;
    return `${diagnostic.fileName}:${line}:${column}: TS${diagnostic.code}: ${diagnostic.text}`;
}

async function validateProject(project: FrozenProject): Promise<void> {
    const diagnostics = [
        ...await project.program.getConfigFileParsingDiagnostics(),
        ...await project.program.getGlobalDiagnostics(),
        ...await project.program.getProgramDiagnostics(),
        ...await project.program.getSyntacticDiagnostics(),
        ...await project.program.getSemanticDiagnostics()
    ];
    if (diagnostics.length > 0) {
        throw new Error(diagnostics.map(projectDiagnostic).join('\n'), { cause: diagnostics });
    }
}

async function checkOriginalAssertions(
    project: FrozenProject,
    assertionPlan: OriginalAssertionPlan
): Promise<readonly SiteEvidence[]> {
    await validateProject(project);
    const checked: SiteEvidence[] = [];
    const analysis = sourceAnalysis(project);
    for (const site of assertionPlan.sites) {
        checked.push(await evaluateSite(analysis, site, project.compiler.version));
    }
    await verifyFrozenProject(project, assertionPlan);
    return checked;
}

async function executeNative(
    plan: TestPlan,
    project: FrozenProject,
    assertionPlan: OriginalAssertionPlan
): Promise<{ readonly result: RunResult; readonly evidence: readonly SiteEvidence[]; }> {
    const started = performance.now();
    try {
        const checked = await checkOriginalAssertions(project, assertionPlan);
        return { result: nativeCheckResult({ plan, assertionPlan, checked, error: null, started }), evidence: checked };
    } catch (error: unknown) {
        return { result: nativeCheckResult({ plan, assertionPlan, checked: null, error, started }), evidence: [] };
    }
}

export async function collectProject(plan: TestPlan, project: FrozenProject): Promise<CollectedCheckerRun> {
    const assertionPlan = await collectOriginalAssertions(sourceAnalysis(project), plan);
    const compilerOptions = project.project.options;
    const configurationJson = JSON.stringify({
        options: compilerOptions,
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
        inputs: project.inputs,
        issues: assertionPlan.issues,
        assertions: assertionPlan.sites.map(function describe(site) {
            return {
                path: site.path,
                range: site.range,
                owners: site.owners,
                line: site.line,
                column: site.column,
                message: site.message
            };
        })
    };
    const facts = parseAdapterFacts(sourceFacts);
    return {
        facts,
        async lower() {
            await verifyFrozenProject(project, assertionPlan);
            let evidence: readonly SiteEvidence[] = [];
            return {
                get facts() {
                    return parseAdapterFacts({
                        ...sourceFacts,
                        evidence: evidence.map(function describe(entry) {
                            return {
                                path: entry.site.path,
                                range: entry.site.range,
                                owners: entry.site.owners,
                                actual: entry.actual,
                                expected: entry.expected,
                                compilerVersion: entry.compilerVersion,
                                result: entry.result
                            };
                        })
                    });
                },
                async execute(): Promise<RunResult> {
                    await verifyFrozenProject(project, assertionPlan);
                    const execution = await executeNative(plan, project, assertionPlan);
                    evidence = execution.evidence;
                    return execution.result;
                }
            };
        }
    };
}
