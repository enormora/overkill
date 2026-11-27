import type { Diagnostic } from 'typescript-beta/async';
import { attributeCallDiagnostics, type AttributedCallDiagnostics } from './call-diagnostics.ts';
import type { FrozenProject } from './frozen-project.ts';
import type { NativeSite } from './original-assertions.ts';

export type { AttributedCallDiagnostics } from './call-diagnostics.ts';

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

export async function projectDiagnostics(
    project: FrozenProject,
    signal: AbortSignal,
    probes: readonly NativeSite[]
): Promise<AttributedCallDiagnostics> {
    if (probes.length > 0 && project.project.options.noCheck === true) {
        throw new Error('Call assertions require semantic diagnostics. Disable noCheck in the type-test project.');
    }
    const program = await project.diagnosticProgram();
    const diagnostics = await structuralDiagnostics(program, signal);
    signal.throwIfAborted();
    const semantic = await program.getSemanticDiagnostics();
    const { attributed, remaining } = attributeCallDiagnostics(project.compiler.syntax, probes, semantic);
    requireCleanProject([ ...diagnostics, ...remaining ]);
    return attributed;
}

async function structuralDiagnostics(
    program: Awaited<ReturnType<FrozenProject['diagnosticProgram']>>,
    signal: AbortSignal
): Promise<readonly Diagnostic[]> {
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
    return diagnostics;
}
