CREATE OR REPLACE PROCEDURE "GENERATE_DIAGRAM_ARTIFACTS"("NODES" VARCHAR, "EDGES" VARCHAR, "TITLE" VARCHAR, "EXPORT_NAME" VARCHAR DEFAULT null, "DOC_JSON" VARCHAR DEFAULT null, "CONTAINERS" VARCHAR DEFAULT null, "BOUNDARY_LABEL" VARCHAR DEFAULT null, "BOUNDARY_SUBTITLE" VARCHAR DEFAULT null)
RETURNS VARIANT
LANGUAGE PYTHON
RUNTIME_VERSION = '3.11'
PACKAGES = ('snowflake-snowpark-python', 'weasyprint', 'pdf2image', 'poppler', 'pillow')
HANDLER = 'run'
COMMENT='Portable diagram artifacts. Resolves icons (COMPONENT_ICON_MAP then ICON_SEARCH) + boundary category, computes geometry via CORE.LAYOUT_DIAGRAM, renders all modalities via CORE.RENDER_DIAGRAM with an embedded documentation panel (overview/component summary/best practices/cited sources passed in DOC_JSON), writes to @AGENTS.DIAGRAM_EXPORTS, logs resolutions, returns compact payload. DOC_JSON shape: {"overview","components":[{"component","role"}],"best_practices":[{"text","source_title","source_url"}]}. BOUNDARY_LABEL/BOUNDARY_SUBTITLE optionally override the default "Snowflake Data Cloud" caption on the account boundary box (e.g. "SNOWFLAKE ON AZURE" / "Region: East US 2").'
EXECUTE AS OWNER
AS $$
import json, io, re

def _slug(s):
    s = (s or 'diagram').lower()
    s = re.sub(r'[^a-z0-9]+', '_', s).strip('_')
    return s or 'diagram'

def _coerce(x):
    if x is None:
        return []
    if isinstance(x, str):
        x = x.strip()
        if not x:
            return []
        return json.loads(x)
    return list(x)

def _resolve(session, label, ctype):
    r = session.sql("SELECT TEMP.ABANNERJEE.MAP_ICON_PATH(?, ?) AS P", params=[ctype, label]).collect()
    p = r[0]['P'] if r else None
    if p:
        rr = session.sql("SELECT svg_base64_data_uri AS U FROM TEMP.ABANNERJEE.ICON_CATALOG WHERE relative_path=? LIMIT 1", params=[p]).collect()
        return p, 'map', (rr[0]['U'] if rr else None)
    q = json.dumps({"query": (label or ctype or '')[:128], "columns": ["RELATIVE_PATH", "SVG_BASE64_DATA_URI"], "limit": 1})
    qlit = q.replace("'", "''")
    rr = session.sql(
        "SELECT j:results[0]:RELATIVE_PATH::string AS P, j:results[0]:SVG_BASE64_DATA_URI::string AS U "
        "FROM (SELECT PARSE_JSON(SNOWFLAKE.CORTEX.SEARCH_PREVIEW('TEMP.ABANNERJEE.ICON_SEARCH', '" + qlit + "')) AS j)").collect()
    if rr and rr[0]['P']:
        return rr[0]['P'], 'search', rr[0]['U']
    return None, None, None

# === SHARED_MODEL_RULES_BEGIN ===
# Everything between this marker and SHARED_MODEL_RULES_END is the single
# source of truth for how a raw agent-submitted model becomes the layout
# engine's graph input (boundary-category classification, edge label/
# style/bidirectional extraction). extract_shared_rules.py (in
# assets/render/, alongside its sibling build_render.py) extracts this
# block VERBATIM into a vendored
# assets/render/shared_rules.py, which render_local.py -- the offline
# review-harness pipeline -- imports directly instead of hand-maintaining
# a parallel copy. render_local.py used to carry its own hand-copied
# _category(), which silently drifted out of sync with this one (missing
# the 'data share' -> 'bridge' rule for a full session, found 2026-09-10)
# with nothing to catch it. `python3 review_harness.py` re-runs the
# extraction automatically before every render, so this file staying the
# edited/deployed original (no build-step change to ITS OWN deploy flow)
# is enough to keep the offline copy honest -- just don't rename these
# markers or the functions between them without updating
# extract_shared_rules.py to match.
def _category(ctype, label):
    # Boundary category from component type + label ONLY. Deliberately does
    # NOT take the resolved icon path: category drives boundary/zone
    # placement, and the offline (manifest) and online (ICON_SEARCH) icon
    # resolvers pick different paths -- so any icon-path input here made the
    # two pipelines silently disagree on layout for the same model. Keep this
    # a pure function of type+label so both pipelines classify identically.
    c = (ctype or '').lower()
    l = (label or '').lower()
    if any(k in c for k in ('snowpipe', 'openflow', 'kafka connector', 'connector for kafka')):
        return 'bridge'
    # An inbound/outbound Secure Data Share object is the same kind of
    # boundary-straddling construct as Snowpipe/Openflow above: data
    # crosses in from outside, but the SHARE OBJECT ITSELF is created and
    # queried inside the consuming account. Explicit rule so its boundary
    # placement is decided by type/label, not by an icon-resolution side
    # effect (an icon-path branch used to live below and did exactly that
    # -- found 2026-09-10, now removed entirely so category is icon-independent).
    # NOTE: this is specifically the SHARE OBJECT (e.g. "Inbound Share"),
    # not the external provider/consumer ACCOUNT on the other end of it --
    # that's covered separately below ("snowflake_account"/"snowflake
    # account" -> onprem).
    if any(k in c or k in l for k in ('data share', 'secure data sharing', 'data sharing', 'inbound share', 'outbound share', 'secure share')):
        return 'bridge'
    # A cloud vendor's PRIVATE CONNECTIVITY construct (Azure Private Link,
    # AWS PrivateLink) is network plumbing, not a Snowflake object -- it
    # does not belong inside the account boundary. Deliberately NOT
    # returning 'bridge' here (that's reserved for actual Snowflake-native
    # ingestion services like Snowpipe); let the vendor-prefix rule below
    # classify it as onprem like any other cloud-vendor-owned service.
    # Third-party BI/reporting tools are external consumers -- NOT the same
    # as a native Snowflake-served surface (Streamlit, Cortex agent), which
    # is what 'outcome' otherwise means (boundary-triggering, i.e. inside
    # the account). Power BI/Tableau/etc. sit outside it.
    if any(k in c or k in l for k in (
        'tableau', 'power bi', 'powerbi', 'looker',
        'superset', 'sigma', 'metabase', 'quicksight',
    )):
        return 'onprem'
    if any(k in c or k in l for k in ('streamlit', 'dashboard', 'notebook')):
        return 'outcome'
    if c == 'user' or 'analyst' in c or 'analyst' in l:
        return 'outcome'
    # A DIFFERENT/external Snowflake account -- e.g. a Secure Data Sharing
    # PROVIDER account whose data we consume -- is NOT part of THIS account's
    # boundary. Match the external-account signal in the component type OR the
    # label, in both underscore and space forms (the agent emits space-form
    # component types like "snowflake account"). Plain "snowflake" (our own
    # account's objects) is deliberately NOT matched here -> stays 'snow'.
    if any(k in c for k in ('snowflake_account', 'snowflake account', 'data share provider', 'external snowflake', 'provider account')) \
       or 'snowflake account' in l or 'snowflake_account' in l:
        return 'onprem'
    if any(k in c for k in (
        's3', 'kafka', 'kinesis', 'blob', 'gcs', 'event hub', 'eventhub',
        'postgres', 'mysql', 'oracle', 'mongo', 'redis', 'external', 'data lake',
        'databricks', 'spark', 'bigquery', 'synapse', 'redshift', 'pub/sub', 'pubsub',
        'dbt', 'airflow', 'fivetran', 'matillion', 'informatica', 'talend',
        # Azure-specific services the agent sends as space-separated names
        'data factory', 'private link', 'privatelink', 'service bus',
        'azure sql', 'azure blob', 'azure function',
        # AWS equivalents
        'glue', 'lambda', 'sqs', 'sns',
    )):
        return 'onprem'
    # Generic vendor-prefix heuristic: handles BOTH underscore-separated
    # (azure_data_factory) AND space-separated (azure data factory) forms.
    if any(c.startswith(p) for p in ('azure_', 'azure ', 'aws_', 'aws ', 'gcp_', 'gcp ', 'google_', 'google ')):
        return 'onprem'
    return 'snow'

def resolve_category(node):
    # Single source of truth for a node's boundary category, used by BOTH
    # pipelines (the deployed proc and offline render_local.py). Honors an
    # explicit category on the node first (agent/user intent), else classifies
    # from component type + label via _category. Accepts either key spelling
    # ('component_type' from the proc, 'componentType' from local models).
    # Nothing here depends on icon resolution -- that is the whole point:
    # category (which drives layout) must not vary with which icon resolver ran.
    explicit = node.get('category')
    if explicit:
        return explicit
    ctype = node.get('component_type') or node.get('componentType') or ''
    label = node.get('label') or node.get('id') or ''
    return _category(ctype, label)

def _build_edges(edges):
    # Converts raw agent-submitted edges into the layout engine's g_edges
    # plus the renderer's edgeLabels/edgeBidirectional/edgeStyles maps.
    # Kept as its own function (rather than inline in run()) specifically
    # so it has a clean, independently-extractable boundary for
    # extract_shared_rules.py -- see SHARED_MODEL_RULES_BEGIN above.
    g_edges = [{'from': e.get('source'), 'to': e.get('target')} for e in edges if e.get('source') and e.get('target')]
    edge_labels = {}
    edge_bidirectional = {}
    edge_styles = {}
    _valid_styles = {'dataflow', 'governance', 'legacy', 'private_link', 'data_share'}
    for e in edges:
        if e.get('source') and e.get('target'):
            key = str(e.get('source')) + '|' + str(e.get('target'))
            if e.get('label'):
                edge_labels[key] = e.get('label')
            if e.get('bidirectional'):
                edge_bidirectional[key] = True
            if e.get('style') in _valid_styles:
                edge_styles[key] = e.get('style')
    return g_edges, edge_labels, edge_bidirectional, edge_styles
# === SHARED_MODEL_RULES_END ===

def _svg_to_pdf_png(svg_text, dpi=150):
    # Reuse the SVG deliverable to produce PDF/PNG rather than a separate
    # render path -- wrap it in a minimal HTML shell with an @page rule
    # sized to the SVG's own width/height (weasyprint defaults to A4
    # otherwise, which clips/scales a wide architecture diagram). PDF via
    # weasyprint, PNG by rasterizing that PDF via pdf2image/poppler --
    # both are pure-package, no browser subprocess, no external network,
    # confirmed to work inside the Snowflake Python stored-proc sandbox.
    m = re.search(r'<svg[^>]*\bwidth="(\d+(?:\.\d+)?)"[^>]*\bheight="(\d+(?:\.\d+)?)"', svg_text)
    w = float(m.group(1)) if m else 1200.0
    h = float(m.group(2)) if m else 800.0
    html_wrapped = (
        '<html><head><style>@page { size: ' + str(w) + 'px ' + str(h) + 'px; margin: 0; } '
        'html,body { margin:0; padding:0; }</style></head><body>' + svg_text + '</body></html>'
    )
    from weasyprint import HTML
    pdf_bytes = HTML(string=html_wrapped).write_pdf()
    from pdf2image import convert_from_bytes
    images = convert_from_bytes(pdf_bytes, dpi=dpi)
    buf = io.BytesIO()
    images[0].save(buf, format='PNG')
    return pdf_bytes, buf.getvalue()

def run(session, nodes, edges, title, export_name, doc_json, containers=None, boundary_label=None, boundary_subtitle=None):
    nodes = [dict(n) for n in _coerce(nodes)]
    edges = [dict(e) for e in _coerce(edges)]

    id_to_label = {}
    cache = {}
    resolved = {}
    icons = {}
    cats = {}
    for n in nodes:
        nid = n.get('id')
        id_to_label[nid] = n.get('label') or nid
        if n.get('svg_data_uri'):
            icons[nid] = n['svg_data_uri']
            resolved[nid] = {'source': 'provided', 'path': n.get('icon_path')}
        else:
            key = ((n.get('component_type') or ''), (n.get('label') or nid or ''))
            if key not in cache:
                cache[key] = _resolve(session, key[1], key[0])
            path, src, uri = cache[key]
            if uri:
                icons[nid] = uri
            resolved[nid] = {'source': src, 'path': path}
        cats[nid] = resolve_category(n)

    g_nodes = [{'id': n.get('id'), 'label': n.get('label') or n.get('id'),
                'componentType': n.get('component_type') or '',
                'zone': n.get('layer') or 'Main', 'category': cats.get(n.get('id')),
                'detail': n.get('detail') or '', 'style': n.get('style')} for n in nodes]
    g_edges, edge_labels, edge_bidirectional, edge_styles = _build_edges(edges)
    g_containers = [dict(c) for c in _coerce(containers)]
    graph_extra = {}
    if boundary_label:
        graph_extra['boundaryLabel'] = boundary_label
    if boundary_subtitle:
        graph_extra['boundarySubtitle'] = boundary_subtitle
    graph_json = json.dumps({'nodes': g_nodes, 'edges': g_edges, 'containers': g_containers, **graph_extra})

    lr = session.sql("SELECT TEMP.ABANNERJEE.LAYOUT_DIAGRAM(?) AS L", params=[graph_json]).collect()
    layout_json = lr[0]['L']
    try:
        layout = json.loads(layout_json)
    except Exception:
        layout = {}
    if isinstance(layout, dict) and layout.get('error'):
        return {'error': 'layout_engine: ' + str(layout.get('error')), 'title': title}

    for ln in layout.get('nodes', []) or []:
        ln['label'] = id_to_label.get(ln.get('id'), ln.get('label') or ln.get('id'))

    # HTML viewer uses a wide / icon-left node geometry (separate 1-arg layout
    # pass; nodeStyle rides in the model JSON since LAYOUT_DIAGRAM is 1-arg).
    html_layout = None
    try:
        wide_graph_json = json.dumps({'nodes': g_nodes, 'edges': g_edges, 'containers': g_containers, 'nodeStyle': 'wide', **graph_extra})
        lr2 = session.sql("SELECT TEMP.ABANNERJEE.LAYOUT_DIAGRAM(?) AS L",
                          params=[wide_graph_json]).collect()
        hl = json.loads(lr2[0]['L'])
        if isinstance(hl, dict) and not hl.get('error'):
            html_layout = hl
    except Exception:
        html_layout = None

    # componentType + category + detail + role drive the node subhead in the HTML render.
    id_to_type = {}
    id_to_detail = {}
    id_to_role = {}
    for n in nodes:
        id_to_type[n.get('id')] = n.get('component_type') or ''
        id_to_detail[n.get('id')] = n.get('detail') or ''
        id_to_role[n.get('id')] = n.get('role') or ''
    for ln in (html_layout.get('nodes', []) if html_layout else []) or []:
        nid = ln.get('id')
        ln['label'] = id_to_label.get(nid, ln.get('label') or nid)
        ln['componentType'] = id_to_type.get(nid, '')
        ln['category'] = cats.get(nid)
        ln['detail'] = id_to_detail.get(nid, '')
        ln['role'] = id_to_role.get(nid, '')

    enrich = {'icons': icons, 'edgeLabels': edge_labels, 'edgeBidirectional': edge_bidirectional, 'edgeStyles': edge_styles}
    doc = None
    if doc_json:
        try:
            doc = json.loads(doc_json) if isinstance(doc_json, str) else doc_json
            if isinstance(doc, dict):
                enrich['doc'] = doc
        except Exception:
            doc = None

    rr = session.sql("SELECT TEMP.ABANNERJEE.RENDER_DIAGRAM(?, ?, ?, ?) AS R",
                     params=[json.dumps(layout), json.dumps(enrich), title,
                             (json.dumps(html_layout) if html_layout else None)]).collect()
    art = json.loads(rr[0]['R'])

    base = _slug(export_name or title)
    text_files = {'mmd': base + '.mmd', 'drawio': base + '.drawio.xml', 'svg': base + '.svg', 'html': base + '.html'}
    for k, fname in text_files.items():
        session.file.put_stream(io.BytesIO((art.get(k, '') or '').encode('utf-8')),
                                '@TEMP.ABANNERJEE.DIAGRAM_EXPORTS/' + fname, auto_compress=False, overwrite=True)

    files = dict(text_files)
    pdf_error = None
    try:
        pdf_bytes, png_bytes = _svg_to_pdf_png(art.get('svg', '') or '')
        pdf_name, png_name = base + '.pdf', base + '.png'
        session.file.put_stream(io.BytesIO(pdf_bytes), '@TEMP.ABANNERJEE.DIAGRAM_EXPORTS/' + pdf_name, auto_compress=False, overwrite=True)
        session.file.put_stream(io.BytesIO(png_bytes), '@TEMP.ABANNERJEE.DIAGRAM_EXPORTS/' + png_name, auto_compress=False, overwrite=True)
        files['pdf'] = pdf_name
        files['png'] = png_name
    except Exception as e:
        pdf_error = str(e)

    try:
        session.sql("ALTER STAGE TEMP.ABANNERJEE.DIAGRAM_EXPORTS REFRESH").collect()
    except Exception:
        pass
    urls = {}
    for k, fname in files.items():
        safe = re.sub(r'[^a-zA-Z0-9_.\-]', '', fname)
        try:
            u = session.sql("SELECT GET_PRESIGNED_URL(@TEMP.ABANNERJEE.DIAGRAM_EXPORTS, '" + safe + "', 86400) AS U").collect()
            urls[k] = u[0]['U'] if u else None
        except Exception:
            urls[k] = None

    try:
        rows = []
        for n in nodes:
            ri = resolved.get(n.get('id'), {})
            rows.append([title, base, n.get('id'), n.get('component_type'), (n.get('label') or n.get('id')),
                         (ri.get('source') or 'none'), ri.get('path')])
        if rows:
            ph = ",".join(["(?,?,?,?,?,?,?)"] * len(rows))
            flat = [x for r in rows for x in r]
            session.sql("INSERT INTO TEMP.ABANNERJEE.ICON_RESOLUTION_LOG (DIAGRAM_TITLE,EXPORT_BASE,NODE_ID,COMPONENT_TYPE,LABEL,SOURCE,RESOLVED_PATH) VALUES " + ph, params=flat).collect()
    except Exception:
        pass

    result = {
        'title': title, 'export_base': base,
        'node_count': len(nodes), 'edge_count': len(edges),
        'doc_embedded': bool(doc),
        'layout': {'width': layout.get('width'), 'height': layout.get('height'),
                   'zones': len(layout.get('zones', []) or []),
                   'has_boundary': bool(layout.get('platformBoundary'))},
        'quality': layout.get('quality'),
        'resolved_icons': resolved, 'files': files, 'urls': urls,
        'stage': '@TEMP.ABANNERJEE.DIAGRAM_EXPORTS',
        'note': 'All six files (.mmd/.drawio.xml/.svg/.html/.pdf/.png) embed the diagram and, when DOC_JSON is provided, a documentation panel (overview, component summary, best practices, cited sources) under the diagram -- the .pdf/.png are rasterized from the .svg so they carry the same panel. Use urls to download.'
    }
    if pdf_error:
        result['pdf_png_error'] = pdf_error
    return result
$$;
