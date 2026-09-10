# GENERATED FROM generate_artifacts.dev.sql (the SHARED_MODEL_RULES block) by assets/render/extract_shared_rules.py - DO NOT EDIT.
# Canonical source: /Users/abannerjee/Documents/SnowGram/skills/snowflake-architecture-diagram/assets/render/source/generate_artifacts.dev.sql
# sha256(source): 5c37f0a06c3ebe3d301de02bf6285538248e29df2570f45c9c9eb523ddf3c45c
# generated: 2026-09-10T22:22:17+00:00
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
def _category(ctype, label, path):
    c = (ctype or '').lower()
    l = (label or '').lower()
    pth = path or ''
    if any(k in c for k in ('snowpipe', 'openflow', 'kafka connector', 'connector for kafka')):
        return 'bridge'
    # An inbound/outbound Secure Data Share object is the same kind of
    # boundary-straddling construct as Snowpipe/Openflow above: data
    # crosses in from outside, but the SHARE OBJECT ITSELF is created and
    # queried inside the consuming account. Explicit rule, not left to fall
    # through to the icon-path heuristic below (pth.startswith('sno-icon'))
    # -- found 2026-09-10: that heuristic accidentally decided this node's
    # placement (inside vs outside the boundary) as a side effect of which
    # icon it happened to resolve to, so fixing an unrelated icon bug (the
    # WRONG, external Azure icon for "data share" silently forced 'onprem'
    # via this same fallback) would have silently relocated every data-share
    # node's boundary side too, with nothing to signal that had happened.
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
    if pth and not pth.startswith('sno-icon'):
        return 'onprem'
    # A DIFFERENT/external Snowflake account (e.g. an inbound share
    # provider) is not part of THIS account's boundary either.
    if 'snowflake_account' in c or 'snowflake account' in l:
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
