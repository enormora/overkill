# Browser Testing Landscape

## Status And Scope

Research for the browser product discussion, reviewed on 2026-11-11. This is
not a package roadmap or a claim that integrations already exist. The settled
[product boundary](../authoring/higher-test-layers.md#browser-testing-product-boundary)
defines Browser-executed and Host-driven browser automation and excludes
first-party component-testing APIs. Browser correctness belongs to integration;
browser performance belongs to benchmark. Microtest/property bodies never use
browser runtimes. Settled audit scope now lives in
[Accessibility And Page Audits](../authoring/higher-test-layers.md#accessibility-and-page-audits).

The inventory below records project-level purposes from primary documentation,
READMEs, and vendor descriptions. Representative tools receive closer comparison;
the inventory is not an implementation, maintenance, security, or compatibility
audit of every project. Vendor descriptions establish advertised use cases,
not independently verified effectiveness. Unresolved names and unavailable
sources remain explicit.

The [unified integration proposal](./browser-integration-proposal.md) develops
the resource observations, app guards, browser placement, simulation host, and
benchmark contracts in detail, with an explicit decision register.

## Consolidated Scope Recommendation

This section is a proposal for discussion. It extends the settled two-mode
and component-testing boundary without declaring every candidate an initial
release commitment.

| Offering                       | First-party responsibility                                                                               | Reused implementation                                                                                 |
| ------------------------------ | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Real-browser execution         | Overkill tests/assertions, browser collection/execution integration, native-input integration, results   | Existing transforms/dev servers and browser controllers                                               |
| Full-app automation            | Typed resources, scenarios, lifecycle, identity, evidence, assertion adapters                            | Playwright initially; assess its public BiDi paths before adding another client for demonstrated gaps |
| Deterministic app environments | Compose app assets, server, simulation, startup config, and browser; capture reproduction facts          | Consumer application builds and server integrations                                                   |
| Visual and layout verification | Baseline review/update policy, attribution, focused geometry assertions                                  | Controller screenshots, existing image comparison libraries, optional review services                 |
| Accessible app journeys        | Reusable keyboard/focus checks, supported preference variants, reader resources, and structured evidence | Controller-native input, established scanners, optional platform-validated screen-reader adapters     |
| Document and semantic checks   | Typed assertion/reporting integration with explicit source/state and rule provenance                     | HTML/CSS validators, ARIA rule engines, microformats/structured-data parsers, focused SEO audits      |
| Browser benchmarks             | Existing benchmark workloads, repeatable measurements, metrics, budgets, baselines                       | Browser APIs, controller metrics, focused measurement/audit tools                                     |
| Cross-environment execution    | Browser/device/preference matrices, exact selection, remote lifecycle, merged evidence                   | Browser controllers, grids, cloud sessions, provider tunnels                                          |
| Debugging and failure evidence | Capture/retention policy, console/network transcripts, artifact attribution and reporter links           | Screenshots, recordings, traces, existing viewers                                                     |

The simulation layer should help applications following a runtime startup
pattern such as `window.startApp(config)`. An optional HTML-host helper should
assemble a document from explicit consumer-owned markup, asset references, and
scenario-derived startup data, with correct escaping and configuration
embedding. It should allow existing SSR/template systems to supply the whole
document instead. Overkill should not prescribe an app entry-point name, root
element, framework, rendering strategy, or template language.

In this server-rendered startup pattern, the server resolves the scenario
before constructing startup configuration. Static documents and configuration
endpoints remain valid alternatives.
The application consumes ordinary configuration, such as API base URLs and
feature settings, without depending on Overkill. Scenario changes usually reuse
the same application artifact. App-specific configuration mapping remains with
the consumer. A separate deterministic entry point remains possible where
runtime composition cannot express the required substitution.

Recommended product and correctness boundaries:

- No first-party component mounting API, component-testing DSL, or component
  showcase runner. Guide unit tests toward logic without a real DOM and browser
  integration tests toward the fully rendered app; permit custom consumer setup.
- No implicit replacement of application modules, browser globals, or production
  dependencies to manufacture determinism. Prefer explicit configuration and
  dependency seams. Explicit controller-level network simulation remains a
  possible integration with declared scope.
- No silent replacement of a failed locator, expected result, or baseline by
  an AI system. Optional AI integrations must preserve the chosen oracle and
  expose model-derived evidence and changes.
- No claims that one accessibility scan, screenshot, validated DOM, or audit
  score proves complete accessibility, standards conformance, or SEO success.

Recommended mission boundaries, independent of whether the tools are useful:

- Reuse browser clients, protocols, image comparison, and validators rather
  than implementing competing engines.
- Leave general application builds, SSR frameworks, hosted browser/device
  clouds, visual-review SaaS, test management, and native mobile/desktop
  automation products outside the initial first-party offering.
- Leave custom BDD/no-code languages, recorders, autonomous exploration,
  automatic journey harvesting, and a custom trace/time-travel IDE outside
  the initial offering. They can consume explicit integration contracts later.
- Do not offer a DOM emulator as a substitute for the real-browser guarantee.
  Consumers may use such libraries explicitly in their own ordinary tests.

Actual screen-reader support is selected as optional first-party adapters;
publish only validated OS/browser/reader combinations. Defer dedicated
static/offline test-page export, manually captured-browser management, and
exhaustive platform-context support until
their lifecycle and evidence contracts are specified. Existing simulator
definitions should remain usable outside automated tests for manual exploration.

The proposed added value is consistent composition across these capabilities:
one scenario can drive app startup, service behavior, browser interaction,
accessibility expectations, screenshots, and benchmark workloads. Existing
property/model-based facilities could later generate and shrink journeys while
retaining the same identities and reproduction evidence. This is a coherent
combination, not a claim that each capability is unique to Overkill.

## Product Capabilities

The useful unification is by independent capabilities. A screenshot service,
a browser protocol, and a test runner solve different problems even when all
three appear in one workflow.

| Capability                                          | Representative prior art                                           | Proposed Overkill role                                                                                                                            |
| --------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Execute test modules in actual browsers             | Buster, Karma, Web Test Runner, Vitest Browser Mode                | Own test semantics and browser execution integration; reuse serving/transformation infrastructure and browser controllers.                        |
| Drive complete application journeys                 | Playwright, Selenium, WebdriverIO, Cypress, TestCafe               | Own Overkill test lifecycle and evidence; expose established automation clients through adapters.                                                 |
| Compare appearance                                  | Gemini, BackstopJS, reg-suit, Percy, Argos                         | Own baseline identity, intentional updates, and reporting; reuse capture and comparison implementations.                                          |
| Check responsive layout constraints                 | Galen                                                              | Consider explicit geometry assertions alongside visual baselines; do not require a new specification language.                                    |
| Verify accessible interactions and states           | axe, Pa11y, Guidepup, WAI practices                                | Combine scanner adapters, authored journeys, and optional assistive-technology integrations; keep their evidence distinct.                        |
| Validate documents and structured meaning           | Nu Html Checker, microformats parsers, structured-data validators  | Adapt validators; distinguish source, rendered DOM, vocabulary, and application-specific expectations.                                            |
| Check discoverability and web best practices        | Lighthouse, crawler-facing metadata checks                         | Use focused audits and assertions; do not equate audit scores with search ranking.                                                                |
| Measure frontend performance                        | Browsertime, sitespeed.io, WebPageTest, Lighthouse CI              | Extend existing benchmark workloads, metrics, budgets, and evidence.                                                                              |
| Control dependencies and reproduce network behavior | Polly.JS, WireMock, Hoverfly, VCR, Betamax                         | Reuse the existing resource/scenario/transcript direction and focused external adapters.                                                          |
| Provision deterministic full-app environments       | Application builds, configurable app servers, simulation scenarios | Compose build/server/browser resources and effective scenario configuration; keep application composition and compiler choices with the consumer. |
| Explore or generate journeys                        | Midscene, Meticulous, Selenium IDE, AI testing services            | Potential optional authoring/action integrations; do not promise a recorder, crawler, agent, or self-healing engine.                              |
| Run across environments                             | BrowserStack, Sauce Labs, Selenium Grid                            | Own selection and identity; reuse remote sessions, provider infrastructure, and tunnels.                                                          |
| Investigate failures and iterate                    | Cypress open mode, Wallaby, controller traces                      | Own attribution and reporter links; reuse capture and viewers before considering a dedicated UI.                                                  |

Complete application journeys can involve multiple pages and origins,
authentication/session persistence, uploads/downloads, permissions, native
dialogs, locale/timezone, and offline/service-worker behavior. These are
compatibility scenarios within automation, not separate test families. The
initial supported set still needs a deliberate choice and acceptance evidence.

Repeated controlled measurements and performance budgets belong to benchmarks.
Diagnostic audits and their scores remain distinct findings, even when one
tool produces both. A Lighthouse score does not define the shared benchmark
measurement contract.

These rows are proposed support boundaries. Playwright is the recommended
initial controller, pending selection. Which other adapters are first-party
and which capabilities ship initially remains open.

## Execution Modes And Independent Axes

Two primary execution modes still explain most of the list:

- Browser-executed tests import frontend modules and execute their assertions
  in a browser. The browser graph may use DOM APIs during import.
- Host-executed automation tests drive the app through a browser controller.
  The application runs in the browser; the test body runs on the host.

Hybrid tools combine these. Cypress's command queue and retry model are a
distinct authoring/execution design, not evidence that Overkill needs a third
test family. Its waiting behavior is worth studying independently of its DSL.
See [Cypress core concepts](https://docs.cypress.io/app/core-concepts/introduction-to-cypress).

Other apparent modes vary independent axes:

| Axis        | Choices worth distinguishing                                                                                                                                            |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Test target | Full app, browser module, worker/service worker, extension, native app, desktop UI. Browser workers and extensions need explicit context support before being promised. |
| Environment | Real browser, DOM emulation, HTML parsing, real mobile browser, native mobile app. Emulation does not establish rendering or native-input behavior.                     |
| Authoring   | TypeScript tests, BDD specifications, recorded steps, generated journeys, natural-language/AI actions.                                                                  |
| Observation | Assertions, layout geometry, screenshots, DOM/accessibility structures, speech output, network behavior, performance measurements.                                      |
| Placement   | Local launch, remote session, cloud device, manually opened/captured browser, static/offline test page.                                                                 |
| Workflow    | Headless CI, headed debugging, watch feedback, assisted manual evaluation, scheduled monitoring.                                                                        |

Native mobile apps, OS-wide image automation, DOM emulation presets, recorders,
BDD languages, hosted test management, and AI self-healing are candidates for
deliberate exclusion from first-party browser scope. They are not settled
exclusions yet. General resources and artifacts may accommodate integrations
without promising a first-party implementation for each category.

## What To Own And What To Adapt

Overkill's likely original work is the integration contract: its test semantics,
collection and exact selection, lifecycle, identities, results, artifacts,
baseline workflow, and benchmark policies across the supported modes.

Existing libraries should supply browser control, protocol clients, transforms,
asset serving, image comparison, accessibility scanning, document validation,
and specialized metrics where appropriate. Reuse does not remove the work of
connecting errors, cancellation, evidence, and cleanup to Overkill.

Compare two designs before choosing package APIs:

- A universal browser API would make clients interchangeable but require
  Overkill to define locators, waiting, input, navigation, and capability gaps.
- Native client adapters preserve existing behavior and documentation. Shared
  Overkill contracts can still unify lifecycle, identity, evidence, and policy.

The second is the working recommendation. For browser-executed tests, any
bridge to host-side native actions needs its own bounded contract; a Playwright
`Page` is not a browser-local object.

An adapter to a controller library is different from invoking another complete
test runner and importing its results. The latter loses direct control over
selection, retry, lifecycle, and assertion semantics unless explicitly mapped.
Compatibility with existing foreign suites is a separate product decision.

## Accessibility Beyond Scanning

The selected feature is verification of app journeys under accessibility
requirements, not one scan of the initial DOM.

| Evidence                        | Examples                                                                                                     | Reuse and limits                                                                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Automated state analysis        | Roles/names, applicable ARIA rules, contrast findings, target-size findings                                  | Reuse axe or another supported rule engine; record rules and states actually evaluated.                                               |
| Interactive behavior            | Tab/Shift+Tab, activation, skip links, focus entry/containment/restoration, route changes, validation errors | Use controller-native actions and authored app expectations; do not infer the intended order of every app automatically.              |
| User preferences and adaptation | Light/dark, forced colors, reduced motion, larger text, zoom/reflow, touch input                             | Record how each condition was applied. Viewport resizing and CSS transforms do not establish actual browser zoom or OS behavior.      |
| Assistive technology            | Screen-reader navigation, names, announcements, live-region updates                                          | Adapt existing libraries/providers for validated OS/browser/reader combinations. Accessibility-tree snapshots are different evidence. |
| Human evaluation                | Usability and checks requiring contextual judgment                                                           | Preserve explicit scope and evidence; automated success does not establish complete conformance.                                      |

The WAI modal pattern specifies focus movement, tab containment, and focus
restoration, illustrating why scanning alone is insufficient. See
[WAI modal dialog practices](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/).
[Guidepup](https://github.com/guidepup/guidepup) supplies screen-reader automation;
CSS speech declarations alone would not establish actual announcements.
[WAI evaluation guidance](https://www.w3.org/WAI/test-evaluate/) distinguishes
tool support from the human evaluation needed for accessibility assessment.
Synthetic keyboard events inside a browser do not establish native keyboard
navigation. Assertions about contrast, target size, reading order, or spoken
announcements need defined app states and supported environments.

## Document Conformance, Semantics, And Discoverability

Keep distinct observations and claims:

- Validate the original HTTP document as well as explicitly selected rendered
  DOM states. Browser parsing repairs markup, so serializing the DOM cannot
  recover every defect in the response source.
- Reuse [Nu Html Checker](https://github.com/validator/validator) for its supported
  HTML/CSS/SVG checks. Define the CSS source and validation scope explicitly.
  Preserve the distinction between external stylesheets, source styles, and
  dynamically generated styles.
- Treat ARIA, microformats, schema.org, JSON-LD, Microdata, and RDFa as related
  but distinct vocabularies, formats, and validation domains. JSON syntax
  validity alone does not establish a correct structured-data payload.
- Check application facts, for example that a rendered product price matches
  its structured offer. A schema checker cannot establish that correspondence
  without application expectations.
- Separate schema.org validity from search-provider rich-result requirements.
  [Google's structured-data documentation](https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data)
  explicitly distinguishes the vocabulary from its feature requirements.
- Consider title, language, canonical/hreflang links, robots directives, status
  codes, links, and rendered metadata as discoverability checks. Navigation
  and response evidence matter alongside the DOM. Passing checks does not
  guarantee indexing, ranking, or a rich-result presentation.

## Delivery And Remote Connections

Browser-executed tests need a browser-loadable module graph, bootstrap, and
result/control channel. A generated monolithic bundle is one implementation
option; transformed ESM served on demand is another. Reuse existing tooling
before choosing either. Account for TS/JSX/assets, package exports, source maps,
application build configuration, CSP, origins, and invalidation on reruns.
Reusing a TSX transform does not imply a component-testing product.

[Web Test Runner's framework adapter](https://modern-web.dev/docs/test-runner/test-frameworks/write-your-own/)
demonstrates a browser-side module import and session/result handshake.
[Buster's capture server](https://busterjs.readthedocs.io/en/develop/modules/buster-capture-server/)
demonstrates generic browser sessions and communication. Karma's
[server implementation](https://github.com/karma-runner/karma/blob/master/lib/server.js)
uses Socket.IO. These are references, not a decision to implement a new server
or transport stack.

Remote browser control and communication with the injected Overkill code are
separate paths. Connecting a controller to a cloud browser does not establish
that the browser can reach a local app, module server, or result channel.
Compare controller-mediated messaging with a browser-initiated session channel;
validate both against remote providers before settling transport.

Reuse provider tunnels where needed. [Sauce Connect](https://docs.saucelabs.com/secure-connections/sauce-connect-5/)
documents access to local/private applications and WebSocket support. Acceptance
must cover the app and harness URLs, channel reconnection/disconnection,
session/attempt identity, stale messages, evidence completeness, and cleanup.
Do not promise transparent continuation after lost execution evidence.

Playwright protocol, CDP, WebDriver Classic, and BiDi endpoints are distinct.
Playwright's documented [remote connection API](https://playwright.dev/docs/api/class-browsertype)
and [experimental Grid support](https://playwright.dev/docs/selenium-grid)
do not establish generic BiDi compatibility. Existing clients such as
[WebdriverIO](https://webdriver.io/docs/automationProtocols/) or
[Puppeteer](https://pptr.dev/webdriver-bidi) are candidates for that path.

## Application Builds And Scenario Configuration

Three concerns should be evaluated separately:

| Concern                               | Working support recommendation                                                                                                                                   |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deliver Overkill tests to a browser   | The browser integration provides a browser-loadable test graph and bootstrap using existing transformation/serving tooling.                                      |
| Build the application under test      | Compose a consumer build command, existing dev server, bundler API, or prebuilt artifact as a resource. Do not make Overkill a general application build system. |
| Configure a deterministic app session | Use explicit server/startup configuration and scenario-aware endpoints; record the scenario and supplied build identity for reproduction.                        |

Two application patterns need to fit:

- A dedicated deterministic client entry point composes the same application
  with controlled dependencies, then goes through the project's normal bundler.
- An existing application artifact receives runtime configuration from its
  host document or configuration endpoint. A scenario changes service URLs,
  fixtures, or startup data without rebuilding the JavaScript artifact.

Prefer runtime configuration where it preserves the application's actual
dependency boundaries. A separate composition root can still be justified for
dependencies that cannot be selected at runtime. Neither pattern requires
Overkill to rewrite application source or silently replace imports.

Build a shared artifact once when only runtime configuration varies. If a
scenario genuinely changes compilation, reflect that input in the build
resource identity. Preserve which application artifact was exercised without
equating a dedicated deterministic build with verification of a production
artifact. Reproduction also needs the effective logical runtime configuration
and scenario identity. Temporary addresses and session credentials are not
stable configuration identity.

Sharing immutable build output does not authorize sharing mutable server state,
startup configuration, cookies, caches, or service workers. Each follows the
declared isolation policy. A reused dev server must provide a stable module/asset
version during execution or invalidate the affected collected work.

The existing [simulation contract](../authoring/deterministic-simulation.md#scenario-timing)
already distinguishes startup-bound and request-routed scenarios. Its HTTP
adapter's `scenarioUrl(...)` selects an individual request; it does not establish
automatic propagation through the browser application. Query parameters on a
page URL do not automatically reach script, navigation, fetch, worker, or
WebSocket requests. Cookies have different sharing boundaries. Any adapter
must define how the selected scenario reaches every relevant dependency and
how concurrent sessions remain independent.

Candidate approaches are separate server instances with a fixed scenario,
scenario-specific API base URLs, or explicit session routing. The application
must construct requests that preserve the scenario selector; assigning a
query-selected URL as an API base alone is insufficient. Path/session routing
would require an explicitly defined adapter rather than an assumed feature of
the current HTTP adapter. The application
should be able to consume ordinary configuration without importing Overkill.
Avoid hidden global scenario switches or browser API interception as the
default mechanism. Remote app, asset, and service URLs must remain reachable
from the selected browser environment.

The first implementation should demonstrate these with existing resource
composition before adding a generic build abstraction or standard asset-manifest
format. Such an abstraction needs repeated integration evidence beyond one
project's bundler configuration.

## Distinct Lessons From Representative Tools

- [Galen](https://galenframework.com/docs/all/) checks layout relationships at
  selected sizes. This can detect overlap or containment errors without
  requiring every visual difference to be a baseline update.
- [Midscene](https://github.com/web-infra-dev/midscene) exposes agent actions
  through an existing Playwright page. This suggests an optional action adapter
  rather than a new Overkill execution mode. Its model choices, cost, and
  nondeterminism would remain explicit.
- [Meticulous](https://www.meticulous.ai/) advertises automatically generated
  visual tests. Journey acquisition and visual oracles are independent of
  where a test executes; this is a separate product commitment.
- [VLM-Diff](https://github.com/shidesheng0218/vlm-diff) combines DOM and pixel
  observations with model-assisted interpretation. Consider richer evidence
  and pluggable comparison policies without replacing deterministic assertions
  with unreviewed model judgments.
- [Polly.JS](https://github.com/Netflix/pollyjs),
  [WireMock](https://github.com/wiremock/wiremock), and
  [Hoverfly](https://github.com/SpectoLabs/hoverfly) demonstrate useful replay
  and dependency-control workflows. Match them to Overkill's existing
  scenarios and transcripts before adding browser-only mechanisms.

## Inventory

Entries below identify use cases, not promised adapters. Proposed first-party
scope follows the capability discussion above. No inference about a tool's
current support status should be made from its inclusion.

### Browser test execution and automation

| Project/source                                                   | Distinct purpose or review limit                                                                       |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| [Buster.JS](https://busterjs.readthedocs.io/en/develop/)         | Browser-executed tests and generic captured-browser sessions.                                          |
| [Karma](https://github.com/karma-runner/karma)                   | Execute JavaScript tests across connected real browsers.                                               |
| [Web Test Runner](https://github.com/modernweb-dev/web)          | Browser execution with separate framework, launcher, and server integrations.                          |
| [Playwright](https://github.com/microsoft/playwright)            | Browser control library plus a separate full test runner.                                              |
| [Puppeteer](https://github.com/puppeteer/puppeteer)              | Browser control through CDP or BiDi.                                                                   |
| [Selenium](https://github.com/SeleniumHQ/selenium)               | Browser automation clients, drivers, and Grid infrastructure.                                          |
| [WebdriverIO / WDIO](https://github.com/webdriverio/webdriverio) | Automation framework with browser and mobile integrations.                                             |
| [WebDriver](https://github.com/w3c/webdriver)                    | Remote-control protocol specification, not a test runner.                                              |
| [WebDriver BiDi](https://github.com/w3c/webdriver-bidi)          | Bidirectional browser-control protocol, not an execution family.                                       |
| [TestCafe](https://github.com/DevExpress/testcafe)               | Browser test runner with its own automation and authoring model.                                       |
| [Cypress](https://github.com/cypress-io/cypress)                 | Integrated browser testing, command queues, waiting, and debugging.                                    |
| [Nightwatch](https://github.com/nightwatchjs/nightwatch)         | Browser automation framework and integrated testing workflow.                                          |
| [Nightmare](https://github.com/segment-boneyard/nightmare)       | Historical high-level browser automation library; consult archived source.                             |
| [CasperJS](https://github.com/casperjs/casperjs)                 | Scripted browser navigation/testing built around older browser engines.                                |
| [PhantomJS](https://github.com/ariya/phantomjs)                  | Scriptable headless WebKit engine.                                                                     |
| [SlimerJS](https://github.com/laurentj/slimerjs)                 | Scriptable browser engine and page interaction.                                                        |
| [Capybara](https://github.com/teamcapybara/capybara)             | Ruby acceptance-testing API with interchangeable drivers.                                              |
| [Selenide](https://github.com/selenide/selenide)                 | Java browser-testing API above Selenium.                                                               |
| [Geb](https://github.com/geb/geb)                                | Browser automation library; inspect its dedicated documentation before API reuse.                      |
| [Protractor](https://github.com/angular/protractor)              | Angular-oriented end-to-end testing prior art.                                                         |
| [DalekJS](https://github.com/dalekjs/dalek)                      | Historical browser automation framework; repository recommends TestCafe.                               |
| [Chimp](https://github.com/xolvio/chimp)                         | Current README describes app-development tooling; historical browser-testing identity needs a version. |

### Visual comparison, geometry, and review

| Project/source                                                                                      | Distinct purpose or review limit                                           |
| --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| [Galen Framework](https://github.com/galenframework/galen)                                          | Responsive layout specifications using element geometry.                   |
| [Gemini / gemini-test](https://github.com/gemini-testing/gemini)                                    | Screenshot regression testing.                                             |
| [Hermione / Testplane](https://github.com/gemini-testing/hermione)                                  | Browser testing framework; current README identifies it as Testplane.      |
| [BackstopJS](https://github.com/garris/BackstopJS)                                                  | Scenario-driven screenshot regression and reports.                         |
| [PhantomCSS](https://github.com/HuddleEng/PhantomCSS)                                               | Historical visual regression testing.                                      |
| [Needle](https://github.com/python-needle/needle)                                                   | Selenium-based visual comparison.                                          |
| [CSS Critic](https://github.com/cburgmer/csscritic)                                                 | CSS appearance regression testing.                                         |
| [reg-suit](https://github.com/reg-viz/reg-suit)                                                     | Image comparison workflow and difference reports.                          |
| [Visual Regression Tracker](https://github.com/Visual-Regression-Tracker/Visual-Regression-Tracker) | Baseline acceptance and image comparison service.                          |
| [Argos](https://github.com/argos-ci/argos)                                                          | Visual testing and review platform.                                        |
| [Lost Pixel](https://github.com/lost-pixel/lost-pixel)                                              | Visual regression for application pages and story collections.             |
| [Creevey](https://github.com/creevey/creevey)                                                       | Cross-browser screenshot testing for Storybook.                            |
| [WebdriverCSS](https://github.com/webdriverio/webdrivercss)                                         | Screenshot comparison integrated with WebdriverIO.                         |
| [ODiff](https://github.com/dmtrKovalenko/odiff)                                                     | Native image comparison implementation.                                    |
| [pixelmatch](https://github.com/mapbox/pixelmatch)                                                  | Pixel comparison with anti-aliasing and perceptual color handling.         |
| [looks-same](https://github.com/gemini-testing/looks-same)                                          | PNG comparison accounting for human color perception.                      |
| [aShot](https://github.com/pazone/ashot)                                                            | WebDriver screenshot capture and comparison utilities.                     |
| [nightwatch-vrt](https://github.com/Crunch-io/nightwatch-vrt)                                       | Screenshot assertions extending Nightwatch.                                |
| [jest-image-snapshot](https://github.com/americanexpress/jest-image-snapshot)                       | Jest matcher connecting image comparison and snapshot workflows.           |
| [Applitools](https://applitools.com/)                                                               | Vendor visual analysis and broader automated-testing platform.             |
| [Chromatic](https://www.chromatic.com/)                                                             | Hosted visual, interaction, accessibility, and review workflows.           |
| [Percy](https://www.browserstack.com/percy)                                                         | Screenshot baselines and visual review service.                            |
| [VisWiz.io](https://www.viswiz.io/)                                                                 | Hosted visual regression comparison.                                       |
| [Happo.io](https://happo.io/)                                                                       | Cross-browser screenshots, visual regression, and accessibility offerings. |

### Accessibility, performance, and document analysis

| Project/source                                                                              | Distinct purpose or review limit                                                                    |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| [axe-core](https://github.com/dequelabs/axe-core)                                           | Embeddable automated accessibility rule engine.                                                     |
| [axe-playwright](https://github.com/abhinaba-ghosh/axe-playwright)                          | Bridge from Playwright to axe-core.                                                                 |
| [Pa11y](https://github.com/pa11y/pa11y)                                                     | Page accessibility checking through CLI or Node APIs.                                               |
| [Lighthouse CI / lighthouserc](https://github.com/GoogleChrome/lighthouse-ci)               | Configuration and workflow for repeated audits and assertions.                                      |
| [Lighthouse](https://github.com/GoogleChrome/lighthouse)                                    | Performance, accessibility, SEO, and web-practice audits.                                           |
| [playwright-lighthouse](https://github.com/abhinaba-ghosh/playwright-lighthouse)            | Connect Lighthouse auditing to a Playwright workflow.                                               |
| [Browsertime](https://github.com/sitespeedio/browsertime)                                   | Browser performance measurement infrastructure.                                                     |
| [sitespeed.io](https://github.com/sitespeedio/sitespeed.io)                                 | Web performance collection, analysis, and reporting.                                                |
| [WebPageTest](https://www.webpagetest.org/)                                                 | Primary homepage was inaccessible during this review; detailed integration assessment remains open. |
| [Nu Html Checker](https://github.com/validator/validator)                                   | HTML/CSS/SVG checks from an existing validator.                                                     |
| [microformats parser](https://github.com/microformats/microformat-node)                     | Extract microformats for explicit application expectations.                                         |
| [Structured Data Testing Tool](https://github.com/iaincollins/structured-data-testing-tool) | CLI/library checks for structured data.                                                             |

### Remote infrastructure and execution feedback

| Project/source                                                          | Distinct purpose or review limit                                                                      |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| [BrowserStack](https://www.browserstack.com/)                           | Remote browser and device infrastructure with testing services.                                       |
| [Sauce Labs](https://saucelabs.com/)                                    | Remote browsers/devices and provider connection infrastructure.                                       |
| [LambdaTest](https://www.testmuai.com/)                                 | Original URL redirects to TestMu AI; verify current provider contracts before integration.            |
| [TestingBot](https://testingbot.com/)                                   | Remote browser/device sessions and parallel execution.                                                |
| [CrossBrowserTesting](https://crossbrowsertesting.com/)                 | Original hostname was unavailable; historical provider identity needs an archival source.             |
| [Wallaby](https://wallabyjs.com/)                                       | Continuous editor feedback for JavaScript/TypeScript tests.                                           |
| [puppeteer-cluster](https://github.com/thomasdondorf/puppeteer-cluster) | Pooled browser jobs and browser recovery; compare with existing runner scheduling.                    |
| [playwright-video](https://github.com/qawolf/playwright-video)          | Historical page-video helper; assess current controller-native capture first.                         |
| [webdriver-manager](https://github.com/angular/webdriver-manager)       | Driver installation/startup tooling, not a testing mode.                                              |
| [webdriverio-devtools](https://github.com/webdriverio/devtools)         | Current linked repository is debugging tooling; historical protocol package identity needs a version. |

### Generated, recorded, AI-assisted, and specification-driven testing

| Project/source                                                                          | Distinct purpose or review limit                                                             |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| [Midscene](https://github.com/web-infra-dev/midscene)                                   | Natural-language visual actions/assertions; agent API can use an existing Playwright page.   |
| [Selenium IDE](https://github.com/SeleniumHQ/selenium-ide)                              | Record and replay browser interactions.                                                      |
| [Meticulous](https://www.meticulous.ai/)                                                | Vendor-generated and maintained visual browser tests.                                        |
| [Testim](https://www.testim.io/test-automation-tool/)                                   | Vendor test authoring and execution platform; detailed API compatibility remains unassessed. |
| [mabl](https://www.mabl.com/)                                                           | Vendor agentic test platform.                                                                |
| [Functionize](https://www.functionize.com/)                                             | Vendor app-test generation, execution, and maintenance.                                      |
| [Autify](https://autify.com/)                                                           | Vendor AI-assisted quality/test authoring platform.                                          |
| [Testsigma](https://testsigma.com/)                                                     | Vendor test generation, execution, and diagnosis.                                            |
| [testRigor](https://testrigor.com/)                                                     | Plain-language end-to-end test authoring.                                                    |
| [Momentic](https://momentic.ai/)                                                        | Vendor AI exploration, reproduction, and regression-test generation.                         |
| [QA Wolf](https://github.com/qawolf/qawolf)                                             | Local flow tooling plus a managed test-generation/execution platform.                        |
| [TestComplete](https://smartbear.com/product/testcomplete/)                             | Desktop, web, and mobile test automation.                                                    |
| [Tricentis Tosca](https://www.tricentis.com/products/automate-continuous-testing-tosca) | Codeless enterprise end-to-end automation; supplied name was trice-tosca.                    |
| [Ranorex](https://www.ranorex.com/)                                                     | Desktop, web, and mobile GUI automation; supplied name was renorex.                          |
| [Katalon Studio](https://katalon.com/katalon-studio)                                    | Integrated no-code, low-code, and code-based test tooling.                                   |
| [vStellar](https://vstellar.io/)                                                        | Visual test authoring platform spanning web, mobile, API, and performance.                   |
| [Serenity BDD](https://github.com/serenity-bdd/serenity-core)                           | Acceptance-testing framework; separate language/reporting layer from browser control.        |
| [Robot Framework](https://github.com/robotframework/robotframework)                     | Generic acceptance/automation framework with library integrations.                           |
| [Gauge](https://github.com/getgauge/gauge)                                              | Specification-driven acceptance-testing framework.                                           |
| [Vedro](https://vedro.io/docs/quick-start)                                              | Python scenarios, contexts, and effects; an authoring model rather than a browser protocol.  |
| [Sahi](https://github.com/sahipro/sahi)                                                 | Primary site/repository unavailable during this review; detailed claims remain unverified.   |
| [RedwoodHQ](https://github.com/primatest/RedwoodHQ)                                     | Primary site/repository unavailable during this review; detailed claims remain unverified.   |

### Dependency control, emulation, and adjacent tooling

| Project/source                                                          | Distinct purpose or review limit                                                            |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| [Polly.JS](https://github.com/Netflix/pollyjs)                          | Record, replay, and stub HTTP interactions in Node and browsers.                            |
| [WireMock](https://github.com/wiremock/wiremock)                        | External API simulation and mocking.                                                        |
| [Hoverfly](https://github.com/SpectoLabs/hoverfly)                      | API simulation, capture, and dependency replacement.                                        |
| [VCR](https://github.com/vcr/vcr)                                       | Recorded HTTP cassettes for replay in Ruby tests.                                           |
| [Cheerio](https://cheerio.js.org/)                                      | HTML/XML parsing and manipulation; not a rendering browser.                                 |
| [jsdom](https://github.com/jsdom/jsdom)                                 | DOM/HTML emulation in Node; not real layout or rendering evidence.                          |
| [Zombie.js](https://github.com/assaf/zombie)                            | Node-based simulated browser/testing environment.                                           |
| [HtmlUnit](https://github.com/HtmlUnit/htmlunit)                        | Browser emulation in Java.                                                                  |
| [Syn](https://github.com/bitovi/syn)                                    | Synthetic browser input/event tooling; native-input equivalence requires separate evidence. |
| [web-component-tester](https://github.com/Polymer/web-component-tester) | Component testing prior art; first-party component API excluded for Overkill.               |
| [open-wc](https://github.com/open-wc/open-wc)                           | Web-component development/testing conventions and tools; component API excluded.            |
| [TestProf](https://github.com/test-prof/test-prof)                      | Analyze test-suite performance; distinct from measuring application performance.            |
| [Tridactyl](https://github.com/tridactyl/tridactyl)                     | Keyboard-driven Firefox extension; an interaction example, not a test framework.            |

### Native device and desktop automation

| Project/source                                                    | Distinct purpose or review limit                                                |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| [Appium](https://github.com/appium/appium)                        | Native, hybrid, mobile-web, and desktop automation.                             |
| [Detox](https://github.com/wix/Detox)                             | Device/simulator app testing.                                                   |
| [Maestro](https://github.com/mobile-dev-inc/Maestro)              | UI journeys for Android, iOS, and web apps.                                     |
| [SikuliX](https://github.com/RaiMan/SikuliX1)                     | Image-driven desktop automation; current repository points to Oculix successor. |
| [scrcpy](https://github.com/Genymobile/scrcpy)                    | Android display/control tooling.                                                |
| [Appium Desktop](https://github.com/appium/appium-desktop)        | Older GUI tooling; README directs users to CLI Appium and Inspector.            |
| [Appium Inspector](https://github.com/appium/appium-inspector)    | Inspect application elements through Appium.                                    |
| [Appium WebDriverAgent](https://github.com/appium/WebDriverAgent) | iOS control implementation; moved to the Appium iOS monorepo.                   |
| [adb-enhanced](https://github.com/ashishb/adb-enhanced)           | Android device-control commands.                                                |

### Additional source identities

| Project/source                                                                                                                         | Distinct purpose or review limit                                                                 |
| -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| [VLM-Diff](https://github.com/shidesheng0218/vlm-diff)                                                                                 | DOM/pixel comparison with optional model-assisted interpretation.                                |
| [Guidepup](https://github.com/guidepup/guidepup)                                                                                       | Screen-reader automation for supported environments.                                             |
| [Microformats](https://microformats.org/) and [HTML5 Doctor explanation](https://html5doctor.com/microformats/)                        | Semantic conventions and background; distinct from ARIA and schema.org.                          |
| [schema.org](https://schema.org/), [JSON-LD](https://json-ld.org/), [Microdata](https://html.spec.whatwg.org/multipage/microdata.html) | Vocabulary and serialization/embedding formats; not browser controllers.                         |
| [TestCafe live mode](https://testcafe.io/documentation/402831/guides/basic-guides/live-mode)                                           | Interactive rerun workflow; detailed current-page review remains open.                           |
| [Betamax Python documentation](https://betamax.readthedocs.io/en/latest/introduction.html)                                             | HTTP recording exists under this name; intended Java/Python project identity remains unresolved. |
| playwalk; k visual; click interceptor; dynamic-html-snapshots; waffle; cdp-agent                                                       | No unique intended project established. Omitted from capability decisions.                       |

## Remaining Technical Validation

- Validate specific controller/browser/provider versions, guard coverage, and
  native-input/metric capabilities rather than infer them from a tool name.
- Select maintained scanner/parser/validator implementations and explicit
  rule/profile versions for the canonical audit catalog; validate reader/OS
  matrices and required environment ownership.
- Specify concrete visual comparator policies and optional hosted review
  integrations within the existing baseline contract.
- Validate harness delivery, source maps, controlled networking, and resource
  implementation references for local/remote mixed-placement execution.

Controller-free capture is deferred; standalone runnable test export is
explicitly rejected. Authored worker use needs no separate execution placement;
first-party browser-extension resources are selected. These are settled scope
decisions, not remaining questions.
