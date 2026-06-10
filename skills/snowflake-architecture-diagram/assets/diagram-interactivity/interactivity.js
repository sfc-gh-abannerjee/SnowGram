// interactivity.js — wire hover motion + component highlighting onto a
// rendered SnowGram diagram. Framework-agnostic, zero dependencies.
//
// Extracted from the SnowGram viewer (assets/viewer/index.html). Pairs with
// interactivity.css. See README.md for the required class/attribute contract.
//
// Usage (browser):
//   <link rel="stylesheet" href="interactivity.css">
//   <script src="interactivity.js"></script>
//   <script>
//     const off = attachDiagramInteractivity(diagramContainerEl, connectorsSvgEl);
//     // ... later, if you re-render: off(); attachDiagramInteractivity(...);
//   </script>
//
// Also exposed as window.SnowGramInteractivity = { attach, detach } and as an
// ES module export when imported.
//
// Author: Abhinav Bannerjee

(function (root) {
  // Highlight a connector group + the two nodes it connects.
  function activateConnector(container, group) {
    group.classList.add('is-active');
    var srcId = group.getAttribute('data-source-id');
    var tgtId = group.getAttribute('data-target-id');
    if (srcId) {
      var s = container.querySelector('[data-node-id="' + cssEsc(srcId) + '"]');
      if (s) s.classList.add('is-active');
    }
    if (tgtId) {
      var t = container.querySelector('[data-node-id="' + cssEsc(tgtId) + '"]');
      if (t) t.classList.add('is-active');
    }
  }

  function deactivateConnector(container, group) {
    group.classList.remove('is-active');
    var srcId = group.getAttribute('data-source-id');
    var tgtId = group.getAttribute('data-target-id');
    if (srcId) {
      var s = container.querySelector('[data-node-id="' + cssEsc(srcId) + '"]');
      if (s) s.classList.remove('is-active');
    }
    if (tgtId) {
      var t = container.querySelector('[data-node-id="' + cssEsc(tgtId) + '"]');
      if (t) t.classList.remove('is-active');
    }
  }

  // Minimal CSS attribute-selector escaping for ids with quotes/backslashes.
  function cssEsc(v) {
    return String(v).replace(/(["\\])/g, '\\$1');
  }

  // Attach all hover wiring. Returns a detach() function that removes every
  // listener added by this call — call it before re-rendering, then re-attach.
  function attachDiagramInteractivity(container, svg) {
    if (!container || !svg) throw new Error('attachDiagramInteractivity: container and svg are required');
    var bound = [];
    function on(el, type, fn) { el.addEventListener(type, fn); bound.push([el, type, fn]); }

    // Connector hover -> highlight that connector + its endpoints.
    svg.querySelectorAll('.connector-group').forEach(function (group) {
      on(group, 'mouseenter', function () { activateConnector(container, group); });
      on(group, 'mouseleave', function () { deactivateConnector(container, group); });
    });

    // Node hover -> mark it primary + highlight every connector incident to
    // it (and therefore each connector's other endpoint too).
    container.querySelectorAll('.flow-node[data-node-id]').forEach(function (nodeEl) {
      var nodeId = nodeEl.getAttribute('data-node-id');
      if (!nodeId) return;
      var sel =
        '.connector-group[data-source-id="' + cssEsc(nodeId) + '"], ' +
        '.connector-group[data-target-id="' + cssEsc(nodeId) + '"]';
      on(nodeEl, 'mouseenter', function () {
        nodeEl.classList.add('is-primary');
        svg.querySelectorAll(sel).forEach(function (g) { activateConnector(container, g); });
      });
      on(nodeEl, 'mouseleave', function () {
        nodeEl.classList.remove('is-primary');
        svg.querySelectorAll(sel).forEach(function (g) { deactivateConnector(container, g); });
      });
    });

    return function detach() {
      bound.forEach(function (b) { b[0].removeEventListener(b[1], b[2]); });
      bound = [];
    };
  }

  var api = { attach: attachDiagramInteractivity, detach: null, autoAttach: autoAttach };

  // autoAttach() — for generated/standalone HTML where you don't want to
  // hand-write the attach call. Finds the connectors <svg> (the one holding
  // .connector-group elements) and a container that holds .flow-node cards,
  // then attaches. Returns detach() or null if no diagram was found.
  // Honors an explicit override via [data-diagram-root] / [data-connectors-svg].
  function autoAttach(doc) {
    doc = doc || (typeof document !== 'undefined' ? document : null);
    if (!doc) return null;
    var svg = doc.querySelector('[data-connectors-svg]') ||
      Array.prototype.find.call(doc.querySelectorAll('svg'), function (s) {
        return s.querySelector('.connector-group');
      });
    if (!svg) return null;
    var container = doc.querySelector('[data-diagram-root]');
    if (!container) {
      // nearest ancestor of the svg that also contains .flow-node cards
      var el = svg.parentElement;
      while (el && !el.querySelector('.flow-node[data-node-id]')) el = el.parentElement;
      container = el || doc.body;
    }
    return attachDiagramInteractivity(container, svg);
  }

  function autoAttachOnReady() {
    if (typeof document === 'undefined') return;
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { autoAttach(document); });
    } else {
      autoAttach(document);
    }
  }
  api.autoAttachOnReady = autoAttachOnReady;

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) {
    root.SnowGramInteractivity = api;
    root.attachDiagramInteractivity = attachDiagramInteractivity;
  }
})(typeof window !== 'undefined' ? window : this);
