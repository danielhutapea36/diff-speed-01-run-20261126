// A faster drop-in for makefun-diff 1.0.0 (make.fun's own line diff), written from scratch in this session.
// It returns exactly makefun-diff 1.0.0's patch for every input, by the rule in the house baseline's
// vendor/makefun-diff/index.js header: lines cut after every "\n" only, the common prefix then the common
// suffix kept, between them Myers's greedy search (deletion wins a tie, no move past either text's end, no
// edge-diagonal pruning, every run of equal lines followed as far as it goes), then the patch with 3 kept
// lines of context and hunks merged across at most 6 kept lines.
//
// Speed comes from doing the same search without the reference's per-step allocations: lines are interned
// to small integer ids (one Map pass over the split parts; the id carries whether the line ends in "\n",
// so a last line with no newline never equals a line with one), the search keeps furthest-reached x per
// diagonal in one Int32Array (a snapshot per depth for the walk back), and the patch is built from the
// recovered runs. No step of the search differs from the reference: same diagonals in the same order, same
// candidates, same tie-break, same first path to reach both ends, so the edit script — and therefore the
// patch — is identical.

/** The patch's first word. */
const FORMAT = 'makefun-diff/1';

/** The kept lines a hunk shows before and after each change run. */
const CONTEXT = 3;

const KEEP = 0;
const DELETE = 1;
const INSERT = 2;

/**
 * The runs of the edit script of A into B: [[kind, count], ...] in order, kinds KEEP/DELETE/INSERT,
 * by the reference's greedy search. A and B are Int32Arrays of interned line ids, N and M their lengths.
 */
function editRuns(A, B, N, M) {
  if (N === 0 && M === 0) return [];
  const maxD = N + M;
  const off = maxD + 1;
  // V[off + k] is the old lines consumed (x) by the furthest path on diagonal k at the depth being
  // computed, -1 when no path reaches it. Diagonals of one depth share parity, so a depth's writes
  // never clobber the previous depth's values a later diagonal of this depth still reads.
  const V = new Int32Array(2 * maxD + 3).fill(-1);
  // trace[d] is V's row after depth d, over k in [-d, d] (index k + d).
  const trace = [];

  // Depth 0: the snake from the first lines.
  let x = 0;
  let y = 0;
  while (x < N && y < M && A[x] === B[y]) { x++; y++; }
  V[off] = x;
  trace.push(Int32Array.of(x));
  if (x >= N && y >= M) return x > 0 ? [[KEEP, x]] : [];

  for (let d = 1; d <= maxD; d++) {
    let idx = off - d;
    for (let k = -d; k <= d; k += 2, idx += 2) {
      const xPrevDel = V[idx - 1];
      const xPrevIns = V[idx + 1];
      const canRemove = xPrevDel !== -1 && xPrevDel < N;
      // The insertion consumes new line xPrevIns - k - 1, which must exist: xPrevIns - k <= M.
      const canAdd = xPrevIns !== -1 && xPrevIns - k <= M;
      if (!canRemove && !canAdd) {
        V[idx] = -1;
        continue;
      }
      // The deletion's oldPos against the insertion's: the deletion wins when its x is no smaller.
      let xx;
      if (canRemove && (!canAdd || xPrevDel + 1 >= xPrevIns)) xx = xPrevDel + 1;
      else xx = xPrevIns;
      let yy = xx - k;
      while (xx < N && yy < M && A[xx] === B[yy]) { xx++; yy++; }
      V[idx] = xx;
      if (xx >= N && yy >= M) return backtrack(trace, d, k, xx, N, M);
    }
    trace.push(V.slice(off - d, off + d + 1));
  }
  throw new Error('makefun-diff: the search ended without reaching both ends');
}

/**
 * The runs of the path that first reached both ends at depth d, diagonal k, with x old lines consumed,
 * walked back through the snapshots. trace[dd] holds depth dd's row over k in [-dd, dd] at index k + dd.
 */
function backtrack(trace, d, k, x, N, M) {
  // Steps from the end back: each [move, snake] at its depth, snake the kept run after the move.
  const steps = new Array(d);
  let ck = k;
  let cx = x;
  for (let dd = d; dd >= 1; dd--) {
    const prev = trace[dd - 1];
    const xPrevDel = prev[(ck - 1) + (dd - 1)];
    const xPrevIns = prev[(ck + 1) + (dd - 1)];
    const canRemove = xPrevDel !== -1 && xPrevDel < N;
    const canAdd = xPrevIns !== -1 && xPrevIns - ck <= M;
    let xAfter;
    let move;
    if (canRemove && (!canAdd || xPrevDel + 1 >= xPrevIns)) {
      xAfter = xPrevDel + 1;
      move = DELETE;
      steps[dd - 1] = [move, cx - xAfter];
      cx = xPrevDel;
      ck = ck - 1;
    } else {
      xAfter = xPrevIns;
      move = INSERT;
      steps[dd - 1] = [move, cx - xAfter];
      cx = xPrevIns;
      ck = ck + 1;
    }
  }
  // Forward order: the depth-0 snake, then each depth's move and the snake after it, merged by kind.
  const runs = [];
  const push = (kind, count) => {
    if (count <= 0) return;
    const last = runs[runs.length - 1];
    if (last !== undefined && last[0] === kind) last[1] += count;
    else runs.push([kind, count]);
  };
  push(KEEP, cx);
  for (let dd = 1; dd <= d; dd++) {
    push(steps[dd - 1][0], 1);
    push(KEEP, steps[dd - 1][1]);
  }
  return runs;
}

/**
 * A line as the patch writes it: its op, the part, a newline, and "%" on a line of its own when the
 * line had none (the part is the text's last line and the text does not end in "\n").
 */
function written(op, part, hasNewline) {
  return hasNewline ? op + part + '\n' : op + part + '\n%\n';
}

/** make.fun's own patch of input.old into input.new, as one string. */
export function run(input) {
  if (input === null || typeof input !== 'object' || typeof input.old !== 'string' || typeof input.new !== 'string') {
    throw new TypeError('makefun-diff: the input is { old, new }, two strings');
  }
  // Split after every "\n"; a line is parts[i], with a newline exactly when i is not the last part.
  const pa = input.old.split('\n');
  const pb = input.new.split('\n');
  const n = pa.length - (pa[pa.length - 1] === '' ? 1 : 0);
  const m = pb.length - (pb[pb.length - 1] === '' ? 1 : 0);

  // Intern every distinct line part to an id; the id carries whether the line ends in "\n".
  const ids = new Map();
  const ai = new Int32Array(n);
  const bi = new Int32Array(m);
  let next = 0;
  for (let i = 0; i < n; i++) {
    const s = pa[i];
    let id = ids.get(s);
    if (id === undefined) { id = next++; ids.set(s, id); }
    ai[i] = id * 2 + (i < pa.length - 1 ? 1 : 0);
  }
  for (let i = 0; i < m; i++) {
    const s = pb[i];
    let id = ids.get(s);
    if (id === undefined) { id = next++; ids.set(s, id); }
    bi[i] = id * 2 + (i < pb.length - 1 ? 1 : 0);
  }

  // The common prefix, then the common suffix of what is left.
  let prefix = 0;
  while (prefix < n && prefix < m && ai[prefix] === bi[prefix]) prefix++;
  let suffix = 0;
  while (suffix < n - prefix && suffix < m - prefix && ai[n - 1 - suffix] === bi[m - 1 - suffix]) suffix++;

  const runs = [];
  if (prefix > 0) runs.push([KEEP, prefix]);
  runs.push(...editRuns(ai.subarray(prefix, n - suffix), bi.subarray(prefix, m - suffix), n - prefix - suffix, m - prefix - suffix));
  if (suffix > 0) runs.push([KEEP, suffix]);

  // The change runs: each a stretch of deletions and insertions between two kept lines, at old line o and new line p.
  const changes = [];
  let o = 0;
  let p = 0;
  let deleted = 0;
  let inserted = 0;
  for (let ri = 0; ri < runs.length; ri++) {
    const kind = runs[ri][0];
    const count = runs[ri][1];
    if (kind === KEEP) {
      o += count;
      p += count;
      continue;
    }
    let c = changes[changes.length - 1];
    if (c === undefined || c.o + c.dels !== o || c.p + c.ins !== p) {
      c = { o, p, dels: 0, ins: 0 };
      changes.push(c);
    }
    if (kind === DELETE) {
      c.dels += count;
      o += count;
      deleted += count;
    } else {
      c.ins += count;
      p += count;
      inserted += count;
    }
  }

  // The hunks: change runs at most 2 * CONTEXT kept lines apart share one.
  const hunks = [];
  for (let ci = 0; ci < changes.length; ci++) {
    const c = changes[ci];
    const h = hunks[hunks.length - 1];
    const prev = h !== undefined ? h[h.length - 1] : undefined;
    if (prev !== undefined && c.o - (prev.o + prev.dels) <= 2 * CONTEXT) h.push(c);
    else hunks.push([c]);
  }
  const out = [FORMAT + ' old=' + n + ' new=' + m + ' hunks=' + hunks.length + ' deleted=' + deleted + ' inserted=' + inserted + '\n'];
  const aLast = pa.length - 1;
  const bLast = pb.length - 1;
  for (let hi = 0; hi < hunks.length; hi++) {
    const h = hunks[hi];
    const first = h[0];
    const last = h[h.length - 1];
    const oldStart = Math.max(0, first.o - CONTEXT);
    const newStart = first.p - (first.o - oldStart);
    const after = Math.min(CONTEXT, n - (last.o + last.dels));
    const oldEnd = last.o + last.dels + after;
    const newEnd = last.p + last.ins + after;
    out.push('@ ' + (oldStart + 1) + ' ' + (oldEnd - oldStart) + ' ' + (newStart + 1) + ' ' + (newEnd - newStart) + '\n');
    let at = oldStart;
    for (let ci = 0; ci < h.length; ci++) {
      const c = h[ci];
      for (; at < c.o; at++) out.push(written('=', pa[at], at < aLast));
      for (let i = 0; i < c.dels; i++) out.push(written('-', pa[c.o + i], c.o + i < aLast));
      for (let i = 0; i < c.ins; i++) out.push(written('+', pb[c.p + i], c.p + i < bLast));
      at = c.o + c.dels;
    }
    for (; at < oldEnd; at++) out.push(written('=', pa[at], at < aLast));
  }
  return out.join('');
}
