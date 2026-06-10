// citations.js — build + render a "Documentation" citations panel below a
// diagram. Framework-agnostic, zero dependencies.
//
// Extracted from the SnowGram viewer + flow_builder.build_citations.
// Contract: a citation is { url, title, excerpt }. Pairs with citations.css.
// Author: Abhinav Bannerjee

(function (root) {
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Derive citations from diagram nodes that carry a `doc_url`.
  // Dedupes by URL, preserves node order. Port of flow_builder.build_citations.
  //   nodes: [{ doc_url, label, detail }]  ->  [{ url, title, excerpt }]
  function buildCitations(nodes) {
    var seen = {}, out = [];
    (nodes || []).forEach(function (n) {
      var url = n && n.doc_url;
      if (!url || seen[url]) return;
      seen[url] = true;
      out.push({ url: url, title: n.label || url, excerpt: n.detail || '' });
    });
    return out;
  }

  // Render citations into a target element (the #citations-list container).
  // Port of the viewer's renderCitations().
  function renderCitations(citations, listEl) {
    if (!listEl) return;
    if (!citations || !citations.length) {
      listEl.innerHTML = '<div class="citations-empty">No citations attached.</div>';
      return;
    }
    listEl.innerHTML = citations.map(function (c) {
      var ex = c.excerpt ? '<div class="excerpt">' + escapeHtml(c.excerpt) + '</div>' : '';
      return '<div class="citation">' +
        '<a href="' + escapeHtml(c.url) + '" target="_blank" rel="noopener">' +
        escapeHtml(c.title || c.url) + '</a>' + ex + '</div>';
    }).join('');
  }

  // Ensure a `.citations` section (with #citations-list) exists below the
  // diagram, creating it if absent. Returns the #citations-list element.
  function ensurePanel(doc, afterEl) {
    var list = doc.getElementById('citations-list');
    if (list) return list;
    var panel = doc.createElement('div');
    panel.className = 'citations';
    panel.innerHTML = '<h2>Documentation</h2>' +
      '<div id="citations-list"><div class="citations-empty">No citations attached.</div></div>';
    var anchor = afterEl || doc.querySelector('[data-diagram-root]') ||
      doc.querySelector('.diagram-card');
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(panel, anchor.nextSibling);
    else doc.body.appendChild(panel);
    return panel.querySelector('#citations-list');
  }

  // Auto-render for generated/standalone HTML. Reads citation data from
  // window.__DIAGRAM_CITATIONS or a <script type="application/json"
  // data-diagram-citations> tag, builds the panel below the diagram, renders.
  function autoRender(doc) {
    doc = doc || (typeof document !== 'undefined' ? document : null);
    if (!doc) return;
    var data = (typeof window !== 'undefined' && window.__DIAGRAM_CITATIONS) || null;
    if (!data) {
      var tag = doc.querySelector('script[type="application/json"][data-diagram-citations]');
      if (tag) { try { data = JSON.parse(tag.textContent); } catch (e) { data = null; } }
    }
    if (data == null) return; // no citation data present -> do nothing
    renderCitations(data, ensurePanel(doc));
  }

  function autoRenderOnReady() {
    if (typeof document === 'undefined') return;
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { autoRender(document); });
    } else { autoRender(document); }
  }

  var api = { buildCitations: buildCitations, renderCitations: renderCitations,
              ensurePanel: ensurePanel, autoRender: autoRender, autoRenderOnReady: autoRenderOnReady };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.SnowGramCitations = api;
})(typeof window !== 'undefined' ? window : this);
