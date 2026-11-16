import type { SourceFile } from 'typescript-beta/ast';
import { API, type Type, type Project } from 'typescript-beta/sync';
import { isTypeAliasDeclaration, isVariableStatement, isIdentifier } from 'typescript-beta/ast/is';
import { version } from 'typescript-beta';

export type CapabilityEvidence = {
    readonly requirement: string;
    readonly forward: boolean;
    readonly reverse: boolean;
    readonly properties: readonly string[];
    readonly calls: number;
    readonly errorType: boolean;
};

function inferenceOperands(project: Project, source: SourceFile): readonly (readonly [string, Type])[] {
    const operands: (readonly [string, Type])[] = [];
    const statements = source.statements.filter(isVariableStatement);
    for (const statement of statements) {
        for (const declaration of statement.declarationList.declarations) {
            if (
                isIdentifier(declaration.name) && declaration.name.text === 'inferred' &&
                declaration.initializer !== undefined
            ) {
                operands.push([ 'InferenceActual', project.checker.getTypeAtLocation(declaration.initializer) ]);
            }
        }
    }
    return operands;
}

function projectOperands(project: Project, fileNames: readonly string[]): Map<string, Type> {
    const operands = new Map<string, Type>();
    for (const path of fileNames) {
        const source = project.program.getSourceFile(path);
        if (source === undefined) {
            throw new Error('An original source file is unavailable.');
        }
        inferenceOperands(project, source).forEach(function retainExpression([ name, type ]) {
            operands.set(name, type);
        });
        for (const statement of source.statements) {
            if (isTypeAliasDeclaration(statement) && statement.name.text !== 'InferenceActual') {
                operands.set(statement.name.text, project.checker.getTypeFromTypeNode(statement.type));
            }
        }
    }
    return operands;
}

function validateProject(project: Project): void {
    const diagnostics = [
        ...project.program.getConfigFileParsingDiagnostics(),
        ...project.program.getGlobalDiagnostics(),
        ...project.program.getProgramDiagnostics(),
        ...project.program.getSyntacticDiagnostics(),
        ...project.program.getSemanticDiagnostics()
    ];
    if (diagnostics.length > 0) {
        throw new Error('The assessment project has compiler diagnostics.', { cause: diagnostics });
    }
}

function compareProject(project: Project, fileNames: readonly string[]): readonly CapabilityEvidence[] {
    const operands = projectOperands(project, fileNames);
    return Array.from(operands).flatMap(function compareOperands([ name, actual ]) {
        if (!name.endsWith('Actual')) {
            return [];
        }
        const expected = operands.get(name.replace(/Actual$/u, 'Expected'));
        if (expected === undefined || actual.isErrorType() || expected.isErrorType()) {
            throw new Error('Missing or invalid comparison operands.');
        }
        return [ {
            requirement: name.replace(/Actual$/u, ''),
            forward: project.checker.isTypeAssignableTo(actual, expected),
            reverse: project.checker.isTypeAssignableTo(expected, actual),
            properties: actual.getProperties().map(function propertyName(property) {
                return property.name;
            }),
            calls: actual.getCallSignatures().length,
            errorType: actual.isErrorType()
        } ];
    });
}

export function assessCompilerApi(projectConfigPath: string): readonly CapabilityEvidence[] {
    if (version !== '7.1.0-beta') {
        throw new Error('The assessment requires TypeScript 7.1.0-beta.');
    }
    using api = new API();
    const configuration = api.parseConfigFile(projectConfigPath);
    using snapshot = api.createSnapshot({ openProjects: [ projectConfigPath ] });
    const project = snapshot.getConfiguredProject(projectConfigPath);
    if (project === undefined) {
        throw new Error('The original configured project was not loaded.');
    }
    validateProject(project);
    return compareProject(project, configuration.fileNames);
}
