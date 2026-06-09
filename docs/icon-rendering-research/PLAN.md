# Plan: ELK Diagram Generator

Version history, research findings, and roadmap. See [ARCHITECTURE.md](ARCHITECTURE.md) for technical details.

---

## Version History

| Version | Summary |
|---|---|
| v1–v13 | Initial development: ELK integration, compound graph, matplotlib rendering, iterative edge routing improvements |
| v14 | Major edge routing refactor: 3-tier visual hierarchy (primary/secondary/tertiary) |
| v15 | Fixed e10 wrap-around route (raw_events→cortex_search below-diagram L-path) |
| v16 | Fixed 4 edge issues: e4 intra-group, e7 label collision, e10 refinement, e13 unnecessary bends |
| **v17** | **High-res icons: 512x512 pre-rendered PNGs, load_icon() sz=96, documentation** |

### v17 Changes (Current)

**Problem:** Icons were blurry. The 128x128 source PNGs were loaded at 44x44 pixels, then upscaled to ~86px at DPI 180 — a 2x enlargement that produced visible pixelation.

**Solution:** Pre-rendered all 11 icons at 512x512 from SVG sources. Updated `load_icon()` to render at 96px (5.3x LANCZOS downscale from 512px source). Adjusted `OffsetImage zoom` from 0.78 to 0.358 to maintain identical visual size.

**Documentation:** Created README.md, ARCHITECTURE.md, and this PLAN.md.

---

## Research: SVG Rendering in Python

For v17, we evaluated every available approach for rendering SVGs at runtime in matplotlib. Summary:

### Approaches Tested

| Library | Install | Renders correctly? | Portable? | Verdict |
|---|---|---|---|---|
| **cairosvg** 2.9.0 | `pip install cairosvg` | Yes (perfect) | No — needs native `libcairo` + `DYLD_LIBRARY_PATH=/opt/homebrew/lib` on macOS | Used for one-time pre-render only |
| **svglib** 1.6.0 | `pip install svglib` | N/A (fails to install) | No — requires `pycairo` which needs native cairo headers + pkg-config | Rejected |
| **skia-python** 144.0 | `pip install skia-python` | No — renders all icons as solid black | Yes (precompiled wheels) | Rejected — doesn't support CSS `<style>` blocks in SVGs |
| **pyvips** | `pip install pyvips` | Would work | No — needs native `libvips` | Not tested |
| **skunk** | `pip install skunk` | SVG-in-SVG only | Yes | N/A — only works for SVG output, not PNG |
| **@resvg/resvg-js** | `npm install @resvg/resvg-js` | Yes | Semi — platform-specific N-API bindings | Considered but adds Node.js runtime dependency |
| **resvg-wasm** | `npm install resvg-wasm` | Yes | Yes (pure WASM, 3.7 MB) | Overkill for 11 icons |

### Key Finding

matplotlib's `OffsetImage` fundamentally requires a numpy array (raster data). There is no mechanism to embed true vector SVGs when the output format is PNG. This was confirmed by matplotlib maintainers (GitHub issue #22455).

### Decision

Pre-render SVGs to high-res PNGs at build time. This gives:
- Zero new runtime dependencies
- Full portability (only needs Pillow, which is already required)
- 5.3x supersampling at display size (512→96 LANCZOS = crisp anti-aliasing)
- Simple `load_icon()` implementation (no conditional imports or fallback paths)

---

## Future Work

### Phase 3: Cortex Code Skill

Package the ELK diagram generator as a Cortex Code skill so users can generate architecture diagrams from the CLI:

```bash
cortex skill run snowgram-architect "Create a medallion lakehouse diagram"
```

This would integrate with the SnowGram agent's component suggestion pipeline while producing publication-quality PNG output.

**Key files for skill development:**
- Skill framework: Use `$skill-development` CoCo skill
- Agent integration: `SNOWGRAM_DB.AGENTS.SNOWGRAM_AGENT`
- Template system: SnowGram's 14 pre-built reference architecture templates

### Potential Improvements

- **Configurable node/edge definitions** — Accept JSON input instead of hardcoded Python dicts
- **Multiple output formats** — PDF (vector), SVG (via skunk for web embedding)
- **Dark mode** — Alternate color scheme
- **Animated edges** — GIF output showing data flow direction
