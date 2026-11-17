import type * as TypeScript from 'typescript-beta/ast';
import { resolveSourceLocation, isTableBodyOrigin, type TestBodyOrigin } from '../engine/engine.entry-point.ts';
import { UnsupportedEvidenceError } from './unsupported-evidence-error.ts';
import type { CompilerSyntax } from './installed-compiler.ts';
import {
    sourceSymbol,
    sourceDeclarations,
    originalSourceFile,
    immutableInitializer,
    transparentExpression,
    validateFunctionBinding,
    type SourceAnalysis
} from './source-analysis.ts';
import { validateCallbackStorage, supportedCall } from './source-options.ts';

type ExpressionBody = TypeScript.ArrowFunction | TypeScript.FunctionExpression;
type DeclarationBody = TypeScript.FunctionDeclaration | TypeScript.MethodDeclaration;
export type SourceBody = Readonly<DeclarationBody | ExpressionBody>;
function isSourceBody(compiler: CompilerSyntax, node: TypeScript.Node): node is SourceBody {
    return compiler.isArrowFunction(node) || compiler.isFunctionExpression(node) ||
        compiler.isFunctionDeclaration(node) || compiler.isMethodDeclaration(node);
}
async function callbackDeclarations(
    analysis: SourceAnalysis,
    expression: TypeScript.Node
): Promise<readonly TypeScript.Declaration[]> {
    const symbol = await sourceSymbol(analysis, expression);
    return symbol === undefined ? [] : await sourceDeclarations(symbol);
}
function constantExpression(
    analysis: SourceAnalysis,
    declarations: readonly TypeScript.Declaration[]
): TypeScript.Node {
    const declaration = declarations.length === 1 ? declarations[0] : undefined;
    const initializer = declaration === undefined ? undefined : immutableInitializer(analysis, declaration);
    if (initializer === undefined) {
        throw new UnsupportedEvidenceError('Unsupported or ambiguous callback source ownership.', undefined);
    }
    return initializer;
}
async function declarationExpression(analysis: SourceAnalysis, expression: TypeScript.Node): Promise<TypeScript.Node> {
    const declarations = await callbackDeclarations(analysis, expression);
    const implementations = declarations.filter(function implemented(node) {
        return isSourceBody(analysis.compiler, node) && node.body !== undefined;
    });
    const [ implementation ] = implementations;
    if (implementations.length === 1 && implementation !== undefined) {
        if (analysis.compiler.isFunctionDeclaration(implementation)) {
            await validateFunctionBinding(analysis, implementation.name ?? expression);
        }
        return implementation;
    }
    return constantExpression(analysis, declarations);
}
async function nextExpression(analysis: SourceAnalysis, node: TypeScript.Node): Promise<TypeScript.Node | undefined> {
    return transparentExpression(analysis, node) ??
        (analysis.compiler.isIdentifier(node) ? await declarationExpression(analysis, node) : undefined);
}
async function originalExpression(analysis: SourceAnalysis, initial: TypeScript.Node): Promise<TypeScript.Node> {
    let expression = initial;
    let next = await nextExpression(analysis, expression);
    const seen = new Set<TypeScript.Node>([ initial ]);
    while (next !== undefined) {
        if (seen.has(next)) {
            throw new UnsupportedEvidenceError('Cyclic callback source ownership.', undefined);
        }
        seen.add(next);
        expression = next;
        next = await nextExpression(analysis, expression);
    }
    return expression;
}
export async function declaredBody(analysis: SourceAnalysis, initial: TypeScript.Node): Promise<SourceBody> {
    let expression = initial;
    while (
        analysis.compiler.isParenthesizedExpression(expression) ||
        analysis.compiler.isExpressionWithTypeArguments(expression)
    ) {
        expression = expression.expression;
    }
    const resolved = await originalExpression(analysis, expression);
    if (isSourceBody(analysis.compiler, resolved) && resolved.body !== undefined) {
        return resolved;
    }
    throw new UnsupportedEvidenceError('Callback source is not a statically identifiable function body.', undefined);
}
async function propertyExpression(
    analysis: SourceAnalysis,
    property: TypeScript.ObjectLiteralElementLike
): Promise<TypeScript.Node> {
    if (analysis.compiler.isPropertyAssignment(property)) {
        return property.initializer;
    }
    if (analysis.compiler.isMethodDeclaration(property)) {
        return property;
    }
    if (analysis.compiler.isShorthandPropertyAssignment(property)) {
        return await declarationExpression(analysis, property);
    }
    throw new UnsupportedEvidenceError('Unsupported callback property source.', undefined);
}
async function objectField(analysis: SourceAnalysis, input: TypeScript.Node, field: string): Promise<TypeScript.Node> {
    await validateCallbackStorage(analysis, input);
    const node = await originalExpression(analysis, input);
    if (!analysis.compiler.isObjectLiteralExpression(node)) {
        throw new UnsupportedEvidenceError('Unsupported callback options expression.', undefined);
    }
    const property = node.properties.findLast(function named(entry) {
        return !analysis.compiler.isSpreadAssignment(entry) &&
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
        throw new UnsupportedEvidenceError('Callback options contain a potentially overriding property.', undefined);
    }
    if (property === undefined) {
        throw new UnsupportedEvidenceError(`Callback definition has no explicit ${field} source.`, undefined);
    }
    return await propertyExpression(analysis, property);
}
async function validatedCases(analysis: SourceAnalysis, input: TypeScript.Node): Promise<TypeScript.Node> {
    const source = await objectField(analysis, input, 'cases');
    await validateCallbackStorage(analysis, source);
    return source;
}
async function tableCaseExpression(
    analysis: SourceAnalysis,
    input: TypeScript.Node,
    index: number
): Promise<TypeScript.Node> {
    const cases = await originalExpression(analysis, await validatedCases(analysis, input));
    if (!analysis.compiler.isArrayLiteralExpression(cases)) {
        throw new UnsupportedEvidenceError('Low-level table cases require static source ownership.', undefined);
    }
    if (cases.elements.some(analysis.compiler.isSpreadElement)) {
        throw new UnsupportedEvidenceError('Low-level table case spreads have ambiguous source ownership.', undefined);
    }
    const row = cases.elements[index];
    if (row === undefined) {
        throw new UnsupportedEvidenceError('Table case source index is missing.', undefined);
    }
    return await objectField(analysis, row, 'body');
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
async function expressionName(analysis: SourceAnalysis, expression: TypeScript.Node): Promise<string | undefined> {
    const location = analysis.compiler.isPropertyAccessExpression(expression) ? expression.name : expression;
    const symbol = await sourceSymbol(analysis, location);
    return symbol?.name;
}
async function authoringName(
    analysis: SourceAnalysis,
    expression: TypeScript.Node,
    seen: ReadonlySet<TypeScript.Node>
): Promise<string | undefined> {
    const name = await expressionName(analysis, expression);
    if (name !== undefined && authoringNames.has(name)) {
        return name;
    }
    if (seen.has(expression)) {
        throw new UnsupportedEvidenceError('Cyclic authoring API alias.', undefined);
    }
    const next = await nextExpression(analysis, expression);
    return next === undefined ? name : await authoringName(analysis, next, new Set([ ...seen, expression ]));
}
async function callName(analysis: SourceAnalysis, call: TypeScript.CallExpression): Promise<string | undefined> {
    return await authoringName(analysis, call.expression, new Set());
}
async function positionalBody(
    analysis: SourceAnalysis,
    call: TypeScript.CallExpression,
    first: TypeScript.Node,
    name: string | undefined
): Promise<TypeScript.Node> {
    const positional = [ 'test', 'withResource', 'withResources', 'withRuntime' ];
    const body = call.arguments[1];
    if (name !== undefined && positional.includes(name) && body !== undefined) {
        return body;
    }
    return await objectField(analysis, first, name === 'table' ? 'test' : 'body');
}
async function bodyExpression(
    analysis: SourceAnalysis,
    call: TypeScript.CallExpression,
    origin: TestBodyOrigin
): Promise<TypeScript.Node> {
    const name = await callName(analysis, call);
    const first = call.arguments[0];
    if (first === undefined) {
        throw new UnsupportedEvidenceError('Callback construction has no arguments.', undefined);
    }
    if (name === 'defineParameterizedTestBody') {
        return first;
    }
    if (name === 'createTable' && isTableBodyOrigin(origin)) {
        return await tableCaseExpression(analysis, first, origin.tableIndex);
    }
    return await positionalBody(analysis, call, first, name);
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
            node.forEachChild(visit);
        }
    }
    visit(file);
    const call = calls.at(-1);
    if (call === undefined) {
        throw new UnsupportedEvidenceError('Callback source location does not identify an authoring call.', undefined);
    }
    return call;
}
async function locatedCall(analysis: SourceAnalysis, origin: TestBodyOrigin): Promise<TypeScript.CallExpression> {
    const location = resolveSourceLocation(origin.location);
    if (location.kind !== 'known' || location.line === null || location.column === null) {
        throw new UnsupportedEvidenceError('Type-test checking requires a known callback source location.', undefined);
    }
    const file = await originalSourceFile(analysis, location.file);
    if (file === undefined) {
        throw new UnsupportedEvidenceError(
            `Callback source is outside the checker project: ${location.file}`,
            undefined
        );
    }
    const call = callAtOffset(
        analysis,
        file,
        file.getPositionOfLineAndCharacter(location.line - 1, location.column - 1)
    );
    if (!await supportedCall(analysis, call)) {
        throw new UnsupportedEvidenceError('Callback anchor does not identify a supported authoring API.', undefined);
    }
    return call;
}
function preferredOrigin(origin: TestBodyOrigin): TestBodyOrigin {
    if (!isTableBodyOrigin(origin) || origin.forwarded === null) {
        return origin;
    }
    return resolveSourceLocation(origin.forwarded.location).kind === 'known' ? origin.forwarded : origin;
}
export async function resolveBodyOrigin(analysis: SourceAnalysis, supplied: TestBodyOrigin): Promise<SourceBody> {
    const origin = preferredOrigin(supplied);
    return await declaredBody(analysis, await bodyExpression(analysis, await locatedCall(analysis, origin), origin));
}
export function namedBodyParameter(analysis: SourceAnalysis, body: SourceBody): TypeScript.Identifier {
    const parameter = body.parameters[0];
    if (parameter === undefined || !analysis.compiler.isIdentifier(parameter.name)) {
        throw new UnsupportedEvidenceError('Checking requires a named first callback parameter.', undefined);
    }
    return parameter.name;
}
