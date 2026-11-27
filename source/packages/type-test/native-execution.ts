import type { Diagnostic } from 'typescript-beta/async';
import type { Node } from 'typescript-beta/ast';
import { workIdentityKey, type TestPlan } from '../engine/engine.entry-point.ts';
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
import { attributeCallDiagnostics, type CallDiagnostic } from './call-diagnostics.ts';
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

function requireCleanProject(diagnostics: readonly Diagnostic[]): void {
    if (diagnostics.length > 0) {
        throw new Error(diagnostics.map(projectDiagnostic).join('\n'), { cause: diagnostics });
    }
}

async function projectDiagnostics(
    project: FrozenProject,
    signal: AbortSignal,
    probes: readonly NativeSite[]
): Promise<ReadonlyMap<Node, readonly CallDiagnostic[]>> {
    if (probes.length > 0 && project.project.options.noCheck === true) {
        throw new Error('Call assertions require semantic diagnostics. Disable noCheck in the type-test project.');
    }
    const program = await project.diagnosticProgram();
    const diagnostics: Diagnostic[] = [];
    for (
        const read of [
            program.getConfigFileParsingDiagnostics,
            program.getGlobalDiagnostics,
            program.getProgramDiagnostics,
            program.getSyntacticDiagnostics
        ]
    ) {
        signal.throwIfAborted();
        diagnostics.push(...await read.call(program));
    }
    signal.throwIfAborted();
    const semantic = await program.getSemanticDiagnostics();
    const { attributed, remaining } = attributeCallDiagnostics(project.compiler.syntax, probes, semantic);
    requireCleanProject([ ...diagnostics, ...remaining ]);
    return attributed;
}

async function checkOriginalAssertions(
    project: FrozenProject,
    assertionPlan: OriginalAssertionPlan,
    diagnostics: ReadonlyMap<Node, readonly CallDiagnostic[]>,
    signal: AbortSignal
): Promise<readonly SiteEvidence[]> {
    const checked: SiteEvidence[] = [];
    const analysis = typeAnalysis(project);
    for (const site of assertionPlan.sites) {
        signal.throwIfAborted();
        const owned = site.reference.kind === 'call' ? diagnostics.get(site.reference.probe) ?? [] : [];
        checked.push(await evaluateSite(analysis, site, project.compiler.version, owned));
    }
    return checked;
}

function assertionFacts(site: NativeSite) {
    const { path, range, owners, line, column, message, reference } = site;
    return {
        path, range, owners, line, column, message, relation: reference.relation, negated: reference.negated,
        ...reference.kind === 'call' ? { reason: reference.reason } : {}
    };
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
    const { assertionPlan, probes } = await project.execute(collectionSignal, async function collectAssertions() {
        const analysis = projectSourceAnalysis(project);
        const assertionPlan = await collectOriginalAssertions(analysis, plan);
        const selected = new Set(plan.cases.map(function identity(entry) {
            return workIdentityKey(entry.workId);
        }));
        const otherCases = plan.discoveredCases.filter(function unselected(entry) {
            return entry.workId.familyVariant?.key === `typescript@${project.compiler.version}` &&
                !selected.has(workIdentityKey(entry.workId));
        });
        const [ first, ...rest ] = otherCases;
        const otherSites = first === undefined
            ? []
            : (await collectOriginalAssertions(analysis, { ...plan, cases: [ first, ...rest ] })).sites;
        const probes = Array.from(new Map(
            [ ...assertionPlan.sites, ...otherSites ]
                .filter(function probe(site) {
                    return site.reference.kind === 'call';
                })
                .map(function byCall(site) {
                    return [ site.call, site ];
                })
        ).values());
        return { assertionPlan, probes };
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
        if (probes.length === 0) {
            await validateCompilerProject(project, signal, async function validate() {
                await projectDiagnostics(project, signal, []);
            }, remember);
            return await checkOriginalAssertions(project, assertionPlan, new Map(), signal);
        }
        const diagnostics = await projectDiagnostics(project, signal, probes);
        return await checkOriginalAssertions(project, assertionPlan, diagnostics, signal);
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
                                ...entry.site.reference.kind !== 'call' ? {} : { diagnostics: entry.diagnostics },
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
