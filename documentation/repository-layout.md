# Repository Layout

Overkill uses a feature-oriented monorepo layout.

```text
source/
|-- engine/                  # current engine-owned runtime, contracts, core execution code
|-- reporters/               # current concrete reporter implementations
|-- authoring/               # future shared test-authoring code
|-- runtimes/                # future shared resource/runtime code
|-- feature-a/               # generic example of a reusable feature folder
`-- packages/
    |-- engine/
    |   `-- entry-point.ts   # thin facade for the published @overkill/engine package
    `-- package-a/
        `-- entry-point.ts   # generic example of a publish facade re-exporting feature code
```

Rules:

- Shared feature folders are the source of truth.
- Published packages are assembled by `packtory` from facade entry points in `source/packages/**`.
- Adding a package should usually mean adding a small facade first, not creating a new isolated source tree.
- A package facade should mainly re-export or lightly adapt code from shared feature folders.
