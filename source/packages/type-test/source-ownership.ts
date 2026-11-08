import type TypeScript from 'typescript';
import { resolveSourceLocation, isTableBodyOrigin, type TestBodyOrigin } from '../engine/engine.entry-point.ts';

import {
    sourceSymbol,
    immutableInitializer,
    transparentExpression,
    validateFunctionBinding,
    type SourceAnalysis
} from './source-analysis.ts';
import { validateCallbackStorage, supportedCall } from './source-options.ts';

type ExpressionBody = TypeScript.ArrowFunction | TypeScript.FunctionExpression;
type DeclarationBody = TypeScript.FunctionDeclaration | TypeScript.MethodDeclaration;
export type SourceBody = Readonly<DeclarationBody | ExpressionBody>;
function isSourceBody(compiler: typeof TypeScript, node: TypeScript.Node): node is SourceBody {
    return compiler.isArrowFunction(node) || compiler.isFunctionExpression(node) ||
        compiler.isFunctionDeclaration(node) || compiler.isMethodDeclaration(node);
}

function callbackDeclarations(
    analysis: SourceAnalysis,
    expression: TypeScript.Node
): readonly TypeScript.Declaration[] {
    return sourceSymbol(analysis, expression)?.declarations ?? [];
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
    if (implementations.length === 1 && implementation !== undefined) {
        if (analysis.compiler.isFunctionDeclaration(implementation)) {
            validateFunctionBinding(analysis, implementation.name ?? expression);
        }
        return implementation;
    }
    return constantExpression(analysis, declarations);
}

function nextExpression(analysis: SourceAnalysis, node: TypeScript.Node): TypeScript.Node | undefined {
    return transparentExpression(analysis, node) ??
        (analysis.compiler.isIdentifier(node) ? declarationExpression(analysis, node) : undefined);
}

function originalExpression(analysis: SourceAnalysis, initial: TypeScript.Node): TypeScript.Node {
    let expression = initial;
    let next = nextExpression(analysis, expression);
    const seen = new Set<TypeScript.Node>([ initial ]);
    while (next !== undefined) {
        if (seen.has(next)) {
            throw new Error('Cyclic callback source ownership.');
        }
        seen.add(next);
        expression = next;
        next = nextExpression(analysis, expression);
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
    validateCallbackStorage(analysis, input);
    const node = originalExpression(analysis, input);
    if (!analysis.compiler.isObjectLiteralExpression(node)) {
        throw new Error('Unsupported callback options expression.');
    }
    const property = node.properties.findLast(function named(entry) {
        return entry.name !== undefined &&
            (analysis.compiler.isIdentifier(entry.name) || analysis.compiler.isStringLiteral(entry.name)) &&
            entry.name.text === field;
    });
    if (
        property !== undefined &&
        node.properties.slice(node.properties.indexOf(property) + 1).some(function uncertain(entry) {
            return analysis.compiler.isSpreadAssignment(entry) ||
                analysis.compiler.isComputedPropertyName(entry.name);
        })
    ) {
        throw new Error('Callback options contain a potentially overriding property.');
    }
    if (property === undefined) {
        throw new Error(`Callback definition has no explicit ${field} source.`);
    }
    return propertyExpression(analysis, property);
}

function validatedCases(analysis: SourceAnalysis, input: TypeScript.Node): TypeScript.Node {
    const source = objectField(analysis, input, 'cases');
    validateCallbackStorage(analysis, source);
    return source;
}

function tableCaseExpression(analysis: SourceAnalysis, input: TypeScript.Node, index: number): TypeScript.Node {
    const cases = originalExpression(analysis, validatedCases(analysis, input));
    if (!analysis.compiler.isArrayLiteralExpression(cases)) {
        throw new Error('Low-level table cases require static source ownership.');
    }
    if (cases.elements.some(analysis.compiler.isSpreadElement)) {
        throw new Error('Low-level table case spreads have ambiguous source ownership.');
    }
    const row = cases.elements[index];
    if (row === undefined) {
        throw new Error('Table case source index is missing.');
    }
    return objectField(analysis, row, 'body');
}

const authoringNames = new Set([
    'test',
    'table',
    'createTestCase',
    'createTable',
    'withResource',
    'withResources',
    'withRuntime',
    'defineParameterizedTestBody'
]);

function expressionName(analysis: SourceAnalysis, expression: TypeScript.Node): string | undefined {
    const location = analysis.compiler.isPropertyAccessExpression(expression) ? expression.name : expression;
    return sourceSymbol(analysis, location)?.name;
}

function authoringName(
    analysis: SourceAnalysis,
    expression: TypeScript.Node,
    seen: ReadonlySet<TypeScript.Node>
): string | undefined {
    const name = expressionName(analysis, expression);
    if (name !== undefined && authoringNames.has(name)) {
        return name;
    }
    if (seen.has(expression)) {
        throw new Error('Cyclic authoring API alias.');
    }
    const next = nextExpression(analysis, expression);
    return next === undefined ? name : authoringName(analysis, next, new Set([ ...seen, expression ]));
}

function callName(analysis: SourceAnalysis, call: TypeScript.CallExpression): string | undefined {
    return authoringName(analysis, call.expression, new Set());
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
    const call = callAtOffset(
        analysis,
        file,
        file.getPositionOfLineAndCharacter(location.line - 1, location.column - 1)
    );
    if (!supportedCall(analysis, call)) {
        throw new Error('Callback anchor does not identify a supported authoring API.');
    }
    return call;
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
