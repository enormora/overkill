import * as syntax from 'typescript-beta/ast';
import {
    ModuleKind,
    ModuleResolutionKind,
    SymbolFlags,
    TypeFlags
} from 'typescript-beta/async';
import { CaseSensitivity, toRootedFilePath, pathKey } from 'typescript-beta/path';
import {
    createSourceAnalysis,
    isSourceNode,
    type SourceAnalysis,
    type SourceSymbol,
    type SourceSignature,
    type SourceChecker
} from '../packages/type-test/source-analysis-port.ts';

const compilerSyntax = {
    ...syntax,
    ModuleKind,
    ModuleResolutionKind,
    SymbolFlags,
    TypeFlags,
    isTypeAssertionExpression: syntax.isTypeAssertion,
    isStringLiteralLike: syntax.isStringLiteralLikeNode,
    isFunctionLike: syntax.isFunctionLikeDeclaration
};
export function sourceTree<Node extends syntax.Node>(node: Node): Node {
    node.forEachChild(function attach(child) {
        Reflect.set(child, 'parent', node);
        sourceTree(child);
    });
    return node;
}
export function sourceSymbol(name: string, declarations: readonly syntax.Declaration[]): SourceSymbol {
    return {
        name,
        flags: SymbolFlags.Function,
        declarations: declarations.map(function handle(declaration) {
            return {
                async resolve() {
                    return declaration;
                }
            };
        })
    };
}
export type SourceFixture = {
    readonly analysis: SourceAnalysis;
    readonly bindCanonicalPath: (from: string, to: string) => void;
    readonly bindSymbol: (node: syntax.Node, symbol: SourceSymbol) => void;
    readonly forgetSymbol: (node: syntax.Node) => void;
    readonly bindName: (name: string, symbol: SourceSymbol) => void;
    readonly addFile: (file: syntax.SourceFile) => void;
    readonly bindAlias: (alias: SourceSymbol, target: SourceSymbol) => void;
    readonly bindSignature: (node: syntax.Node, signature: SourceSignature) => void;
};
type SourceResponses = {
    readonly symbols: ReadonlyMap<syntax.Node, SourceSymbol>;
    readonly names: ReadonlyMap<string, SourceSymbol>;
    readonly files: ReadonlyMap<string, syntax.SourceFile>;
    readonly aliases: ReadonlyMap<SourceSymbol, SourceSymbol>;
    readonly signatures: ReadonlyMap<syntax.Node, SourceSignature>;
};
function sourceChecker(
    responses: SourceResponses
): SourceChecker<SourceSymbol> & {
    readonly getAliasedSymbol: (symbol: SourceSymbol) => Promise<SourceSymbol | undefined>;
} {
    function lookup(node: syntax.Node): SourceSymbol | undefined {
        return responses.symbols.get(node) ?? (syntax.isIdentifier(node) ? responses.names.get(node.text) : undefined);
    }
    function getSymbolAtLocation(node: syntax.Node): Promise<SourceSymbol | undefined>;
    function getSymbolAtLocation(nodes: readonly syntax.Node[]): Promise<(SourceSymbol | undefined)[]>;
    async function getSymbolAtLocation(
        input: readonly syntax.Node[] | syntax.Node
    ): Promise<(SourceSymbol | undefined)[] | SourceSymbol | undefined> {
        return isSourceNode(input) ? lookup(input) : input.map(lookup);
    }
    return {
        getSymbolAtLocation,
        async getAliasedSymbol(symbol) {
            return responses.aliases.get(symbol);
        },
        async getShorthandAssignmentValueSymbol(node) {
            return lookup(node.name);
        },
        async getResolvedSignature(node) {
            return responses.signatures.get(node) ?? { declaration: undefined };
        },
        async staticString() {
            return null;
        }
    };
}
export function sourceFixture(): SourceFixture {
    const canonical = new Map<string, string>();
    const symbols = new Map<syntax.Node, SourceSymbol>();
    const names = new Map<string, SourceSymbol>();
    const files = new Map<string, syntax.SourceFile>();
    const aliases = new Map<SourceSymbol, SourceSymbol>();
    const signatures = new Map<syntax.Node, SourceSignature>();
    const responses: SourceResponses = { symbols, names, files, aliases, signatures };
    return {
        bindCanonicalPath(from, to) {
            canonical.set(from, to);
        },
        bindSymbol(node, symbol) {
            symbols.set(node, symbol);
        },
        forgetSymbol(node) {
            symbols.delete(node);
        },
        bindName(name, symbol) {
            names.set(name, symbol);
        },
        addFile(file) {
            files.set(file.fileName, file);
        },
        bindAlias(alias, target) {
            aliases.set(alias, target);
        },
        bindSignature(node, signature) {
            signatures.set(node, signature);
        },
        analysis: createSourceAnalysis({
            realpath(path) {
                return canonical.get(path) ?? path;
            },
            compiler: compilerSyntax,
            program: {
                async getSourceFileNames() {
                    return Array.from(files.keys());
                },
                async getSourceFile(path) {
                    return files.get(path);
                }
            },
            checker: sourceChecker(responses)
        })
    };
}
export function sourceBody(statements: readonly syntax.Statement[]): syntax.ArrowFunction {
    return sourceTree(
        syntax.factory.createArrowFunction(
            undefined,
            undefined,
            [ syntax.factory.createParameterDeclaration(
                undefined,
                undefined,
                syntax.factory.createIdentifier('scope')
            ) ],
            undefined,
            syntax.factory.createToken(syntax.SyntaxKind.EqualsGreaterThanToken),
            syntax.factory.createBlock(statements)
        )
    );
}
export function sourceCall(expression: syntax.Expression, args: readonly syntax.Expression[]): syntax.CallExpression {
    return syntax.factory.createCallExpression(expression, undefined, undefined, args, syntax.NodeFlags.None);
}
export function sourceMember(expression: syntax.Expression, name: string): syntax.PropertyAccessExpression {
    return syntax.factory.createPropertyAccessExpression(
        expression,
        undefined,
        syntax.factory.createIdentifier(name),
        syntax.NodeFlags.None
    );
}

export function sourceFile(statements: readonly syntax.Statement[], fileName: string): syntax.SourceFile {
    const path = toRootedFilePath(fileName, undefined);
    const file = sourceTree(
        syntax.factory.createSourceFile(
            statements,
            syntax.factory.createToken(syntax.SyntaxKind.EndOfFile),
            'fixture',
            path,
            pathKey(path, CaseSensitivity.Sensitive)
        )
    );
    Reflect.set(file, 'getPositionOfLineAndCharacter', function position(line: number, character: number): number {
        if (line !== 0) {
            throw new Error('Expected a single-line source fixture.');
        }
        return character;
    });
    Reflect.set(file, 'getLineAndCharacterOfPosition', function coordinates(position: number): syntax.LineAndCharacter {
        return { line: 0, character: position };
    });
    return file;
}

export function sourceProperty(name: string, value: syntax.Expression): syntax.PropertyAssignment {
    return syntax.factory.createPropertyAssignment(
        undefined,
        syntax.factory.createIdentifier(name),
        undefined,
        syntax.factory.createKeywordTypeNode(syntax.SyntaxKind.UnknownKeyword),
        value
    );
}
