// model.mjs — input front-ends. Both accepted:
//   1. Graph metadata JSON: { nodes:[{id,label,componentType?,boundary?,
//      zone?,category?,detail?}], edges:[{from,to}|{source,target}], zones?,
//      containers?:[{id,label,zone_names?,node_ids?,container_ids?}] }
//   2. Mermaid flowchart string: { mermaid: "flowchart LR ..." }
//
// Both normalize to the internal model the layout consumes:
//   { nodes:[{id,label,detail,category,zone}], edges:[{source,target}],
//     zones:[{name,category,node_ids}], containers:[{id,label,zone_names,
//     node_ids,container_ids}], consolidate, consolidate_sub_groups }
//
// `containers` (Phase 2) are optional, arbitrary-depth grouping boxes (e.g.
// "AWS VPC", "On-Prem Data Center") layered ON TOP of zones: a container
// declares which zones (by name) and/or which OTHER containers (by id, for
// nesting) it wraps. They do not replace zones -- pack.mjs resolves the
// actual geometry; this layer only carries the declared membership through
// unchanged, dropping anything malformed rather than throwing.
//
// Geometry note: node `icon` does NOT affect layout (the card always
// reserves a fixed icon box height), so icon resolution is intentionally
// omitted here — only `category` (boundary tinting / snow-vs-external)
// and `zone` (grouping) matter to the math.

const CATEGORY_BY_TYPE = {
  // external (outside the Snowflake boundary)
  s3: 'onprem', kafka: 'onprem', kinesis: 'onprem', azure_blob: 'onprem',
  gcs: 'onprem', api: 'onprem', saas: 'onprem', external: 'onprem',
  oltp: 'onprem', database: 'onprem', bi_tool: 'outcome',
  dbt: 'onprem', airflow: 'onprem', fivetran: 'onprem', matillion: 'onprem',
  informatica: 'onprem', talend: 'onprem',
  // bridge (Snowflake-managed ingestion / connectivity)
  pipe: 'bridge', snowpipe: 'bridge', openflow: 'bridge', connector: 'bridge',
  secure_view: 'bridge',
  // snow (native)
  table: 'snow', dynamic_table: 'snow', view: 'snow', stream: 'snow',
  task: 'snow', warehouse: 'snow', stage: 'snow', schema: 'snow',
  cortex: 'snow', snowpark: 'snow', iceberg: 'snow', governance: 'snow',
  // outcome (native consumers)
  dashboard: 'outcome', app: 'outcome', agent: 'outcome', notebook: 'outcome',
  streamlit: 'outcome', user: 'outcome',
};

function categoryFrom(node) {
  if (node.category) return node.category;
  const t = String(node.componentType || node.object_type || '').toLowerCase();
  if (CATEGORY_BY_TYPE[t]) return CATEGORY_BY_TYPE[t];
  // boundary hint: 'external'/'outside' -> onprem; default snow
  const b = String(node.boundary || '').toLowerCase();
  if (b.includes('external') || b.includes('outside') || b.includes('source')) return 'onprem';
  // Generic vendor-prefix heuristic: any non-Snowflake cloud vendor's OWN
  // service (azure_*, aws_*, gcp_*, google_*) is virtually always outside
  // the Snowflake account boundary even when explicit metadata is missing
  // -- e.g. azure_synapse, azure_data_factory, aws_glue, gcp_dataflow.
  // This intentionally also covers azure_private_link/aws_privatelink:
  // that's network plumbing, not a Snowflake object -- 'bridge' above is
  // reserved for actual Snowflake-native ingestion services (Snowpipe).
  if (/^(azure|aws|gcp|google)_/.test(t)) return 'onprem';
  // Third-party BI/reporting tools are external consumers -- NOT the same
  // as a native Snowflake-served surface (Streamlit, Cortex agent), which
  // is what 'outcome' otherwise means (boundary-triggering, i.e. inside
  // the account). Power BI/Tableau/etc. sit outside it.
  if (/(power_?bi|tableau|looker|qlik|sigma)/.test(t)) return 'onprem';
  // A DIFFERENT/external Snowflake account (e.g. an inbound share
  // provider) is not part of THIS account's boundary either.
  if (t === 'snowflake_account') return 'onprem';
  return 'snow';
}

// A cloud vendor's PRIVATE CONNECTIVITY construct (Azure Private Link, AWS
// PrivateLink) is network plumbing that bridges two boundaries rather than
// a full service living inside either one -- render it as a small
// icon+caption chip (see measure.mjs) instead of a normal card.
function isGatewayLike(node) {
  const t = String(node.componentType || node.object_type || '').toLowerCase();
  const l = String(node.label || '').toLowerCase();
  return /private[\s_-]?link/.test(t) || /private[\s_-]?link/.test(l);
}

// Ensure zones exist and node_ids are populated (mirrors the viewer's
// defensive backfill).
function normalize(model) {
  const nodes = (model.nodes || []).map(n => ({
    id: n.id,
    label: n.label != null ? n.label : n.id,
    detail: n.detail || '',
    // Needed by measure.mjs to size the .fn-sub componentType badge line --
    // dropping this field here silently zeroed that line out of every card's
    // computed height (found 2026-09-09: cards with a detail line clipped
    // their last line because subH always computed to 0 through the real
    // pipeline, even though measureNode itself correctly accounts for it).
    componentType: n.componentType || '',
    category: categoryFrom(n),
    zone: n.zone || n.boundary || 'Main',
    // 'gateway' shrinks the card to a small icon+caption chip (see
    // measure.mjs/measureNodeGateway) for network-plumbing nodes (Azure
    // Private Link, AWS PrivateLink) that are a bridge/connector, not a
    // full service -- auto-detected from componentType/label so the agent
    // doesn't need to know about this render detail.
    style: n.style || (isGatewayLike(n) ? 'gateway' : null),
  }));
  const edges = (model.edges || []).map(e => ({
    source: e.source != null ? e.source : e.from,
    target: e.target != null ? e.target : e.to,
  })).filter(e => e.source != null && e.target != null);

  let zones = Array.isArray(model.zones) && model.zones.length
    ? model.zones.map(z => ({
        name: z.name,
        category: z.category,
        node_ids: Array.isArray(z.node_ids) ? z.node_ids.slice() : null,
        sub_groups: z.sub_groups || null,
      }))
    : null;

  if (!zones) {
    // Derive zones from node.zone, preserving first-seen order.
    const order = [];
    const byZone = {};
    nodes.forEach(n => {
      if (!byZone[n.zone]) { byZone[n.zone] = []; order.push(n.zone); }
      byZone[n.zone].push(n.id);
    });
    zones = order.map(name => ({
      name,
      category: nodes.find(n => n.zone === name).category,
      node_ids: byZone[name],
      sub_groups: null,
    }));
  } else {
    // backfill node_ids + category
    zones.forEach(z => {
      if (!z.node_ids || !z.node_ids.length) {
        z.node_ids = nodes.filter(n => n.zone === z.name).map(n => n.id);
      }
      if (!z.category) {
        const first = nodes.find(n => z.node_ids.includes(n.id));
        z.category = first ? first.category : 'snow';
      }
    });
  }

  const nodeIdSet = {}; nodes.forEach(n => { nodeIdSet[n.id] = true; });

  // A zone whose members are ALL explicitly styled 'chip' (e.g. inline
  // medallion pipeline stages -- Bronze/Silver/Gold) renders as a compact
  // single-row strip of connected pills instead of stacked full-size cards.
  // Opt-in only (no auto-detection): the agent marks each such node
  // "style":"chip" itself, since nothing about a node's componentType alone
  // reliably signals "this belongs in an inline pipeline chip-row".
  const nodeStyleById = {}; nodes.forEach(n => { nodeStyleById[n.id] = n.style; });
  zones.forEach(z => {
    const ids = z.node_ids || [];
    z.chipRow = ids.length > 0 && ids.every(id => nodeStyleById[id] === 'chip');
  });

  const containers = Array.isArray(model.containers)
    ? model.containers
        .filter(c => c && c.id != null)
        .map(c => ({
          id: String(c.id),
          label: c.label != null ? c.label : String(c.id),
          subtitle: c.subtitle != null ? String(c.subtitle) : null,
          color: c.color != null ? String(c.color) : null,
          zone_names: Array.isArray(c.zone_names) ? c.zone_names.slice() : [],
          node_ids: Array.isArray(c.node_ids) ? c.node_ids.filter(id => nodeIdSet[id]) : [],
          container_ids: Array.isArray(c.container_ids) ? c.container_ids.map(String) : [],
          // A container can wrap the Snowflake platform boundary itself as
          // one of its children -- e.g. a "Microsoft Azure" container for a
          // Snowflake-on-Azure deployment, alongside the customer's own
          // same-cloud resources. At most one container should set this;
          // pack.mjs defensively ignores extras rather than erroring.
          include_platform_boundary: c.include_platform_boundary === true,
        }))
    : [];

  return {
    nodes, edges, zones, containers,
    consolidate: model.consolidate !== false,
    consolidate_sub_groups: model.consolidate_sub_groups === true,
    nodeStyle: model.nodeStyle || null,
    boundaryLabel: model.boundaryLabel != null ? String(model.boundaryLabel) : null,
    boundarySubtitle: model.boundarySubtitle != null ? String(model.boundarySubtitle) : null,
  };
}

export function fromGraphJSON(model) {
  return normalize(model);
}

// Minimal mermaid flowchart parser. Handles:
//   - node decls: A[Label]  A("Label")  A{Label}  A[("Label")]
//   - edges: A --> B   A -->|label| B   A --- B
//   - subgraph NAME ... end  -> zone grouping
//   - classDef NAME ...; class A,B NAME -> category (sf/snow/etc.)
export function fromMermaid(src) {
  const lines = String(src || '').split('\n');
  const nodes = {};
  const edges = [];
  const order = [];
  const zoneStack = [];
  const nodeZone = {};
  const classOf = {};
  const classCategory = {};

  const declRe = /([A-Za-z0-9_]+)\s*(?:\[\(?"?(.*?)"?\)?\]|\("?(.*?)"?\)|\{"?(.*?)"?\})/;
  const edgeRe = /([A-Za-z0-9_]+)\s*(?:--|==|-\.)>?(?:\|([^|]*)\|)?\s*-?-?>?\s*([A-Za-z0-9_]+)/;

  function ensure(id, label) {
    if (!nodes[id]) { nodes[id] = { id, label: label || id, detail: '' }; order.push(id); }
    else if (label) nodes[id].label = label;
    if (zoneStack.length) nodeZone[id] = zoneStack[zoneStack.length - 1];
  }

  for (let raw of lines) {
    const line = raw.trim();
    if (!line || /^(flowchart|graph)\b/i.test(line)) continue;

    let m;
    if (/^subgraph\b/i.test(line)) {
      // subgraph Id [Title]  OR  subgraph Title
      const sm = line.match(/^subgraph\s+(?:[A-Za-z0-9_]+\s*\[\s*"?(.*?)"?\s*\]|"?(.*?)"?)\s*$/i);
      const name = (sm && (sm[1] || sm[2])) ? (sm[1] || sm[2]) : ('Zone ' + (zoneStack.length + 1));
      zoneStack.push(name.trim());
      continue;
    }
    if (/^end$/i.test(line)) { zoneStack.pop(); continue; }
    if (/^classDef\b/i.test(line)) {
      const cm = line.match(/^classDef\s+([A-Za-z0-9_]+)/i);
      if (cm) classCategory[cm[1]] = inferCategory(cm[1], line);
      continue;
    }
    if (/^class\b/i.test(line)) {
      const cm = line.match(/^class\s+([^ ]+)\s+([A-Za-z0-9_]+)/i);
      if (cm) cm[1].split(',').forEach(id => { classOf[id.trim()] = cm[2]; });
      continue;
    }

    // edge line (may also declare both endpoints with labels)
    if ((m = line.match(edgeRe)) && /-|=|>/.test(line)) {
      const a = line.match(new RegExp('^\\s*' + declRe.source));
      // declare endpoints with any inline labels
      const parts = line.split(/--+>?|==+>?|-\.->?/);
      // fall through to generic: capture both ids + their labels via declRe scan
    }

    // Generic: find all node declarations on the line
    let scan = line;
    let dm;
    const declGlobal = new RegExp(declRe.source, 'g');
    while ((dm = declGlobal.exec(scan)) !== null) {
      const id = dm[1];
      const label = dm[2] || dm[3] || dm[4] || '';
      ensure(id, label);
    }

    // Edge endpoints
    const em = line.match(edgeRe);
    if (em && (line.includes('>') || line.includes('---'))) {
      const s = em[1], t = em[3];
      ensure(s);
      ensure(t);
      if (s && t && s !== t) edges.push({ source: s, target: t });
    }
  }

  const nodeArr = order.map(id => {
    const cls = classOf[id];
    const category = cls && classCategory[cls] ? classCategory[cls] : 'snow';
    return {
      id,
      label: nodes[id].label,
      detail: '',
      category,
      zone: nodeZone[id] || 'Main',
    };
  });

  return normalize({ nodes: nodeArr, edges });
}

function inferCategory(className, line) {
  const c = (className + ' ' + line).toLowerCase();
  if (/onprem|external|source|kafka|s3/.test(c)) return 'onprem';
  if (/bridge|pipe|openflow/.test(c)) return 'bridge';
  if (/outcome|bi|dashboard|consum/.test(c)) return 'outcome';
  return 'snow';
}

// Dispatch on input shape.
export function toModel(input) {
  if (input == null) throw new Error('layout: input is required');
  if (typeof input === 'string') return fromMermaid(input);
  if (input.mermaid && !(input.nodes && input.nodes.length)) return fromMermaid(input.mermaid);
  return fromGraphJSON(input);
}
