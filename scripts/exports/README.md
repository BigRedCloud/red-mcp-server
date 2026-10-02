# Optional local Excel exports

These operator utilities are separate from the production server package. Install their private dependency with `npm install --prefix scripts/exports --ignore-scripts`. SheetJS is pinned to the [official 0.20.3 distribution](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/); it is not a server dependency.

Provide only authorized test data and private credentials. Scripts that fetch records are not part of the automatic test suite. Generated reports can contain customer data and must never be committed. Environment names are documented in [the operator reference](../../docs/environment-variables.md#operator-script-and-test-only-inventory).
