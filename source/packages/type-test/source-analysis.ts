import type * as TypeScript from 'typescript-beta/ast';
import { UnsupportedEvidenceError } from './unsupported-evidence-error.ts';
import type { SourceAnalysis, AnalyzedSymbol } from './source-analysis-port.ts';
import { compilerFileSystem } from './compiler-file-system.ts';

export type { SourceAnalysis } from './source-analysis-port.ts';

const programSymbols = new WeakMap<
    SourceAnalysis['program'],
    WeakMap<TypeScript.Node, Promise<AnalyzedSymbol | undefined>>
>();

function sourceSymbols(analysis: SourceAnalysis): WeakMap<TypeScript.Node, Promise<AnalyzedSymbol | undefined>> {
    const existing = programSymbols.get(analysis.program);
    if (existing !== undefined) {
        return existing;
    }
    const cache = new WeakMap<TypeScript.Node, Promise<AnalyzedSymbol | undefined>>();
    programSymbols.set(analysis.program, cache);
    return cache;
}

async function canonicalSourceFile(analysis: SourceAnalysis, path: string): Promise<TypeScript.SourceFile | undefined> {
    const canonical = compilerFileSystem.realpath(path);
    const names = await analysis.program.getSourceFileNames();
    const matches = names.filter(function sameFile(name) {
        return compilerFileSystem.realpath(name) === canonical;
    });
    if (matches.length > 1) {
        throw new UnsupportedEvidenceError(`Callback source has ambiguous project identities: ${path}`, undefined);
    }
    const [ name ] = matches;
    return name === undefined ? undefined : await analysis.program.getSourceFile(name);
}

export function sourceIdentifiers(
    analysis: SourceAnalysis,
    file: TypeScript.SourceFile
): readonly TypeScript.Identifier[] {
    const identifiers: TypeScript.Identifier[] = [];
    function visit(node: TypeScript.Node): void {
        if (analysis.compiler.isIdentifier(node)) {
            identifiers.push(node);
        }
        node.forEachChild(visit);
    }
    visit(file);
    return identifiers;
}

export async function loadSourceSymbols(
    analysis: SourceAnalysis,
    identifiers: readonly TypeScript.Identifier[]
): Promise<void> {
    const cache = sourceSymbols(analysis);
    const nodes = identifiers.filter(function unresolved(node) {
        return !cache.has(node) && !analysis.compiler.isShorthandPropertyAssignment(node.parent);
    });
    if (nodes.length === 0) {
        return;
    }
    const symbols = await analysis.checker.getSymbolAtLocation(nodes);
    if (symbols.length !== nodes.length) {
        throw new Error('Incomplete compiler symbol evidence.');
    }
    const aliases = new Map<AnalyzedSymbol, Promise<AnalyzedSymbol | undefined>>();
    const queries = nodes.map(async function cacheSymbol(node, index) {
        const symbol = symbols[index];
        const isAlias = symbol?.flags === analysis.compiler.SymbolFlags.Alias;
        const lookup = isAlias
            ? aliases.get(symbol) ?? symbol.alias()
            : Promise.resolve(symbol);
        if (isAlias) {
            aliases.set(symbol, lookup);
        }
        cache.set(node, lookup);
        return await lookup;
    });
    await Promise.all(queries);
}

export async function originalSourceFile(
    analysis: SourceAnalysis,
    path: string
): Promise<TypeScript.SourceFile | undefined> {
    const file = await analysis.program.getSourceFile(path) ?? await canonicalSourceFile(analysis, path);
    if (file !== undefined) {
        await loadSourceSymbols(analysis, sourceIdentifiers(analysis, file));
    }
    return file;
}

async function referencedSymbol(
    analysis: SourceAnalysis,
    node: TypeScript.Node
): Promise<AnalyzedSymbol | undefined> {
    const location = analysis.compiler.isIdentifier(node) ? node.parent : node;
    const symbol = await (analysis.compiler.isShorthandPropertyAssignment(location)
        ? analysis.checker.getShorthandAssignmentValueSymbol(location)
        : analysis.checker.getSymbolAtLocation(node));
    return symbol?.flags === analysis.compiler.SymbolFlags.Alias
        ? await symbol.alias()
        : symbol;
}

export async function sourceSymbol(
    analysis: SourceAnalysis,
    node: TypeScript.Node
): Promise<AnalyzedSymbol | undefined> {
    const cache = sourceSymbols(analysis);
    const existing = cache.get(node);
    if (existing !== undefined) {
        return await existing;
    }
    const lookup = referencedSymbol(analysis, node);
    cache.set(node, lookup);
    return await lookup;
}

export function sourceChildren(node: TypeScript.Node): readonly TypeScript.Node[] {
    const children: TypeScript.Node[] = [];
    node.forEachChild(function collect(child) {
        children.push(child);
    });
    return children;
}

export async function sourceDeclarations(
    symbol: Pick<AnalyzedSymbol, 'declarations'>
): Promise<readonly TypeScript.Declaration[]> {
    const declarations = await Promise.all(symbol.declarations.map(async function resolveDeclaration(handle) {
        return await handle.resolve();
    }));
    return declarations.filter(function resolved(declaration) {
        return declaration !== undefined;
    });
}

export function immutableInitializer(analysis: SourceAnalysis, node: TypeScript.Node): TypeScript.Node | undefined {
    const { compiler } = analysis;
    if (!compiler.isVariableDeclaration(node) || !compiler.isVariableDeclarationList(node.parent)) {
        return undefined;
    }
    return node.parent.getFirstToken()?.kind === compiler.SyntaxKind.ConstKeyword ? node.initializer : undefined;
}

export function transparentExpression(analysis: SourceAnalysis, node: TypeScript.Node): TypeScript.Node | undefined {
    const { compiler } = analysis;
    if (
        compiler.isParenthesizedExpression(node) || compiler.isAsExpression(node) ||
        compiler.isTypeAssertionExpression(node) || compiler.isSatisfiesExpression(node) ||
        compiler.isExpressionWithTypeArguments(node)
    ) {
        return node.expression;
    }
    return undefined;
}

function assignmentTarget(analysis: SourceAnalysis, node: TypeScript.Node): TypeScript.Node | undefined {
    if (!analysis.compiler.isBinaryExpression(node)) {
        return undefined;
    }
    const { kind } = node.operatorToken;
    return kind >= analysis.compiler.SyntaxKind.FirstAssignment && kind <= analysis.compiler.SyntaxKind.LastAssignment
        ? node.left
        : undefined;
}

function bindingAssignment(analysis: SourceAnalysis, node: TypeScript.Node): boolean {
    let { parent } = node;
    while (!analysis.compiler.isSourceFile(parent)) {
        if (analysis.compiler.isTypeNode(parent)) {
            return false;
        }
        const target = assignmentTarget(analysis, parent);
        if (target !== undefined && target.pos <= node.pos && node.end <= target.end) {
            return true;
        }
        parent = parent.parent;
    }
    return false;
}

export async function validateFunctionBinding(analysis: SourceAnalysis, name: TypeScript.Node): Promise<void> {
    const symbol = await sourceSymbol(analysis, name);
    if (symbol === undefined) {
        throw new UnsupportedEvidenceError('Cannot establish callback function binding.', undefined);
    }
    const bindingName = analysis.compiler.isIdentifier(name) ? name.text : symbol.name;
    async function visit(node: TypeScript.Node): Promise<void> {
        if (
            analysis.compiler.isIdentifier(node) && node.text === bindingName &&
            await sourceSymbol(analysis, node) === symbol && bindingAssignment(analysis, node)
        ) {
            throw new UnsupportedEvidenceError('Callback function bindings cannot be reassigned.', undefined);
        }
        for (const child of sourceChildren(node)) {
            await visit(child);
        }
    }
    const declarations = await sourceDeclarations(symbol);
    const files = new Set(declarations.map(function declarationFile(declaration) {
        return declaration.getSourceFile();
    }));
    for (const file of files) {
        if (!file.isDeclarationFile) {
            await visit(file);
        }
    }
}
