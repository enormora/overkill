import { AST_NODE_TYPES as NodeType, type TSESLint, type TSESTree as Tree } from '@typescript-eslint/utils';
import { match } from 'ts-pattern';
import ts from 'typescript';
import type { BindingAnalysis } from './binding-analysis.ts';
import type { BindingOrigin, FunctionNode } from './binding-origin.ts';

type Call = Readonly<Tree.CallExpression>;
type Node = Readonly<Tree.Node>;
type ScopeParameter = { readonly body: FunctionNode; readonly index: number; readonly propertyCase: boolean; };
const testPackage = '@overkill-dev/test';
const enginePackage = '@overkill-dev/engine';
const propertyPackage = '@overkill-dev/property';
const testAuthors = [ 'test', 'table', 'defineParameterizedTestBody' ] as const;
const wrappers = [ 'withRuntime', 'withResource', 'withResources' ] as const;
const engineAuthors = [
    'createTestCase',
    'createThrowingTestCase',
    'createPropertyTestCase',
    'createTable',
    'createWorkloadTestCase'
] as const;

const authoringExports = [
    [ testPackage, [ ...testAuthors, 'createTestFacade' ] ],
    [ `${testPackage}/compatibility`, [ 'throwingTest' ] ],
    [ `${testPackage}/resources`, wrappers ],
    [ `${testPackage}/property`, [ 'property', 'withProperties' ] ],
    [ propertyPackage, [ 'property', 'withProperties' ] ],
    [ enginePackage, [ 'createEngine', ...engineAuthors ] ]
] as const;

type Author = typeof authoringExports[number][1][number];
const publicAuthors = new Map<string, readonly Author[]>(authoringExports);

function listed(authors: readonly Author[], name: string | undefined): Author | null {
    return authors.find(function (author) {
        return author === name;
    }) ?? null;
}

function fromImport(origin: BindingOrigin): Author | null {
    return origin.root.kind === 'import' && origin.path.length === 1
        ? listed(publicAuthors.get(origin.root.source) ?? [], origin.path[0])
        : null;
}

function typeAt(checker: ts.TypeChecker, symbol: Readonly<ts.Symbol>): ts.Type {
    const target = symbol.declarations?.some(ts.isExportSpecifier) === true ? checker.getAliasedSymbol(symbol) : symbol;
    return checker.getTypeOfSymbol(target);
}

function moduleSpecifier(statement: Readonly<ts.Statement>): ts.Expression | undefined {
    return ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)
        ? statement.moduleSpecifier
        : undefined;
}

function authoringModules(program: ts.Program): ReadonlyMap<ts.Symbol, string> {
    const checker = program.getTypeChecker();
    const modules = new Map<ts.Symbol, string>();

    function record(statement: Readonly<ts.Statement>): void {
        const specifier = moduleSpecifier(statement);
        if (specifier !== undefined && ts.isStringLiteral(specifier) && publicAuthors.has(specifier.text)) {
            const module = checker.getSymbolAtLocation(specifier);
            if (module !== undefined) {
                modules.set(module, specifier.text);
            }
        }
    }

    for (const source of program.getSourceFiles()) {
        source.statements.forEach(record);
    }
    return modules;
}

function declaredAuthors(program: ts.Program): ReadonlyMap<ts.SignatureDeclaration, Author> {
    const checker = program.getTypeChecker();
    const signatures = new Map<ts.SignatureDeclaration, Author>();

    function register(type: Readonly<ts.Type>, author: Author): void {
        for (const signature of type.getCallSignatures()) {
            signatures.set(signature.getDeclaration(), author);
        }
    }

    function registerFacade(type: Readonly<ts.Type>): void {
        for (const signature of type.getCallSignatures()) {
            const members = signature.getReturnType().getProperties();
            for (const member of members) {
                const author = listed(testAuthors, member.getName());
                if (author !== null) {
                    register(typeAt(checker, member), author);
                }
            }
        }
    }

    function registerExport(name: string, symbol: Readonly<ts.Symbol>): void {
        const author = listed(publicAuthors.get(name) ?? [], symbol.getName());
        if (author !== null) {
            const type = typeAt(checker, symbol);
            register(type, author);
            if (name === testPackage && author === 'createTestFacade') {
                registerFacade(type);
            }
        }
    }

    const modules = authoringModules(program);
    modules.forEach(function (name, module) {
        const exports = checker.getExportsOfModule(module);
        for (const symbol of exports) {
            registerExport(name, symbol);
        }
    });
    return signatures;
}

const signaturesByProgram = new WeakMap<ts.Program, ReadonlyMap<ts.SignatureDeclaration, Author>>();

function typedAuthor(sourceCode: Readonly<TSESLint.SourceCode>): (call: Call) => Author | null {
    const { program, esTreeNodeToTSNodeMap } = sourceCode.parserServices ?? {};
    if (program === null || program === undefined || esTreeNodeToTSNodeMap === undefined) {
        return function () {
            return null;
        };
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

function propertyName(property: Readonly<Tree.Property>): unknown {
    if (property.key.type === NodeType.Identifier && !property.computed) {
        return property.key.name;
    }
    return property.key.type === NodeType.Literal ? property.key.value : undefined;
}

function field(node: Node | undefined, key: string): Node | undefined {
    if (node?.type !== NodeType.ObjectExpression) {
        return undefined;
    }
    const property = node.properties.toReversed().find(function (candidate) {
        return candidate.type === NodeType.SpreadElement || propertyName(candidate) === key && candidate.kind === 'init';
    });
    return property?.type === NodeType.Property ? property.value : undefined;
}

function entries(node: Node | undefined): readonly Node[] {
    return node?.type === NodeType.ArrayExpression
        ? node.elements.flatMap(function (element) {
            return element === null ? [] : [ element ];
        })
        : [];
}

type AuthorOf = (call: Call) => Author | null;
type RegisterBody = (node: Node | undefined, index: number, propertyCase: boolean) => void;

function authorResolver(source: Readonly<TSESLint.SourceCode>, analysis: BindingAnalysis): AuthorOf {
    const fromSignature = typedAuthor(source);

    function memberOf(call: Call, origin: BindingOrigin, resolve: AuthorOf): Author | null {
        if (origin.root.kind !== 'call' || origin.path.length !== 1) {
            return null;
        }
        return match(resolve(origin.root.node))
            .with('createEngine', function () {
                return listed(engineAuthors, origin.path[0]);
            })
            .with('createTestFacade', function () {
                return fromSignature(call);
            })
            .otherwise(function () {
                return null;
            });
    }

    function authorOf(call: Call): Author | null {
        const origin = analysis.originOf(call.callee);
        if (origin === null) {
            return null;
        }
        return origin.root.kind === 'import' ? fromImport(origin) ?? fromSignature(call) : memberOf(call, origin, authorOf);
    }

    return authorOf;
}

type BodyPosition = Pick<ScopeParameter, 'index' | 'propertyCase'>;

function bodyRegistrar(
    analysis: BindingAnalysis,
    authorOf: AuthorOf,
    addOwner: (owner: ScopeParameter) => void
): RegisterBody {
    const seen = new Map<Node, BodyPosition[]>();

    function firstVisit(node: Node, index: number, propertyCase: boolean): boolean {
        const positions = seen.get(node) ?? [];
        const previous = positions.some(function (position) {
            return position.index === index && position.propertyCase === propertyCase;
        });
        positions.push({ index, propertyCase });
        seen.set(node, positions);
        return !previous;
    }

    function registerWrapped(call: Call, position: BodyPosition, visit: RegisterBody): void {
        const author = authorOf(call);
        if (author === 'withProperties') {
            visit(call.arguments[0], position.index, true);
        } else if (listed(wrappers, author ?? undefined) !== null) {
            visit(call.arguments[1], position.index, position.propertyCase);
        }
    }

    function register(node: Node | undefined, index: number, propertyCase: boolean): void {
        if (node === undefined || !firstVisit(node, index, propertyCase)) {
            return;
        }
        const origin = analysis.originOf(node);
        if (origin?.path.length !== 0) {
            return;
        }
        match(origin.root)
            .with({ kind: 'function' }, function ({ node: body }) {
                addOwner({ body, index, propertyCase });
            })
            .with({ kind: 'call' }, function ({ node: call }) {
                registerWrapped(call, { index, propertyCase }, register);
            })
            .otherwise(function () {
                return undefined;
            });
    }

    return register;
}

function registerTrial(register: RegisterBody, call: Call): void {
    register(call.arguments[1] ?? field(call.arguments[0], 'test'), 1, false);
}

function registerAuthor(register: RegisterBody, call: Call, author: Author | null): void {
    const first = call.arguments[0];
    match(author)
        .with('test', 'throwingTest', function () {
            register(call.arguments[1] ?? field(first, 'body'), 0, false);
        })
        .with('table', function () {
            register(field(first, 'test'), 0, false);
        })
        .with('defineParameterizedTestBody', 'withProperties', function (matched) {
            register(first, 0, matched === 'withProperties');
        })
        .with('createTable', 'createWorkloadTestCase', function (matched) {
            const definitions = entries(field(first, matched === 'createTable' ? 'cases' : 'workloads'));
            for (const entry of definitions) {
                register(field(entry, 'body'), 0, false);
            }
        })
        .with('createTestCase', 'createThrowingTestCase', 'createPropertyTestCase', function (matched) {
            register(field(first, 'body'), 0, matched === 'createPropertyTestCase');
        })
        .with('property', function () {
            registerTrial(register, call);
        })
        .otherwise(function () {
            return undefined;
        });
}

function ownsNestedTrial(origin: BindingOrigin | null, owners: readonly ScopeParameter[]): boolean {
    if (origin?.root.kind !== 'parameter' || origin.path.length !== 1 || origin.path[0] !== 'forall') {
        return false;
    }
    const { owner, index } = origin.root;
    return owners.some(function (candidate) {
        return candidate.body === owner && candidate.index === index && candidate.propertyCase;
    });
}

export function scopeParameters(
    source: Readonly<TSESLint.SourceCode>,
    analysis: BindingAnalysis,
    calls: readonly Call[]
): readonly ScopeParameter[] {
    const authorOf = authorResolver(source, analysis);
    const owners: ScopeParameter[] = [];
    const register = bodyRegistrar(analysis, authorOf, function addOwner(owner) {
        owners.push(owner);
    });
    for (const call of calls) {
        registerAuthor(register, call, authorOf(call));
    }
    for (const call of calls) {
        if (ownsNestedTrial(analysis.originOf(call.callee), owners)) {
            registerTrial(register, call);
        }
    }
    return owners;
}
