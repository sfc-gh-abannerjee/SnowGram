// quality.mjs — generic, style-agnostic layout-quality checks computed
// purely from packed/routed geometry (no rendering required). Deliberately
// does NOT dictate any particular visual arrangement -- it only flags
// objectively bad geometry (unbounded aspect ratio, connector/card
// crossings, mostly-empty canvas), so any clean layout shape passes.
//
// Used by: (1) tests/run.mjs as reusable invariants instead of duplicated
// logic, (2) index.mjs, which attaches the result to every layout() call so
// a caller (e.g. the GENERATE_DIAGRAM_ARTIFACTS proc) can inspect it with no
// extra SVG round-trip, and (3), eventually, the live agent's Layout Quality
// Gate to decide whether to retry with adjusted zone/layer/consolidation
// hints (see docs/AGENT_TOOL_SNIPPET.yaml — Phase 4b, not this file).

// segment vs rect-interior crossing (with tolerance) — same definition the
// test suite already used for "0 card crossings".
function segCrossesRect(p1, p2, r, tol = 2) {
  const x1 = p1[0], y1 = p1[1], x2 = p2[0], y2 = p2[1];
  const L = r.x + tol, R = r.x + r.w - tol, T = r.y + tol, B = r.y + r.h - tol;
  if (R <= L || B <= T) return false;
  if (Math.abs(x1 - x2) < 0.5) { // vertical
    const x = x1; if (x <= L || x >= R) return false;
    const lo = Math.min(y1, y2), hi = Math.max(y1, y2);
    return lo < B && hi > T;
  }
  if (Math.abs(y1 - y2) < 0.5) { // horizontal
    const y = y1; if (y <= T || y >= B) return false;
    const lo = Math.min(x1, x2), hi = Math.max(x1, x2);
    return lo < R && hi > L;
  }
  return false; // diagonal (arcs) — ignore, matches the test suite's tolerance
}

// Thresholds are deliberately loose defaults, not "the" correct style — they
// exist to catch objectively bad geometry (the exact 16:1/unbounded-width
// and mostly-empty-canvas pathologies measured against the live agent), not
// to enforce a particular look. Override via opts if a caller has a
// different tolerance (e.g. a deliberately airy poster layout).
const DEFAULTS = {
  maxAspectRatio: 6,
  minPackingDensity: 0.03, // total card area / canvas area
};

export function assessQuality(result, opts) {
  const cfg = Object.assign({}, DEFAULTS, opts || {});
  const nodes = result.nodes || [];
  const edges = result.edges || [];
  const width = result.width || 0;
  const height = result.height || 0;
  const issues = [];

  const aspectRatio = (width > 0 && height > 0) ? Math.max(width / height, height / width) : Infinity;
  if (aspectRatio > cfg.maxAspectRatio) {
    issues.push({ code: 'ASPECT_RATIO', detail: 'aspect=' + aspectRatio.toFixed(2) + ' exceeds ' + cfg.maxAspectRatio + ' (canvas is growing unboundedly in one dimension)' });
  }

  // NOTE (2026-09-09): tried tightening this to only exempt the segment
  // immediately adjacent to e.from/e.to (rather than all segments), hoping
  // to catch a routing bug where a forced port choice sent a path back
  // through its own source's card. Reverted: a legitimate 2-segment
  // departure/arrival "elbow" (leave via one side, short jog still inside
  // the box's own footprint, then turn toward the target) is geometrically
  // IDENTICAL to that bug at the segment level -- tightening it flagged 3
  // pre-existing, visually-correct fixtures (medallion WIDE, fan-in/fan-out,
  // row-wrap stress) as false positives. This bug class is only reliably
  // distinguishable at the ROUTING level (is the chosen port side
  // consistent with the target's actual zone-relative direction?), not by
  // pattern-matching rendered segment geometry after the fact -- see
  // route.mjs's roughDirection()-scoped port bias and its dedicated tests.
  let cardCrossings = 0;
  edges.forEach(e => {
    const pts = e.points || [];
    for (let i = 0; i < pts.length - 1; i++) {
      nodes.forEach(n => {
        if (n.id === e.from || n.id === e.to) return;
        if (segCrossesRect(pts[i], pts[i + 1], n)) cardCrossings++;
      });
    }
  });
  if (cardCrossings > 0) {
    issues.push({ code: 'CARD_CROSSING', detail: cardCrossings + ' connector segment(s) cross a non-endpoint card' });
  }

  const totalCardArea = nodes.reduce((sum, n) => sum + (n.w || 0) * (n.h || 0), 0);
  const canvasArea = width * height;
  const packingDensity = canvasArea > 0 ? totalCardArea / canvasArea : 0;
  if (canvasArea > 0 && packingDensity < cfg.minPackingDensity) {
    issues.push({ code: 'SPARSE_CANVAS', detail: 'packing density=' + (packingDensity * 100).toFixed(1) + '% below ' + (cfg.minPackingDensity * 100) + '% (canvas is mostly empty space)' });
  }

  return {
    ok: issues.length === 0,
    issues,
    metrics: { width, height, aspectRatio, cardCrossings, packingDensity },
  };
}

// Semantic check, NOT purely geometric like assessQuality() above -- catches
// the class of bug found 2026-09-09: a zone's rendered category (and
// therefore which side of the platform boundary it lands on) is taken from
// its FIRST member node, so mixing e.g. an onprem node and an outcome node
// in the same zone/layer silently sweeps the second node's category to
// wherever the first node's category happens to place it (a Streamlit
// dashboard rendered outside the Snowflake boundary because it shared a
// layer with an external data-share consumer). assessQuality() cannot see
// this -- it never receives per-node category, only geometry -- so this is
// a separate function index.mjs merges into the same result.quality.
//
// Only flags a mismatch that crosses the BOUNDARY SIDE (onprem = outside;
// snow/bridge/outcome = inside, mirroring pack.mjs's own SNOW_CATEGORIES).
// snow/bridge/outcome nodes sharing one zone is fine -- they land on the
// same side either way (a real, benign pattern e.g. the row_wrap_stress
// fixture's "Apps" zone mixing a 'snow'-category Cortex node with an
// 'outcome'-category Streamlit node, both correctly inside the boundary).
//
// nodeCategoryById: { [nodeId]: category } for every real (non-dummy) node.
// zones: [{ name, category, node_ids }] -- the zones actually rendered.
function boundarySide(category) {
  return category === 'onprem' ? 'outside' : 'inside';
}

export function checkCategoryConsistency(nodeCategoryById, zones) {
  const issues = [];
  (zones || []).forEach(z => {
    const ids = (z.node_ids || []).filter(id => nodeCategoryById[id] != null);
    const zoneSide = boundarySide(z.category);
    const mismatched = ids.filter(id => boundarySide(nodeCategoryById[id]) !== zoneSide);
    if (mismatched.length) {
      issues.push({
        code: 'MIXED_CATEGORY_ZONE',
        detail: 'zone "' + z.name + '" is rendered ' + zoneSide + ' the platform boundary (category="' + z.category +
          '") but contains node(s) ' + JSON.stringify(mismatched) + ' whose own category places them ' +
          boundarySide(nodeCategoryById[mismatched[0]]) + ' it instead. Put nodes that belong on different sides ' +
          'of the boundary in separate zones/layers.',
      });
    }
  });
  return { ok: issues.length === 0, issues };
}

