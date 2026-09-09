// measure.mjs — deterministic, DOM-free text + node sizing.
//
// The original engine let the browser lay out each card and read sizes
// back via getBoundingClientRect. Here we compute card width/height
// analytically from the CSS constants in constants.mjs.
//
// Text width is approximated with an average-glyph-width heuristic by
// default. For pixel-accurate sizing in a browser (or node-canvas),
// inject a `measureText(text, fontPx) -> widthPx` function via opts.
//
// Wrapping mirrors the CSS `word-break: break-word; overflow-wrap:
// anywhere` — i.e. text wraps at the content width regardless of word
// boundaries, so line count is ceil(totalGlyphWidth / wrapWidth).

import { CARD, CARD_WIDE } from './constants.mjs';

// Average glyph width as a fraction of font size for the UI font stack.
// Tuned to a mid value for a typical sans-serif; close enough for line
// counts without a real text metric.
//
// Biased slightly high (0.52 -> 0.58) on 2026-09-09: measured against the
// actual rendered .fn-title (font-weight 600) and .fn-sub (uppercase,
// letter-spacing) elements, both of which are consistently WIDER than a
// regular-weight glyph -- 0.52 undercounted wrapped lines for both (e.g.
// "Inbound Secure Data Share" measured 2 lines at 0.52 but rendered 3;
// "azure blob storage" measured 1 line but rendered 2), so the resulting
// card height came up short and the browser's `overflow:hidden` clipped
// the last line. Underestimating wrap height is much worse than
// overestimating it (clipped text vs. a few px of harmless extra padding),
// so bias toward the higher ratio rather than a per-weight-exact model.
const AVG_GLYPH_RATIO = 0.58;

export function defaultMeasureText(text, fontPx) {
  if (!text) return 0;
  return String(text).length * fontPx * AVG_GLYPH_RATIO;
}

// Number of wrapped lines for `text` at `fontPx` within `wrapWidth`.
function lineCount(text, fontPx, wrapWidth, measureText) {
  if (!text) return 0;
  const w = measureText(text, fontPx);
  if (w <= wrapWidth) return 1;
  return Math.max(1, Math.ceil(w / wrapWidth));
}

// Compute { w, h } for a single node card given its label + detail.
export function measureNode(node, opts = {}) {
  const measureText = opts.measureText || defaultMeasureText;
  if (node.style === 'gateway') return measureNodeGateway(node, measureText);
  if (node.style === 'chip') return measureNodeChip(node, measureText);
  if (opts.nodeStyle === 'wide') return measureNodeWide(node, opts, measureText);

  const w = opts.cardWidth || CARD.width;
  const wrapWidth = w - CARD.padLeft - CARD.padRight;

  const labelLineH = CARD.labelFont * CARD.labelLineHeight;
  const subLineH = CARD.subFont * CARD.subLineHeight;
  const detailLineH = CARD.detailFont * CARD.detailLineHeight;

  const labelLines = lineCount(node.label, CARD.labelFont, wrapWidth, measureText);
  const subLines = lineCount(node.componentType, CARD.subFont, wrapWidth, measureText);
  const detailLines = lineCount(node.detail, CARD.detailFont, wrapWidth, measureText);

  const iconH = CARD.iconBox + CARD.iconMarginBottom;
  // .fn-title has no margin of its own; .fn-sub and .fn-detail each carry
  // their own independent margin-top:2px (unlike CARD_WIDE's flex `gap`,
  // which applies once per boundary -- these are two separate CSS spacing
  // models, see measureNodeWide's gapH comment for the wide one).
  const labelH = labelLines * labelLineH;
  const subH = subLines * subLineH + (subLines ? CARD.subMarginTop : 0);
  const detailH = detailLines * detailLineH + (detailLines ? CARD.detailMarginTop : 0);

  const h = CARD.padTop + iconH + labelH + subH + detailH + CARD.padBottom;
  // Icon's own vertical center, as an offset from the card's top edge --
  // fixed regardless of label length, since the icon always sits first
  // with the label/detail stacked below it. Routing uses this (rather than
  // the card's raw geometric center) to anchor left/right connector ports,
  // so they land on the icon's graphic instead of drifting into the label
  // text as labels get longer/wrap to more lines (found via direct SVG
  // coordinate measurement: a fan-out port offset pushed a connector's
  // terminal stub to land within 3px of a card's own label text, visually
  // striking through it).
  //
  // NOTE: this intentionally uses the hardcoded `+8` icon-top offset that
  // the vendored static-SVG renderer (_svg() in render_diagram_generated.py,
  // `iy = Y(y) + 8`) actually draws with -- NOT CARD.padTop (16). The two
  // constants describe different things: CARD.padTop is the interactive
  // HTML viewer's CSS padding (mirrored here for card *height* sizing),
  // while the static SVG export's icon placement is a separate, simpler
  // hand-rolled absolute offset that does not read CARD.padTop at all. Using
  // padTop here would anchor ports 8px below where the icon is actually
  // drawn, right back into the label row this fix exists to avoid.
  const iconCenterY = 8 + CARD.iconBox / 2;
  return { w, h: Math.round(h), iconCenterY, iconHalfHeight: CARD.iconBox / 2 };
}

// Small icon-only chip + a one-line caption underneath, for network-plumbing
// "gateway" nodes (Azure Private Link, AWS PrivateLink) that bridge two
// boundaries rather than living fully inside either one. Deliberately much
// narrower than a normal card and skips the `detail` line entirely -- a
// gateway node's whole purpose is a small, minimal visual footprint.
const GATEWAY = { width: 88, iconBox: 32, padTop: 8, padBottom: 6, captionFont: 9, captionLineHeight: 1.15 };

function measureNodeGateway(node, measureText) {
  const w = GATEWAY.width;
  const wrapWidth = w - 8;
  const captionLines = lineCount(node.label, GATEWAY.captionFont, wrapWidth, measureText);
  const captionLineH = GATEWAY.captionFont * GATEWAY.captionLineHeight;
  const captionH = Math.max(1, captionLines) * captionLineH;
  const h = GATEWAY.padTop + GATEWAY.iconBox + captionH + GATEWAY.padBottom;
  const iconCenterY = GATEWAY.padTop + GATEWAY.iconBox / 2;
  return { w, h: Math.round(h), iconCenterY, iconHalfHeight: GATEWAY.iconBox / 2 };
}

// Single-line pill sized to its own label, for a "chip-row" zone -- a
// compact inline pipeline (e.g. Bronze -> Silver -> Gold medallion stages)
// rendered as small connected pills in one row instead of stacked full-size
// cards. Width is intentionally per-node (not the fixed CARD.width every
// other node style shares), since sibling chips' labels are rarely the
// same length.
const CHIP = { minWidth: 64, padX: 14, height: 30, font: 10.5 };

function measureNodeChip(node, measureText) {
  // Chip labels render bold (font-weight:700), which the default
  // glyph-width heuristic (tuned for regular weight) underestimates --
  // pad the measured width so the pill doesn't visually clip the label.
  const textW = measureText(String(node.label || node.id || ''), CHIP.font) * 1.2;
  const w = Math.max(CHIP.minWidth, Math.ceil(textW) + CHIP.padX * 2);
  return { w, h: CHIP.height, iconCenterY: CHIP.height / 2, iconHalfHeight: CHIP.height / 2 };
}

// Wide (icon-left) card: icon sits BESIDE the text, so height is
// pad + max(icon, label+detail) + pad — not the stacked sum. The text column
// is the card width minus the icon, gap, and side padding.
function measureNodeWide(node, opts, measureText) {
  const C = CARD_WIDE;
  const w = opts.cardWidth || C.width;
  const wrapWidth = w - C.padLeft - C.padRight - C.iconBox - C.iconGap;

  const labelLineH = C.labelFont * C.labelLineHeight;
  const subLineH = C.subFont * C.subLineHeight;
  const detailLineH = C.detailFont * C.detailLineHeight;

  const labelLines = lineCount(node.label, C.labelFont, wrapWidth, measureText);
  const subLines = lineCount(node.componentType, C.subFont, wrapWidth, measureText);
  const detailLines = lineCount(node.detail, C.detailFont, wrapWidth, measureText);

  // .fn-text is a flex column with `gap:var(--title-gap)` applied between
  // EVERY pair of visible children (title/sub/detail) -- one gap per
  // boundary between two present elements, not per element. Previously
  // this double-counted the title-sub gap while never counting the
  // sub-detail gap at all (found 2026-09-09 via residual clipping after
  // the subH fix: cards with both a componentType AND a detail line were
  // still short by ~1-2px).
  const segments = 1 + (subLines ? 1 : 0) + (detailLines ? 1 : 0);
  const gapH = Math.max(0, segments - 1) * C.titleGap;

  const labelH = labelLines * labelLineH;
  // .fn-sub (the componentType badge) renders between title and detail
  // whenever componentType is set -- see constants.mjs CARD.subFont comment.
  const subH = subLines * subLineH;
  const detailH = detailLines * detailLineH;
  const textH = labelH + subH + detailH + gapH;

  const h = C.padTop + Math.max(C.iconBox, textH) + C.padBottom;
  // Icon sits centered within the max(iconBox, textH) content band, so its
  // own vertical center coincides with that band's center -- see the narrow
  // measureNode's iconCenterY comment for why routing needs this.
  const iconCenterY = C.padTop + Math.max(C.iconBox, textH) / 2;
  return { w, h: Math.round(h), iconCenterY, iconHalfHeight: C.iconBox / 2 };
}
