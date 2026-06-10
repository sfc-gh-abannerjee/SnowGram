// constants.mjs — geometry constants extracted from the viewer CSS.
//
// These mirror the `.zone .flow-node`, `.zone-*`, `.rank-column`,
// `.platform-boundary` and `.arch-layout` rules in
// assets/viewer/index.html (the <style> block). They drive the
// DOM-free deterministic geometry model in pack.mjs, replacing the
// browser layout the original engine measured via getBoundingClientRect.
//
// NOTE: pixel-exact parity with the browser viewer is NOT guaranteed —
// text wrapping is approximated (see measure.mjs). Coordinates are
// internally consistent and deterministic, which is what the routing
// math needs.

export const CARD = {
  // .zone .flow-node — padding: 16px 12px 14px
  padTop: 16,
  padRight: 12,
  padBottom: 14,
  padLeft: 12,
  // Effective track width of a card inside a zone column. The viewer uses
  // minmax(140px,1fr)/minmax(150px,1fr) + min-content; 160 is a stable
  // representative width that keeps labels off the icon.
  width: 160,
  // .icon — clamp(28,60%,44) box + margin-bottom 6
  iconBox: 44,
  iconMarginBottom: 6,
  // .label — font ~12.5px, line-height ~1.25, margin-bottom 2
  labelFont: 12.5,
  labelLineHeight: 1.25,
  labelMarginBottom: 2,
  // .detail — font ~10.5px, line-height 1.4
  detailFont: 10.5,
  detailLineHeight: 1.4,
};

export const ZONE = {
  border: 1.5,
  stripe: 4, // .zone-stripe height
  headerMinHeight: 68, // .zone-header min-height
  bodyPad: 20, // .zone-body padding
  rowGap: 18, // vertical gap between cards stacked in a zone column
  subColGap: 20, // .sub-group-col grid column gap
  fanoutColGap: 24, // intra-zone fan-out column gap
  subColMinWidth: 150,
  fanoutColMinWidth: 140,
};

export const LAYOUT = {
  outerColGap: 72, // .arch-layout gap (between non-boundary columns)
  rankColGap: 20, // .rank-column vertical gap (multi-zone column)
  // dynamic inner-grid gap inside the platform boundary
  dynGapBase: 48,
  dynGapStep: 14,
  dynGapCap: 96,
  // .platform-boundary border:2 dashed; padding:28px 24px 64px
  boundaryBorder: 2,
  boundaryPadTop: 28,
  boundaryPadSide: 24,
  boundaryPadBottom: 64,
  // outside-boundary columns get paddingTop:30 to align zone tops with
  // the boundary's border+padding inset.
  outsidePadTop: 30,
};

// Categories considered INSIDE the Snowflake Data Cloud boundary.
export const SNOW_CATEGORIES = { snow: 1, outcome: 1, bridge: 1 };

// Zone-consolidation qualifier whitelist (see renderFlow consolidation pass).
export const QUALIFIERS = {
  aws: 1, azure: 1, gcp: 1, oci: 1,
  east: 1, west: 1, us: 1, eu: 1, apac: 1,
  primary: 1, secondary: 1, dr: 1,
};
