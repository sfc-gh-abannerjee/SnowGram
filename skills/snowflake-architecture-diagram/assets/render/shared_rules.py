# GENERATED FROM generate_artifacts.dev.sql (the SHARED_MODEL_RULES block) by assets/render/extract_shared_rules.py - DO NOT EDIT.
# Canonical source: /Users/abannerjee/Documents/SnowGram/skills/snowflake-architecture-diagram/assets/render/source/generate_artifacts.dev.sql
# sha256(source): 2a3f1f1dac0f406146dd1c392187663b170f82bc0ffb6fd6f2d12f98e9c91876
# generated: 2026-09-11T17:41:38+00:00
#
# This is the SAME logic the deployed GENERATE_DIAGRAM_ARTIFACTS proc runs
# for a real agent call (boundary-category classification + edge label/
# style/bidirectional extraction) -- imported directly by render_local.py
# so the offline review-harness pipeline can never silently diverge from
# what a live agent response actually produces. Edit the source .sql file's
# SHARED_MODEL_RULES block, not this file; re-run this script (or
# review_harness.py, which does so automatically) to pick up the change.

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
