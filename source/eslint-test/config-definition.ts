import type { Linter } from 'eslint';
import type { AssertionResult, Suite, TestScope } from '../packages/engine/engine.entry-point.ts';
import type { Generator as PropertyGenerator } from '../packages/property/property.entry-point.ts';

export type ConfigProjectDependencies = {
    readonly kind: 'from-project';
    readonly root: string;
} | { readonly kind: 'none'; };
export type VirtualConfigProject = {
    readonly kind: 'virtual';
    readonly files: Readonly<Record<string, string>>;
    readonly dependencies: ConfigProjectDependencies;
};
export type ConfigProject = VirtualConfigProject | { readonly kind: 'existing'; readonly root: string; };
export type ConfigContext = { readonly root: string; readonly signal: AbortSignal; };
type ConfigFactory = (context: ConfigContext) => Promise<readonly Linter.Config[]> | readonly Linter.Config[];
export type ConfigSource = ConfigFactory | readonly Linter.Config[];
export type ConfigSelectionSet<Name extends string> = readonly [Name, ...Name[]] | 'all';
type SelectedConfigCase<Name extends string> = { readonly title: string; readonly configs: ConfigSelectionSet<Name>; };
export type ConfigRuleCatalog = {
    readonly kind: 'plugin';
    readonly namespace: string;
    readonly rules: Readonly<Record<string, unknown>>;
} | { readonly kind: 'rules'; readonly rules: readonly ConfigCatalogRule[]; };
export type ConfigCatalogRule = { readonly ruleId: string; readonly deprecated: boolean; };
export type ConfigInventory<Name extends string> = SelectedConfigCase<Name> & {
    readonly target: { readonly kind: 'declared'; } | { readonly kind: 'effective'; readonly filename: string; };
    readonly catalog: ConfigRuleCatalog;
    readonly completeness: 'all' | 'known-only';
    readonly deprecated: 'absent' | 'allow' | 'off';
    readonly exclusions: readonly { readonly ruleId: string; readonly reason: string; }[];
};
export type ConfigFileExpectation = { readonly kind: 'ignored'; } | {
    readonly kind: 'included';
    readonly rules: Readonly<Record<string, Linter.RuleEntry | null>>;
    readonly ruleMatch: 'exact' | 'subset';
    readonly languageOptions: NonNullable<Linter.Config['languageOptions']>;
    readonly settings: NonNullable<Linter.Config['settings']>;
};
export type ConfigFileCheck<Name extends string> = SelectedConfigCase<Name> & {
    readonly filename: string;
    readonly expect: ConfigFileExpectation;
};
type DiagnosticFields = Readonly<
    Partial<Pick<Linter.LintMessage, 'column' | 'endColumn' | 'endLine' | 'line' | 'messageId' | 'ruleId' | 'severity'>>
>;
type MessageExpectation = DiagnosticFields & { readonly message: RegExp | string; };
export type ConfigDiagnosticExpectation = DiagnosticFields | MessageExpectation;
type RuleIdExpectations = {
    readonly kind: 'rule-ids';
    readonly rules: readonly string[] | 'all';
    readonly expected: readonly string[];
};
type MessageExpectations = {
    readonly kind: 'messages';
    readonly rules: readonly string[] | 'all';
    readonly expected: readonly ConfigDiagnosticExpectation[];
};
type ParseFailureExpectation = { readonly kind: 'parse-failure'; readonly message: RegExp; };
type CleanExpectation = { readonly kind: 'clean'; };
export type ConfigDiagnostics = CleanExpectation | MessageExpectations | ParseFailureExpectation | RuleIdExpectations;
export type ConfigObservation = {
    readonly filename: string;
    readonly code: string;
    readonly output: string;
    readonly messages: readonly Linter.LintMessage[];
    readonly fixedMessages: readonly Linter.LintMessage[];
};
export type ConfigFixtureExpectation = {
    readonly kind: 'custom';
    readonly check: (observation: ConfigObservation, scope: TestScope) => AssertionResult | Promise<AssertionResult>;
} | {
    readonly kind: 'fix';
    readonly diagnostics: ConfigDiagnostics;
    readonly output: { readonly kind: 'file'; readonly filename: string; } | {
        readonly kind: 'text';
        readonly text: string;
    };
} | {
    readonly kind: 'lint';
    readonly diagnostics: ConfigDiagnostics;
};
export type ConfigFixtureSource = { readonly kind: 'file'; readonly filename: string; } | {
    readonly kind: 'inline';
    readonly filename: string;
    readonly code: string;
};
export type ConfigFixture<Name extends string> = SelectedConfigCase<Name> & {
    readonly source: ConfigFixtureSource;
    readonly expect: ConfigFixtureExpectation;
};
export type ConfigInput = {
    readonly filename: string;
    readonly code: string;
    readonly files: Readonly<Record<string, string>>;
};
type SafetyContractKind = 'crash-freedom' | 'fix-syntax' | 'repeatability' | 'suggestion-syntax';
export type ConfigContract = { readonly kind: 'fix-stability'; readonly maxRounds: number; } | {
    readonly kind: SafetyContractKind;
};
type ConfigGenerationSettings<Name extends string> = SelectedConfigCase<Name> & {
    readonly project: VirtualConfigProject;
    readonly generator: {
        readonly kind: 'custom';
        readonly input: PropertyGenerator<ConfigInput>;
    } | { readonly kind: 'syntax'; readonly syntax: 'javascript' | 'typescript'; readonly filename: string; };
};
type SelectedConfigGeneration<Name extends string> = ConfigGenerationSettings<Name> & {
    readonly contracts: readonly ConfigContract[];
};
export type ConfigGeneration<Name extends string> = ConfigGenerationSettings<Name> | SelectedConfigGeneration<Name>;
export type ConfigDefinition<Name extends string> = {
    readonly name: string;
    readonly configs: Readonly<Record<Name, ConfigSource>>;
    readonly project: ConfigProject;
    readonly inventories: readonly ConfigInventory<NoInfer<Name>>[];
    readonly files: readonly ConfigFileCheck<NoInfer<Name>>[];
    readonly fixtures: readonly ConfigFixture<NoInfer<Name>>[];
    readonly generation: readonly ConfigGeneration<NoInfer<Name>>[];
};
export type ConfigTests = {
    readonly checks: () => Suite;
    readonly fixtures: () => Suite;
    readonly properties: () => Suite;
};
