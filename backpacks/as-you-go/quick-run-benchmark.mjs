// The pure ranking benchmark: how long a query takes over a 10k and a 20k corpus.
//
// This is a measurement, not a test: the checklist asks for the numbers, and a time-bound assertion in
// the suite would be a flake waiting to happen on a busy machine. Run it by hand and record the result:
//
//   node quick-run-benchmark.mjs
//
// What it measures is the pure half only - ranking a pre-built row list - because that is the half the
// contract puts a budget on. The integrated renderer half needs the app and waits for a session at the
// machine.
import { performance } from 'node:perf_hooks';
import { quickRunResults } from './public/app/quick-run/quick-run-index.js';

/** A corpus of ordinary-looking rows: mostly non-matching, with a realistic spread of match tiers. */
function corpus(size, withNormalizedName) {
  const rows = [];
  for (let index = 0; index < size; index += 1) {
    const name = index % 7 === 0
      ? `Item ${index}`
      : index % 11 === 0
        ? `Project item ${index}`
        : `Document ${index}`;
    rows.push({
      resultKey: `r-${index}`,
      name,
      ...(withNormalizedName ? { normalizedName: name.toLowerCase() } : {}),
      type: 'folder',
      breadcrumb: 'Workspace',
    });
  }
  return rows;
}

const queries = ['item', 'item 1', 'i', 'item 99', 'project item', 'zzz', 'document 1234'];

function measure(rows) {
  const samples = [];
  for (const query of queries) {
    for (let run = 0; run < 30; run += 1) {
      const started = performance.now();
      quickRunResults(rows, query);
      samples.push(performance.now() - started);
    }
  }
  samples.sort((left, right) => left - right);
  const at = (fraction) => samples[Math.min(samples.length - 1, Math.floor(samples.length * fraction))];
  return {
    runs: samples.length,
    p50: at(0.5),
    p95: at(0.95),
    max: samples[samples.length - 1],
  };
}

for (const size of [10000, 20000]) {
  for (const withNormalizedName of [true, false]) {
    const rows = corpus(size, withNormalizedName);
    // One warm pass so the first query is not measured against a cold inline cache.
    quickRunResults(rows, 'item');
    const result = measure(rows);
    const matched = quickRunResults(rows, 'item').length;
    console.log(
      `${size} rows (${matched} matched, normalizedName ${withNormalizedName ? 'present' : 'absent'}): `
      + `${result.runs} runs, p50 ${result.p50.toFixed(2)} ms, p95 ${result.p95.toFixed(2)} ms, `
      + `max ${result.max.toFixed(2)} ms`,
    );
  }
}
