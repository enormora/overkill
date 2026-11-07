import type TypeScript from 'typescript';
import { resolveSourceLocation, isTableBodyOrigin, type TestBodyOrigin } from '../engine/engine.entry-point.ts';

type ExpressionBody = TypeScript.ArrowFunction | TypeScript.FunctionExpression;
type DeclarationBody = TypeScript.FunctionDeclaration | TypeScript.MethodDeclaration;
export type SourceBody = Readonly<DeclarationBody | ExpressionBody>;
export type SourceAnalysis = {
    readonly compiler: typeof TypeScript;
    readonly checker: TypeScript.TypeChecker;
    readonly program: TypeScript.Program;
};

export function sourceSymbol(analysis: SourceAnalysis, node: TypeScript.Node): TypeScript.Symbol | undefined {
    const symbol = analysis.checker.getSymbolAtLocation(node);
    return symbol?.flags === analysis.compiler.SymbolFlags.Alias ? analysis.checker.getAliasedSymbol(symbol) : symbol;
}

function isSourceBody(compiler: typeof TypeScript, node: TypeScript.Node): node is SourceBody {
    return compiler.isArrowFunction(node) || compiler.isFunctionExpression(node) ||
        compiler.isFunctionDeclaration(node) || compiler.isMethodDeclaration(node);
}

function immutableInitializer(analysis: SourceAnalysis, node: TypeScript.Node): TypeScript.Node | undefined {
    const { compiler } = analysis;
    if (!compiler.isVariableDeclaration(node) || !compiler.isVariableDeclarationList(node.parent)) {
        return undefined;
    }
    return node.parent.getFirstToken()?.kind === compiler.SyntaxKind.ConstKeyword ? node.initializer : undefined;
}

function callbackDeclarations(
    analysis: SourceAnalysis,
    expression: TypeScript.Node
): readonly TypeScript.Declaration[] {
    const symbol = analysis.compiler.isShorthandPropertyAssignment(expression)
        ? analysis.checker.getShorthandAssignmentValueSymbol(expression)
        : sourceSymbol(analysis, expression);
    return symbol?.declarations ?? [];
}

function constantExpression(
    analysis: SourceAnalysis,
    declarations: readonly TypeScript.Declaration[]
): TypeScript.Node {
    const declaration = declarations.length === 1 ? declarations[0] : undefined;
    const initializer = declaration === undefined ? undefined : immutableInitializer(analysis, declaration);
    if (initializer === undefined) {
        throw new Error('Unsupported or ambiguous callback source ownership.');
    }
    return initializer;
}

function declarationExpression(analysis: SourceAnalysis, expression: TypeScript.Node): TypeScript.Node {
    const declarations = callbackDeclarations(analysis, expression);
    const implementations = declarations.filter(function implemented(node) {
        return isSourceBody(analysis.compiler, node) && node.body !== undefined;
    });
    const [ implementation ] = implementations;
    return implementations.length === 1 && implementation !== undefined
        ? implementation
        : constantExpression(analysis, declarations);
}

function originalExpression(analysis: SourceAnalysis, initial: TypeScript.Node): TypeScript.Node {
    let expression = initial;
    const seen = new Set<TypeScript.Node>();
    while (analysis.compiler.isIdentifier(expression)) {
        if (seen.has(expression)) {
            throw new Error('Cyclic callback source ownership.');
        }
        seen.add(expression);
        expression = declarationExpression(analysis, expression);
    }
    return expression;
}

export function declaredBody(analysis: SourceAnalysis, initial: TypeScript.Node): SourceBody {
    let expression = initial;
    while (
        analysis.compiler.isParenthesizedExpression(expression) ||
        analysis.compiler.isExpressionWithTypeArguments(expression)
    ) {
        expression = expression.expression;
    }
    const resolved = originalExpression(analysis, expression);
    if (isSourceBody(analysis.compiler, resolved) && resolved.body !== undefined) {
        return resolved;
    }
    throw new Error('Callback source is not a statically identifiable function body.');
}

function propertyExpression(analysis: SourceAnalysis, property: TypeScript.ObjectLiteralElementLike): TypeScript.Node {
    if (analysis.compiler.isPropertyAssignment(property)) {
        return property.initializer;
    }
    if (analysis.compiler.isMethodDeclaration(property)) {
        return property;
    }
    if (analysis.compiler.isShorthandPropertyAssignment(property)) {
        return declarationExpression(analysis, property);
    }
    throw new Error('Unsupported callback property source.');
}

function objectField(analysis: SourceAnalysis, input: TypeScript.Node, field: string): TypeScript.Node {
    const node = originalExpression(analysis, input);
    if (!analysis.compiler.isObjectLiteralExpression(node)) {
        throw new Error('Unsupported callback options expression.');
    }
    const property = node.properties.find(function named(entry) {
        return entry.name?.getText() === field;
    });
    if (property === undefined) {
        throw new Error(`Callback definition has no explicit ${field} source.`);
    }
    return propertyExpression(analysis, property);
}

function tableCaseExpression(analysis: SourceAnalysis, input: TypeScript.Node, index: number): TypeScript.Node {
    const cases = originalExpression(analysis, objectField(analysis, input, 'cases'));
    if (!analysis.compiler.isArrayLiteralExpression(cases)) {
        throw new Error('Low-level table cases require static source ownership.');
    }
    const row = cases.elements[index];
    if (row === undefined) {
        throw new Error('Table case source index is missing.');
    }
    return objectField(analysis, row, 'body');
}

function callName(analysis: SourceAnalysis, call: TypeScript.CallExpression): string | undefined {
    const location = analysis.compiler.isPropertyAccessExpression(call.expression)
        ? call.expression.name
        : call.expression;
    return sourceSymbol(analysis, location)?.name;
}

function positionalBody(
    analysis: SourceAnalysis,
    call: TypeScript.CallExpression,
    first: TypeScript.Node,
    name: string | undefined
): TypeScript.Node {
    const positional = [ 'test', 'withResource', 'withResources', 'withRuntime' ];
    const body = call.arguments[1];
    if (name !== undefined && positional.includes(name) && body !== undefined) {
        return body;
    }
    return objectField(analysis, first, name === 'table' ? 'test' : 'body');
}

function bodyExpression(
    analysis: SourceAnalysis,
    call: TypeScript.CallExpression,
    origin: TestBodyOrigin
): TypeScript.Node {
    const name = callName(analysis, call);
    const first = call.arguments[0];
    if (first === undefined) {
        throw new Error('Callback construction has no arguments.');
    }
    if (name === 'defineParameterizedTestBody') {
        return first;
    }
    if (name === 'createTable' && isTableBodyOrigin(origin)) {
        return tableCaseExpression(analysis, first, origin.tableIndex);
    }
    return positionalBody(analysis, call, first, name);
}

function callAtOffset(
    analysis: SourceAnalysis,
    file: TypeScript.SourceFile,
    offset: number
): TypeScript.CallExpression {
    const calls: TypeScript.CallExpression[] = [];
    function visit(node: TypeScript.Node): void {
        if (node.getStart(file) <= offset && offset < node.end) {
            if (analysis.compiler.isCallExpression(node)) {
                calls.push(node);
            }
            analysis.compiler.forEachChild(node, visit);
        }
    }
    visit(file);
    const call = calls.at(-1);
    if (call === undefined) {
        throw new Error('Callback source location does not identify an authoring call.');
    }
    return call;
}

function locatedCall(analysis: SourceAnalysis, origin: TestBodyOrigin): TypeScript.CallExpression {
    const location = resolveSourceLocation(origin.location);
    if (location.kind !== 'known' || location.line === null || location.column === null) {
        throw new Error('Type-test checking requires a known callback source location.');
    }
    const file = analysis.program.getSourceFile(location.file);
    if (file === undefined) {
        throw new Error(`Callback source is outside the checker project: ${location.file}`);
    }
    return callAtOffset(analysis, file, file.getPositionOfLineAndCharacter(location.line - 1, location.column - 1));
}

function preferredOrigin(origin: TestBodyOrigin): TestBodyOrigin {
    if (!isTableBodyOrigin(origin) || origin.forwarded === null) {
        return origin;
    }
    return resolveSourceLocation(origin.forwarded.location).kind === 'known' ? origin.forwarded : origin;
}

export function resolveBodyOrigin(analysis: SourceAnalysis, supplied: TestBodyOrigin): SourceBody {
    const origin = preferredOrigin(supplied);
    return declaredBody(analysis, bodyExpression(analysis, locatedCall(analysis, origin), origin));
}

export function namedBodyParameter(analysis: SourceAnalysis, body: SourceBody): TypeScript.Identifier {
    const parameter = body.parameters[0];
    if (parameter === undefined || !analysis.compiler.isIdentifier(parameter.name)) {
        throw new Error('Checking requires a named first callback parameter.');
    }
    return parameter.name;
}
