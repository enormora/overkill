import type { SourceFile } from 'typescript-beta/ast';
import { API, type Type, type Project } from 'typescript-beta/async';
import { isTypeAliasDeclaration, isVariableStatement, isIdentifier } from 'typescript-beta/ast/is';
import { version } from 'typescript-beta';
import { createCompilerLifetime } from '../packages/type-test/compiler-lifetime.ts';

export type CapabilityEvidence = {
    readonly requirement: string;
    readonly forward: boolean;
    readonly reverse: boolean;
    readonly properties: readonly string[];
    readonly calls: number;
    readonly errorType: boolean;
};
async function inferenceOperands(project: Project, source: SourceFile): Promise<
    readonly (readonly [
        string,
        Type
    ])[]
> {
    const operands: (readonly [
        string,
        Type
    ])[] = [];
    const statements = source.statements.filter(isVariableStatement);
    for (const statement of statements) {
        for (const declaration of statement.declarationList.declarations) {
            if (
                isIdentifier(declaration.name) && declaration.name.text === 'inferred' &&
                declaration.initializer !== undefined
            ) {
                operands.push([ 'InferenceActual', await project.checker.getTypeAtLocation(declaration.initializer) ]);
            }
        }
    }
    return operands;
}

async function sourceOperands(project: Project, source: SourceFile): Promise<readonly (readonly [string, Type])[]> {
    const operands = Array.from(await inferenceOperands(project, source));
    for (const statement of source.statements) {
        if (isTypeAliasDeclaration(statement) && statement.name.text !== 'InferenceActual') {
            operands.push([ statement.name.text, await project.checker.getTypeFromTypeNode(statement.type) ]);
        }
    }
    return operands;
}

async function projectOperands(project: Project, fileNames: readonly string[]): Promise<Map<string, Type>> {
    const operands = new Map<string, Type>();
    for (const path of fileNames) {
        const source = await project.program.getSourceFile(path);
        if (source === undefined) {
            throw new Error('An original source file is unavailable.');
        }
        const inferred = await sourceOperands(project, source);
        inferred.forEach(function retainExpression([ name, type ]) {
            operands.set(name, type);
        });
    }
    return operands;
}

async function validateProject(project: Project): Promise<void> {
    const diagnostics = [
        ...await project.program.getConfigFileParsingDiagnostics(),
        ...await project.program.getGlobalDiagnostics(),
        ...await project.program.getProgramDiagnostics(),
        ...await project.program.getSyntacticDiagnostics(),
        ...await project.program.getSemanticDiagnostics()
    ];
    if (diagnostics.length > 0) {
        throw new Error('The assessment project has compiler diagnostics.', { cause: diagnostics });
    }
}

async function relationEvidence(
    project: Project,
    name: string,
    actual: Type,
    expected: Type
): Promise<CapabilityEvidence> {
    const properties = await actual.getProperties();
    const signatures = await actual.getCallSignatures();
    return {
        requirement: name.replace(/Actual$/u, ''),
        forward: await project.checker.isTypeAssignableTo(actual, expected),
        reverse: await project.checker.isTypeAssignableTo(expected, actual),
        properties: properties.map(function propertyName(property) {
            return property.name;
        }),
        calls: signatures.length,
        errorType: actual.isErrorType()
    };
}

async function compareProject(project: Project, fileNames: readonly string[]): Promise<readonly CapabilityEvidence[]> {
    const operands = await projectOperands(project, fileNames);
    const evidence: CapabilityEvidence[] = [];
    const comparisons = Array.from(operands).filter(function actualOperand([ name ]) {
        return name.endsWith('Actual');
    });
    for (const [ name, actual ] of comparisons) {
        const expected = operands.get(name.replace(/Actual$/u, 'Expected'));
        if (expected === undefined || actual.isErrorType() || expected.isErrorType()) {
            throw new Error('Missing or invalid comparison operands.');
        }
        evidence.push(await relationEvidence(project, name, actual, expected));
    }
    return evidence;
}

export async function assessCompilerApi(projectConfigPath: string): Promise<readonly CapabilityEvidence[]> {
    await using lifetime = createCompilerLifetime();
    return await lifetime.run(async function assess() {
        if (version !== '7.1.0-beta') {
            throw new Error('The assessment requires TypeScript 7.1.0-beta.');
        }
        await using api = new API();
        const configuration = await api.parseConfigFile(projectConfigPath);
        await using snapshot = await api.createSnapshot({ openProjects: [ projectConfigPath ] });
        const project = snapshot.getConfiguredProject(projectConfigPath);
        if (project === undefined) {
            throw new Error('The original configured project was not loaded.');
        }
        await validateProject(project);
        return await compareProject(project, configuration.fileNames);
    });
}
