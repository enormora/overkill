import type * as CompilerApi from 'typescript-beta/async';
import type * as TypeScript from 'typescript-beta/ast';
import type { CompilerSyntax } from './installed-compiler.ts';

export type SourceDeclaration = { readonly resolve: () => Promise<TypeScript.Declaration | undefined>; };
export type SourceSymbol = {
    readonly name: string;
    readonly flags: CompilerApi.Symbol['flags'];
    readonly declarations: readonly SourceDeclaration[];
};
export type AnalyzedSymbol = SourceSymbol & { readonly alias: () => Promise<AnalyzedSymbol | undefined>; };
export type SourceSignature = { readonly declaration: SourceDeclaration | undefined; };
type SymbolLookup<Symbol extends SourceSymbol> = {
    (node: TypeScript.Node): Promise<Symbol | undefined>;
    (nodes: readonly TypeScript.Node[]): Promise<(Symbol | undefined)[]>;
};
export type SourceChecker<Symbol extends SourceSymbol> = {
    readonly getSymbolAtLocation: SymbolLookup<Symbol>;
    readonly getShorthandAssignmentValueSymbol: (
        node: TypeScript.ShorthandPropertyAssignment
    ) => Promise<Symbol | undefined>;
    readonly getResolvedSignature: (node: TypeScript.Node) => Promise<SourceSignature>;
    readonly staticString: (node: TypeScript.Node) => Promise<string | null>;
};
export type SourceAnalysis = {
    readonly compiler: CompilerSyntax;
    readonly checker: SourceChecker<AnalyzedSymbol>;
    readonly program: Pick<CompilerApi.Program, 'getSourceFileNames' | 'getSourceFile'>;
};
type SourceInput<Symbol extends SourceSymbol> = {
    readonly compiler: CompilerSyntax;
    readonly checker: SourceChecker<Symbol> & {
        readonly getAliasedSymbol: (symbol: Symbol) => Promise<Symbol | undefined>;
    };
    readonly program: SourceAnalysis['program'];
};
export function createSourceAnalysis<Symbol extends SourceSymbol>(input: SourceInput<Symbol>): SourceAnalysis {
    const symbols = new WeakMap<Symbol, AnalyzedSymbol>();
    function analyzed(symbol: Symbol | undefined): AnalyzedSymbol | undefined {
        if (symbol === undefined) {
            return undefined;
        }
        const existing = symbols.get(symbol);
        if (existing !== undefined) {
            return existing;
        }
        const result: AnalyzedSymbol = {
            name: symbol.name,
            flags: symbol.flags,
            declarations: symbol.declarations,
            async alias() {
                return analyzed(await input.checker.getAliasedSymbol(symbol));
            }
        };
        symbols.set(symbol, result);
        return result;
    }
    function getSymbolAtLocation(node: TypeScript.Node): Promise<AnalyzedSymbol | undefined>;
    function getSymbolAtLocation(nodes: readonly TypeScript.Node[]): Promise<(AnalyzedSymbol | undefined)[]>;
    async function getSymbolAtLocation(
        inputNode: TypeScript.Node | readonly TypeScript.Node[]
    ): Promise<AnalyzedSymbol | undefined | (AnalyzedSymbol | undefined)[]> {
        return 'kind' in inputNode
            ? analyzed(await input.checker.getSymbolAtLocation(inputNode))
            : (await input.checker.getSymbolAtLocation(inputNode)).map(analyzed);
    }
    return {
        ...input,
        checker: {
            ...input.checker,
            getSymbolAtLocation,
            async getShorthandAssignmentValueSymbol(node) {
                return analyzed(await input.checker.getShorthandAssignmentValueSymbol(node));
            },
            getResolvedSignature: input.checker.getResolvedSignature.bind(input.checker),
            staticString: input.checker.staticString.bind(input.checker)
        }
    };
}
