import { AST_NODE_TYPES as NodeType, type TSESLint, type TSESTree as Tree } from '@typescript-eslint/utils';
import ts from 'typescript';
import type { BindingAnalysis } from './binding-analysis.ts';
import type { BindingOrigin, FunctionNode } from './binding-origin.ts';

type Call = Readonly<Tree.CallExpression>;
type Node = Readonly<Tree.Node>;
type ScopeParameter = { readonly body: FunctionNode; readonly index: number; readonly propertyCase: boolean; };
type Author =
    | 'test' | 'throwingTest' | 'table' | 'defineParameterizedTestBody'
    | 'withRuntime' | 'withResource' | 'withResources' | 'withProperties' | 'property'
    | 'createEngine' | 'createTestFacade' | 'createTestCase' | 'createThrowingTestCase' | 'createPropertyTestCase'
    | 'createTable' | 'createWorkloadTestCase';

const testPackage = '@overkill-dev/test';
const enginePackage = '@overkill-dev/engine';
const propertyPackage = '@overkill-dev/property';
const testAuthors = [ 'test', 'table', 'defineParameterizedTestBody' ] as const;
const wrappers = [ 'withRuntime', 'withResource', 'withResources' ] as const;
const engineAuthors = [
    'createTestCase', 'createThrowingTestCase', 'createPropertyTestCase', 'createTable', 'createWorkloadTestCase'
] as const;

const publicAuthors = new Map<string, readonly Author[]>([
    [ testPackage, [ ...testAuthors, 'createTestFacade' ] ],
    [ testPackage + '/compatibility', [ 'throwingTest' ] ],
    [ testPackage + '/resources', wrappers ],
    [ testPackage + '/property', [ 'property', 'withProperties' ] ],
    [ propertyPackage, [ 'property', 'withProperties' ] ],
    [ enginePackage, [ 'createEngine', ...engineAuthors ] ]
]);

function listed(authors: readonly Author[], name: string | undefined): Author | null {
    return authors.find(author => author === name) ?? null;
}

function fromImport(origin: BindingOrigin): Author | null {
    return origin.root.kind === 'import' && origin.path.length === 1
        ? listed(publicAuthors.get(origin.root.source) ?? [], origin.path[0])
        : null;
}

function typeAt(checker: ts.TypeChecker, symbol: ts.Symbol): ts.Type {
    const target = (symbol.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(symbol) : symbol;
    return checker.getTypeOfSymbol(target);
}

function declaredAuthors(program: ts.Program): ReadonlyMap<ts.SignatureDeclaration, Author> {
    const checker = program.getTypeChecker();
    const signatures = new Map<ts.SignatureDeclaration, Author>();
    const modules = new Map<ts.Symbol, string>();

    function register(type: ts.Type, author: Author): void {
        for (const signature of type.getCallSignatures()) {
            const declaration = signature.getDeclaration();
            if (declaration !== undefined) {
                signatures.set(declaration, author);
            }
        }
    }

    for (const source of program.getSourceFiles()) {
        for (const statement of source.statements) {
            if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) {
                continue;
            }
            const specifier = statement.moduleSpecifier;
            if (specifier !== undefined && ts.isStringLiteral(specifier) && publicAuthors.has(specifier.text)) {
                const module = checker.getSymbolAtLocation(specifier);
                if (module !== undefined) {
                    modules.set(module, specifier.text);
                }
            }
        }
    }
    for (const [ module, name ] of modules) {
        for (const symbol of checker.getExportsOfModule(module)) {
            const author = listed(publicAuthors.get(name) ?? [], symbol.getName());
            if (author !== null) {
                register(typeAt(checker, symbol), author);
            }
            if (name === testPackage && symbol.getName() === 'createTestFacade') {
                for (const signature of typeAt(checker, symbol).getCallSignatures()) {
                    for (const member of signature.getReturnType().getProperties()) {
                        const memberAuthor = listed(testAuthors, member.getName());
                        if (memberAuthor !== null) {
                            register(typeAt(checker, member), memberAuthor);
                        }
                    }
                }
            }
        }
    }
    return signatures;
}

const signaturesByProgram = new WeakMap<ts.Program, ReadonlyMap<ts.SignatureDeclaration, Author>>();

function typedAuthor(sourceCode: Readonly<TSESLint.SourceCode>): (call: Call) => Author | null {
    const { program, esTreeNodeToTSNodeMap } = sourceCode.parserServices ?? {};
    if (program === null || program === undefined || esTreeNodeToTSNodeMap === undefined) {
        return () => null;
    }
    const checker = program.getTypeChecker();
    return function (call) {
        const node = esTreeNodeToTSNodeMap.get(call);
        if (!ts.isCallExpression(node)) {
            return null;
        }
        const declaration = checker.getResolvedSignature(node)?.getDeclaration();
        if (declaration === undefined) {
            return null;
        }
        const signatures = signaturesByProgram.get(program) ?? declaredAuthors(program);
        signaturesByProgram.set(program, signatures);
        return signatures.get(declaration) ?? null;
    };
}

function field(node: Node | undefined, key: string): Node | undefined {
    if (node?.type !== NodeType.ObjectExpression) {
        return undefined;
    }
    for (const property of node.properties.toReversed()) {
        if (property.type === NodeType.SpreadElement) {
            return undefined;
        }
        const name = property.key.type === NodeType.Identifier && !property.computed
            ? property.key.name
            : property.key.type === NodeType.Literal ? property.key.value : undefined;
        if (name === key && property.kind === 'init') {
            return property.value;
        }
    }
    return undefined;
}

function entries(node: Node | undefined): readonly Node[] {
    return node?.type === NodeType.ArrayExpression
        ? node.elements.flatMap(element => element === null ? [] : [ element ])
        : [];
}

export function scopeParameters(
    source: Readonly<TSESLint.SourceCode>,
    analysis: BindingAnalysis,
    calls: readonly Call[]
): readonly ScopeParameter[] {
    const fromSignature = typedAuthor(source);
    const owners: ScopeParameter[] = [];
    const seen = new Map<Node, Set<string>>();

    function authorOf(call: Call): Author | null {
        const origin = analysis.originOf(call.callee);
        if (origin === null) {
            return null;
        }
        if (origin.root.kind === 'call' && origin.path.length === 1) {
            const factory = authorOf(origin.root.node);
            if (factory === 'createEngine') {
                return listed(engineAuthors, origin.path[0]);
            }
            if (factory === 'createTestFacade') {
                return fromSignature(call);
            }
        }
        return origin.root.kind === 'import' ? fromImport(origin) ?? fromSignature(call) : null;
    }

    function register(node: Node | undefined, index: number, propertyCase: boolean): void {
        if (node === undefined) {
            return;
        }
        const positions = seen.get(node) ?? new Set<string>();
        const position = `${index}:${propertyCase}`;
        if (positions.has(position)) {
            return;
        }
        positions.add(position);
        seen.set(node, positions);
        const origin = analysis.originOf(node);
        if (origin?.root.kind === 'function' && origin.path.length === 0) {
            owners.push({ body: origin.root.node, index, propertyCase });
        }
        if (origin?.root.kind === 'call' && origin.path.length === 0) {
            const call = origin.root.node;
            const author = authorOf(call);
            if (author === 'withProperties') {
                register(call.arguments[0], index, true);
            }
            if (author !== null && wrappers.some(wrapper => wrapper === author)) {
                register(call.arguments[1], index, propertyCase);
            }
        }
    }

    function registerTrial(call: Call): void {
        const first = call.arguments[0];
        register(call.arguments[1] ?? field(first, 'test'), 1, false);
    }

    for (const call of calls) {
        const first = call.arguments[0];
        const author = authorOf(call);
        switch (author) {
            case 'test':
            case 'throwingTest':
                register(call.arguments[1] ?? field(first, 'body'), 0, false);
                break;
            case 'table':
                register(field(first, 'test'), 0, false);
                break;
            case 'defineParameterizedTestBody':
            case 'withProperties':
                register(first, 0, author === 'withProperties');
                break;
            case 'createTable':
            case 'createWorkloadTestCase':
                for (const entry of entries(field(first, author === 'createTable' ? 'cases' : 'workloads'))) {
                    register(field(entry, 'body'), 0, false);
                }
                break;
            case 'createTestCase':
            case 'createThrowingTestCase':
            case 'createPropertyTestCase':
                register(field(first, 'body'), 0, author === 'createPropertyTestCase');
                break;
            case 'property':
                registerTrial(call);
                break;
        }
    }
    for (const call of calls) {
        const origin = analysis.originOf(call.callee);
        if (origin?.root.kind === 'parameter' && origin.path.length === 1 && origin.path[0] === 'forall') {
            const { owner, index } = origin.root;
            if (owners.some(candidate => candidate.body === owner && candidate.index === index && candidate.propertyCase)) {
                registerTrial(call);
            }
        }
    }
    return owners;
}
