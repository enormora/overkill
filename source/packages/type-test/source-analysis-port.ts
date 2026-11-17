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
    (nodes: readonly TypeScript.Node[]): Promise<readonly (Symbol | undefined)[]>;
};
export type SourceChecker<Symbol extends SourceSymbol> = {
    readonly getSymbolAtLocation: SymbolLookup<Symbol>;
    readonly getShorthandAssignmentValueSymbol: (
        node: TypeScript.ShorthandPropertyAssignment
    ) => Promise<Symbol | undefined>;
    readonly getResolvedSignature: (node: TypeScript.Node) => Promise<SourceSignature>;
    readonly staticString: (node: TypeScript.Node) => Promise<null | string>;
};
export type SourceAnalysis = {
    readonly realpath: (path: string) => string;
    readonly compiler: CompilerSyntax;
    readonly checker: SourceChecker<AnalyzedSymbol>;
    readonly program: {
        readonly getSourceFile: (path: string) => Promise<TypeScript.SourceFile | undefined>;
        readonly getSourceFileNames: () => Promise<readonly string[]>;
    };
};
type SourceInput<Symbol extends SourceSymbol> = {
    readonly realpath: (path: string) => string;
    readonly compiler: CompilerSyntax;
    readonly checker: SourceChecker<Symbol> & {
        readonly getAliasedSymbol: (symbol: Symbol) => Promise<Symbol | undefined>;
    };
    readonly program: SourceAnalysis['program'];
};
const programSymbolIdentities = new WeakMap<SourceAnalysis['program'], WeakMap<SourceSymbol, AnalyzedSymbol>>();
function symbolIdentities(program: SourceAnalysis['program']): WeakMap<SourceSymbol, AnalyzedSymbol> {
    const existing = programSymbolIdentities.get(program);
    if (existing !== undefined) {
        return existing;
    }
    const symbols = new WeakMap<SourceSymbol, AnalyzedSymbol>();
    programSymbolIdentities.set(program, symbols);
    return symbols;
}
export function isSourceNode(input: readonly TypeScript.Node[] | TypeScript.Node): input is TypeScript.Node {
    return Object.hasOwn(input, 'kind');
}

export function createSourceAnalysis<Symbol extends SourceSymbol>(input: SourceInput<Symbol>): SourceAnalysis {
    const symbols = symbolIdentities(input.program);
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
    function getSymbolAtLocation(nodes: readonly TypeScript.Node[]): Promise<readonly (AnalyzedSymbol | undefined)[]>;
    async function getSymbolAtLocation(
        inputNode: readonly TypeScript.Node[] | TypeScript.Node
    ): Promise<AnalyzedSymbol | readonly (AnalyzedSymbol | undefined)[] | undefined> {
        if (isSourceNode(inputNode)) {
            return analyzed(await input.checker.getSymbolAtLocation(inputNode));
        }
        const resolved = await input.checker.getSymbolAtLocation(inputNode);
        return resolved.map(analyzed);
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
