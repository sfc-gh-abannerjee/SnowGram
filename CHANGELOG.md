# Changelog

All notable changes to SnowGram will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [1.1.0] - 2026-02-15

### Added
- Accessibility improvements (aria-labels for search, chat input, buttons)
- npm overrides for transitive dependency security fixes
- Debug logging utility that only logs in development mode
- Parse abort controller to prevent race conditions in diagram generation

### Changed
- Upgraded Next.js from 14.1.0 to 15.5.12
- Upgraded mermaid from 10.8.0 to 11.12.2
- Upgraded ESLint from 8.x to 9.39.2
- Upgraded @typescript-eslint packages from 6.x to 8.55.0
- Upgraded @excalidraw/mermaid-to-excalidraw from 0.2.0 to 2.0.0
- Removed deprecated `swcMinify` option from next.config.js (now default in Next.js 15)

### Fixed
- **17 bugs** related to node stacking, boundaries, connections, and layout
- **9 ESLint warnings** (type safety and hook dependencies)
- **Security**: Removed client-side PAT exposure vulnerability
- **Security**: Fixed DOMPurify XSS vulnerabilities (upgraded to 3.3.1)
- **Security**: Fixed Next.js DoS vulnerabilities (CVE)
- **Security**: Fixed glob CLI injection via eslint-config-next 15
- **Security**: Fixed lodash-es prototype pollution via npm override to 4.17.23
- Stale closure bugs in `onConnect` and `onDrop` callbacks
- Array mutation violations in `ensureMedallionCompleteness`
- Race condition in `parseMermaidAndCreateDiagram`
- Invalid SVG export (now queries full SVG element)
- Duplicate node picks in layout algorithms
- Missing Kafka boundary support in `normalizeBoundaryType` and `enforceAccountBoundaries`

### Removed
- Unused `api/snowgram.ts` file (~203 LOC)
- Unused `layoutMedallion` function (~133 LOC)
- Duplicate `hexToRgb` utility functions (consolidated 4→1)
- 6 unused exports from snowgram-agent-client
- Dead code: `calculateNodeSize` function, `allCollapsed` variable

### Security
- Eliminated all 7 HIGH severity npm vulnerabilities
- Reduced total vulnerabilities from 8 to 0-2 (moderate only)

## [1.0.0] - 2026-02-01

### Added
- Initial release of SnowGram
- Cortex Agent integration with Claude Sonnet 4
- Excalidraw-based diagram editor
- Mermaid-to-Excalidraw conversion
- Component library with pre-built blocks and patterns
- SPCS deployment support
