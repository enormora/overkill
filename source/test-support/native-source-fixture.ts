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
    type SourceAnalysis,
    type SourceSymbol,
    type SourceSignature,
    type SourceChecker
} from '../packages/type-test/source-analysis-port.ts';

export const compilerSyntax = {
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
    readonly symbols: Map<syntax.Node, SourceSymbol>;
    readonly names: Map<string, SourceSymbol>;
    readonly files: Map<string, syntax.SourceFile>;
    readonly aliases: Map<SourceSymbol, SourceSymbol>;
    readonly signatures: Map<syntax.Node, SourceSignature>;
};
type SourceResponses = Pick<SourceFixture, 'symbols' | 'names' | 'files' | 'aliases' | 'signatures'>;
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
        input: syntax.Node | readonly syntax.Node[]
    ): Promise<SourceSymbol | undefined | (SourceSymbol | undefined)[]> {
        return 'kind' in input ? lookup(input) : input.map(lookup);
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
    const responses: SourceResponses = {
        symbols: new Map(),
        names: new Map(),
        files: new Map(),
        aliases: new Map(),
        signatures: new Map()
    };
    return {
        ...responses,
        analysis: createSourceAnalysis({
            compiler: compilerSyntax,
            program: {
                async getSourceFileNames() {
                    return Array.from(responses.files.keys());
                },
                async getSourceFile(path) {
                    return responses.files.get(path);
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
