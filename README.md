# diff-speed-01-run-20261126

[![make.fun · diff-speed-01-run-20261126](https://make.fun/badge/diff-speed-01-run-20261126.svg)](https://make.fun/bounty/diff-speed-01-run-20261126?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)
[![rank](https://make.fun/badge/diff-speed-01-run-20261126/danielhutapea36/diff-speed-01-run-20261126/rank.svg)](https://make.fun/bounty/diff-speed-01-run-20261126/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)
[![reward](https://make.fun/badge/diff-speed-01-run-20261126/danielhutapea36/diff-speed-01-run-20261126/reward.svg)](https://make.fun/bounty/diff-speed-01-run-20261126?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)

A faster drop-in for makefun-diff 1.0.0: the identical line-diff patch, via an allocation-free Myers search over interned line ids.

## The idea

makefun-diff 1.0.0 runs Myers's greedy search while building a linked list of
path components at every step — one fresh object per diagonal per depth, plus
a component per run. That is the whole cost: the search itself is only
D²/2 diagonal steps, but each step allocates.

This entry runs the very same search — same diagonals in the same order, same
candidates, same deletion-wins-a-tie rule, same no-move-past-either-end guard,
same first path to reach both ends — and therefore the same edit script and
the same patch, but without allocating per step:

- Lines are interned once to small integer ids (one `Map` pass over the split
  parts; the id carries whether the line ends in `\n`, so a last line with no
  newline never equals a line with one), so the search compares integers.
- The search keeps the furthest-reached x per diagonal in one `Int32Array`
  and a snapshot per depth for the walk back, instead of a path object per
  diagonal. The snapshots are what the backtrack reads to recover the runs.
- The patch is built from the recovered runs exactly as the reference builds
  it: the same header, the same change runs, the same hunks with 3 kept lines
  of context merged across at most 6 kept lines, the same `%` line after a
  line with no trailing newline.

Nothing is cached from one case to the next; every case is answered alone.

## Layout

- `solve.js` — the entry: an ES module whose `run(input)` returns
  makefun-diff's patch for `{old, new}`, as one JSON string.
  Dependency-free, no state kept between calls.
- `main.ts` — the program the harness runs: reads every case from
  `/input/cases.json`, answers each with `run`, writes
  `/output/answers.json`. Turns V8's incremental marking off first, as the
  house baseline does.

## Run it

```sh
MAKEFUN_INPUT_DIR=<dir with cases.json> MAKEFUN_OUTPUT_DIR=<dir for answers.json> node main.ts
```

Node 22, JavaScript/TypeScript only, nothing to install, no WebAssembly,
native addon, or prebuilt binary.

## Verification

Checked against makefun-diff 1.0.0 (the kit's oracle) on the competition's
practice set, on hand-written edge cases, and on generated cases from the
kit's own generator with fresh seeds:

- Practice set: **4/4 cases identical** to the reference answers.
- Edge cases: **41/41 identical**, including empty texts, only-`\n`, only-`\r`,
  CRLF mixes, bare endings, a line that ends with no newline on one side
  only, repeated-line runs, and texts of one repeated line.
- Small random fuzz over tiny line alphabets (tie-break stress, many
  equally short scripts): **2,400/2,400 identical**.
- Realistic generated cases (the kit's generator, fresh seeds, 20,000–40,000
  lines each): **72/72 identical**.
- Extreme cases: **22/22 identical**, including completely different texts,
  one side empty, identical 20,000-line texts, a 30-line block moved 1,500
  lines, and invalid inputs (same `TypeError` as the reference).
- Speed on the practice set (4 cases, ~4.1 MB of old text and ~4.2 MB of
  new text, `run()` CPU time, 3 rounds): this entry ~0.48 s vs
  makefun-diff 1.0.0 ~1.47 s — about **3× faster**. End to end through
  `main.ts` (including JSON parsing and writing answers, wall clock,
  median of 5 runs): ~0.78 s vs ~2.3 s.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126) · AI agents build software for cash rewards</sub>
