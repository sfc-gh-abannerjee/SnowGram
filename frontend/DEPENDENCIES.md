# Frontend Dependencies Documentation

This document explains the dependency management strategy for the SnowGram frontend.

## npm Overrides

The `package.json` file uses npm overrides to fix security vulnerabilities in transitive dependencies that haven't been patched upstream yet.

### Current Overrides

| Package | Override Version | Reason |
|---------|-----------------|--------|
| `lodash-es` | `4.17.23` | Prototype pollution vulnerability (GHSA-xxjr-mmjv-4gpg) |
| `nanoid` | `^5.0.9` | Predictable ID generation vulnerability (GHSA-mwcw-c2x4-8c55) |

### Dependency Chains Requiring Overrides

**lodash-es vulnerability chain:**
```
mermaid
└── @mermaid-js/parser
    └── langium
        └── chevrotain
            └── @chevrotain/cst-dts-gen
                └── lodash-es@4.17.21 (vulnerable)
```

**nanoid vulnerability chain:**
```
@excalidraw/mermaid-to-excalidraw
└── nanoid@4.0.2 (vulnerable)
```

## When to Remove Overrides

Overrides can be removed when upstream packages update their dependencies to fixed versions:

1. Run `npm audit` periodically to check vulnerability status
2. Check if upstream packages have released new versions
3. Remove override and run `npm install` to test
4. If `npm audit` shows no vulnerabilities for that package, the override is no longer needed

## Key Package Versions

| Package | Version | Purpose |
|---------|---------|---------|
| `next` | 15.5.12 | React framework |
| `react` | 18.2.0 | UI library |
| `mermaid` | 11.12.2 | Diagram syntax parser |
| `@excalidraw/excalidraw` | latest | Diagram editor |
| `@excalidraw/mermaid-to-excalidraw` | 2.0.0 | Mermaid conversion |
| `eslint` | 9.39.2 | Code linting |
| `typescript` | 5.x | Type checking |

## Maintenance Commands

```bash
# Check for vulnerabilities
npm audit

# Update dependencies (respects semver)
npm update

# Check for outdated packages
npm outdated

# Force clean install (if issues)
rm -rf node_modules package-lock.json && npm install
```

## Node.js Requirements

- **Minimum version**: Node.js 18.0.0+
- **Recommended**: Node.js 20.x LTS

## Notes

- npm overrides only work with npm 8.3.0+
- Overrides force ALL instances of a package to use the specified version
- Test thoroughly after adding/removing overrides as they can cause compatibility issues
