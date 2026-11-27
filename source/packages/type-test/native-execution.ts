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
import { projectDiagnostics, type AttributedCallDiagnostics } from './project-diagnostics.ts';
import { evaluateSite } from './original-evidence.ts';

import { projectSourceAnalysis } from './project-source-analysis.ts';
import { validateCompilerProject, type RememberProjectValidation } from './project-validation-cache.ts';

async function checkOriginalAssertions(
    project: FrozenProject,
    assertionPlan: OriginalAssertionPlan,
    diagnostics: AttributedCallDiagnostics,
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

type AssertionFacts = Pick<NativeSite, 'column' | 'line' | 'message' | 'owners' | 'path' | 'range'> & {
    readonly relation: NativeSite['reference']['relation'];
    readonly negated: boolean;
};
type CallAssertionFacts = AssertionFacts & { readonly reason: string | null; };

function assertionFacts(site: NativeSite): AssertionFacts | CallAssertionFacts {
    const { path, range, owners, line, column, message, reference } = site;
    return {
        path,
        range,
        owners,
        line,
        column,
        message,
        relation: reference.relation,
        negated: reference.negated,
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
        const selectedPlan = await collectOriginalAssertions(analysis, plan);
        const selected = new Set(plan.cases.map(function identity(entry) {
            return workIdentityKey(entry.workId);
        }));
        const otherCases = plan.discoveredCases.filter(function unselected(entry) {
            return entry.workId.familyVariant?.key === `typescript@${project.compiler.version}` &&
                !selected.has(workIdentityKey(entry.workId));
        });
        const [ first, ...rest ] = otherCases;
        const unselectedPlan = first === undefined
            ? null
            : await collectOriginalAssertions(analysis, { ...plan, cases: [ first, ...rest ] });
        const byAssertion = new Map(
            [ ...selectedPlan.sites, ...unselectedPlan?.sites ?? [] ]
                .filter(function probe(site) {
                    return site.reference.kind === 'call';
                })
                .map(function byCall(site) {
                    return [ site.call, site ];
                })
        );
        return { assertionPlan: selectedPlan, probes: Array.from(byAssertion.values()) };
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
                                ...(entry.site.reference.kind === 'call' ? { diagnostics: entry.diagnostics } : {}),
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
