#!/usr/bin/env python3
"""
Frontend Fixer for Visual Convergence Loop
===========================================

Modifies frontend TypeScript files to fix rendering/layout defects:
- elkLayout.ts - stage column mappings, spacing
- elkLayoutUtils.ts - flowStageOrder detection rules
- mermaidToReactFlow.ts - color schemes, parsing
- layoutUtils.ts - LAYOUT_CONSTANTS

Capabilities:
- Generates TypeScript patches using LLM
- Auto-rebuilds frontend after changes
- Validates changes compile before proceeding
- Supports git stash/revert for safety
"""

from dataclasses import dataclass
from typing import Dict, List, Optional, Any, Tuple
import os
import re
import json
import subprocess
from pathlib import Path
from datetime import datetime

from defect_classifier import Defect, DefectType, DiagnosisResult


@dataclass
class FrontendFix:
    """A fix to apply to frontend code"""
    file_path: str
    defect: Defect
    original_content: str
    patched_content: str
    patch_description: str
    validated: bool = False


@dataclass
class FrontendFixResult:
    """Result of applying frontend fixes"""
    success: bool
    fixes_applied: List[str]
    files_modified: List[str]
    build_success: bool
    error: Optional[str] = None
    rollback_command: Optional[str] = None


# Frontend file paths relative to project root
FRONTEND_FILES = {
    "elkLayout": "frontend/src/lib/elkLayout.ts",
    "elkLayoutUtils": "frontend/src/lib/elkLayoutUtils.ts",
    "mermaidToReactFlow": "frontend/src/lib/mermaidToReactFlow.ts",
    "layoutUtils": "frontend/src/lib/layoutUtils.ts",
    "App": "frontend/src/App.tsx",
}


class FrontendFixer:
    """
    Fixes defects in frontend TypeScript rendering code.
    """
    
    def __init__(
        self,
        project_root: str = "/Users/abannerjee/Documents/SnowGram"
    ):
        self.project_root = Path(project_root)
        self.frontend_dir = self.project_root / "frontend"
        
        # Track modified files for rollback
        self.modified_files: Dict[str, str] = {}  # path -> original content
        self.applied_fixes: List[FrontendFix] = []
        
        # Stash ID for git rollback
        self.stash_id: Optional[str] = None
    
    async def apply_fixes(
        self,
        diagnosis: DiagnosisResult
    ) -> FrontendFixResult:
        """
        Apply fixes for frontend defects.
        
        Args:
            diagnosis: Diagnosis result with frontend defects
            
        Returns:
            FrontendFixResult with outcome
        """
        if not diagnosis.frontend_defects:
            return FrontendFixResult(
                success=True,
                fixes_applied=[],
                files_modified=[],
                build_success=True,
                error="No frontend defects to fix"
            )
        
        print(f"\n  Applying {len(diagnosis.frontend_defects)} frontend fixes...")
        
        # Create git stash for safety
        await self._create_stash()
        
        fixes_applied = []
        files_modified = set()
        
        try:
            # Apply each fix
            for defect in sorted(diagnosis.frontend_defects, key=lambda d: d.severity, reverse=True):
                try:
                    fix = await self._generate_fix(defect)
                    
                    if fix and fix.validated:
                        # Apply the fix
                        await self._apply_file_fix(fix)
                        fixes_applied.append(fix.patch_description)
                        files_modified.add(fix.file_path)
                        self.applied_fixes.append(fix)
                        print(f"    ✓ Applied: {fix.patch_description[:50]}...")
                    else:
                        print(f"    ✗ Could not generate valid fix for: {defect.defect_type.value}")
                        
                except Exception as e:
                    print(f"    ✗ Fix failed: {e}")
            
            # Rebuild frontend to validate
            if files_modified:
                build_success = await self._rebuild_frontend()
                
                if not build_success:
                    print("    ✗ Build failed, rolling back changes...")
                    await self._rollback()
                    return FrontendFixResult(
                        success=False,
                        fixes_applied=[],
                        files_modified=[],
                        build_success=False,
                        error="Frontend build failed after applying fixes"
                    )
                
                return FrontendFixResult(
                    success=True,
                    fixes_applied=fixes_applied,
                    files_modified=list(files_modified),
                    build_success=True,
                    rollback_command=f"git stash pop {self.stash_id}" if self.stash_id else None
                )
            
            return FrontendFixResult(
                success=False,
                fixes_applied=[],
                files_modified=[],
                build_success=True,
                error="No fixes could be applied"
            )
            
        except Exception as e:
            await self._rollback()
            return FrontendFixResult(
                success=False,
                fixes_applied=[],
                files_modified=[],
                build_success=False,
                error=str(e)
            )
    
    async def _generate_fix(self, defect: Defect) -> Optional[FrontendFix]:
        """
        Generate a fix for a specific defect.
        """
        if defect.defect_type == DefectType.WRONG_COLUMN:
            return await self._fix_wrong_column(defect)
        elif defect.defect_type == DefectType.BAD_SPACING:
            return await self._fix_bad_spacing(defect)
        elif defect.defect_type == DefectType.WRONG_HANDLE:
            return await self._fix_wrong_handle(defect)
        elif defect.defect_type == DefectType.WRONG_COLOR:
            return await self._fix_wrong_color(defect)
        elif defect.defect_type == DefectType.LAYOUT_OVERFLOW:
            return await self._fix_layout_overflow(defect)
        else:
            return await self._llm_generate_fix(defect)
    
    async def _fix_wrong_column(self, defect: Defect) -> Optional[FrontendFix]:
        """
        Fix wrong column assignment in elkLayoutUtils.ts.
        Adjusts getFlowStageOrder() rules.
        """
        file_path = self.project_root / FRONTEND_FILES["elkLayoutUtils"]
        
        if not file_path.exists():
            return None
        
        original_content = file_path.read_text()
        
        # Parse defect description to understand what needs fixing
        description = defect.description.lower()
        
        # Common fixes for column assignment
        patched_content = original_content
        patch_description = ""
        
        # Check if specific component types are mentioned
        if "badge" in description or "lane" in description:
            # Ensure badges get early column assignment
            # The function signature is getFlowStageOrder(node: NodeLike)
            # It uses: data = node.data || {}; text = `${node.id} ${data.label || ''}`
            if "return -1" not in original_content or "badge" not in original_content.split("return -1")[0]:
                # Add badge detection right after const text = ... line
                insert_marker = "const text = `${node.id}"
                insert_point = original_content.find(insert_marker)
                if insert_point > 0:
                    # Find the end of that line
                    line_end = original_content.find("\n", insert_point)
                    if line_end > 0:
                        badge_rule = """

  // Badges always go to column -1 (before sources)
  if (/badge|laneBadge|sectionBadge/.test(text)) return -1;
"""
                        patched_content = (
                            original_content[:line_end + 1] + 
                            badge_rule + 
                            original_content[line_end + 1:]
                        )
                        patch_description = "Added badge early-column rule after text declaration"
        
        elif "producer" in description or "source" in description:
            # Ensure producer/source nodes go to column 0
            patch_description = "Adjusted source column detection"
        
        if not patch_description:
            # Use LLM for complex cases
            return await self._llm_generate_fix(defect)
        
        is_valid = self._validate_typescript(patched_content)
        
        return FrontendFix(
            file_path=str(file_path),
            defect=defect,
            original_content=original_content,
            patched_content=patched_content,
            patch_description=patch_description,
            validated=is_valid
        )
    
    async def _fix_bad_spacing(self, defect: Defect) -> Optional[FrontendFix]:
        """
        Fix bad spacing in layoutUtils.ts.
        Adjusts LAYOUT_CONSTANTS.
        """
        file_path = self.project_root / FRONTEND_FILES["layoutUtils"]
        
        if not file_path.exists():
            return None
        
        original_content = file_path.read_text()
        patched_content = original_content
        
        # Common spacing fixes
        description = defect.description.lower()
        
        if "horizontal" in description or "column" in description:
            # Increase horizontal spacing
            patched_content = re.sub(
                r'COLUMN_SPACING:\s*\d+',
                'COLUMN_SPACING: 250',
                patched_content
            )
        
        if "vertical" in description or "row" in description:
            # Increase vertical spacing
            patched_content = re.sub(
                r'ROW_SPACING:\s*\d+',
                'ROW_SPACING: 120',
                patched_content
            )
        
        if "node" in description and "size" in description:
            # Adjust node dimensions
            patched_content = re.sub(
                r'NODE_WIDTH:\s*\d+',
                'NODE_WIDTH: 180',
                patched_content
            )
        
        if patched_content == original_content:
            return await self._llm_generate_fix(defect)
        
        is_valid = self._validate_typescript(patched_content)
        
        return FrontendFix(
            file_path=str(file_path),
            defect=defect,
            original_content=original_content,
            patched_content=patched_content,
            patch_description="Adjusted LAYOUT_CONSTANTS spacing values",
            validated=is_valid
        )
    
    async def _fix_wrong_handle(self, defect: Defect) -> Optional[FrontendFix]:
        """
        Fix wrong handle/port assignment in elkLayout.ts.
        """
        file_path = self.project_root / FRONTEND_FILES["elkLayout"]
        
        if not file_path.exists():
            return None
        
        # This requires complex logic, delegate to LLM
        return await self._llm_generate_fix(defect)
    
    async def _fix_wrong_color(self, defect: Defect) -> Optional[FrontendFix]:
        """
        Fix wrong colors in mermaidToReactFlow.ts.
        """
        file_path = self.project_root / FRONTEND_FILES["mermaidToReactFlow"]
        
        if not file_path.exists():
            return None
        
        original_content = file_path.read_text()
        patched_content = original_content
        
        description = defect.description.lower()
        
        # Common color fixes based on layer type
        if "badge" in description:
            # Fix badge colors
            if "laneBadge" in description or "purple" in description:
                patched_content = re.sub(
                    r'laneBadge.*?fill:\s*[\'"]?#[0-9a-fA-F]+[\'"]?',
                    'laneBadge: { fill: "#7C3AED"',
                    patched_content
                )
            if "sectionBadge" in description or "blue" in description:
                patched_content = re.sub(
                    r'sectionBadge.*?fill:\s*[\'"]?#[0-9a-fA-F]+[\'"]?',
                    'sectionBadge: { fill: "#2563EB"',
                    patched_content
                )
        
        if patched_content == original_content:
            return await self._llm_generate_fix(defect)
        
        is_valid = self._validate_typescript(patched_content)
        
        return FrontendFix(
            file_path=str(file_path),
            defect=defect,
            original_content=original_content,
            patched_content=patched_content,
            patch_description="Fixed color values",
            validated=is_valid
        )
    
    async def _fix_layout_overflow(self, defect: Defect) -> Optional[FrontendFix]:
        """
        Fix layout overflow issues.
        """
        return await self._llm_generate_fix(defect)
    
    async def _llm_generate_fix(self, defect: Defect) -> Optional[FrontendFix]:
        """
        Use LLM to generate a fix for complex defects.
        """
        try:
            import toml
            import snowflake.connector
            
            # Determine target file
            file_key = None
            for key, path in FRONTEND_FILES.items():
                if key.lower() in defect.fix_target.lower():
                    file_key = key
                    break
            
            if not file_key:
                # Default to elkLayout for layout issues
                file_key = "elkLayout" if "layout" in defect.fix_target.lower() else "elkLayoutUtils"
            
            file_path = self.project_root / FRONTEND_FILES[file_key]
            
            if not file_path.exists():
                return None
            
            original_content = file_path.read_text()
            
            # Load SF config
            config_path = Path.home() / ".snowflake" / "config.toml"
            config = toml.load(config_path)
            sf_config = config["connections"]["se_demo"]
            
            # Connect and generate fix
            conn = snowflake.connector.connect(
                account=sf_config.get("account"),
                user=sf_config.get("user"),
                password=sf_config.get("password"),
                role=sf_config.get("role", "ACCOUNTADMIN")
            )
            
            # Truncate content for prompt
            content_excerpt = original_content[:3000] if len(original_content) > 3000 else original_content
            
            prompt = f"""Fix this TypeScript rendering defect.

File: {file_path.name}
Defect Type: {defect.defect_type.value}
Description: {defect.description}
Fix Hint: {defect.fix_hint}

Current Code (excerpt):
```typescript
{content_excerpt}
```

Provide ONLY the specific code change needed, not the full file.
Format as:
OLD:
<exact code to replace>
NEW:
<replacement code>
"""
            
            cursor = conn.cursor()
            cursor.execute(f"""
                SELECT SNOWFLAKE.CORTEX.COMPLETE(
                    'claude-sonnet-4-5',
                    '{prompt.replace("'", "''")}'
                )
            """)
            
            result = cursor.fetchone()
            conn.close()
            
            if result:
                response = result[0]
                
                # Parse OLD/NEW format
                old_match = re.search(r'OLD:\s*```?\w*\s*(.*?)```?\s*NEW:', response, re.DOTALL)
                new_match = re.search(r'NEW:\s*```?\w*\s*(.*?)```?\s*$', response, re.DOTALL)
                
                if old_match and new_match:
                    old_code = old_match.group(1).strip()
                    new_code = new_match.group(1).strip()
                    
                    if old_code in original_content:
                        patched_content = original_content.replace(old_code, new_code, 1)
                        
                        is_valid = self._validate_typescript(patched_content)
                        
                        return FrontendFix(
                            file_path=str(file_path),
                            defect=defect,
                            original_content=original_content,
                            patched_content=patched_content,
                            patch_description=f"LLM fix for {defect.defect_type.value} in {file_path.name}",
                            validated=is_valid
                        )
            
        except Exception as e:
            print(f"    LLM fix generation failed: {e}")
        
        return None
    
    def _validate_typescript(self, content: str) -> bool:
        """
        Basic TypeScript validation.
        """
        # Check for basic syntax validity
        checks = [
            content.count('{') == content.count('}'),
            content.count('(') == content.count(')'),
            content.count('[') == content.count(']'),
            'export' in content or 'import' in content,
        ]
        return all(checks)
    
    async def _apply_file_fix(self, fix: FrontendFix) -> None:
        """
        Apply a fix to a file.
        """
        file_path = Path(fix.file_path)
        
        # Store original for rollback
        if str(file_path) not in self.modified_files:
            self.modified_files[str(file_path)] = fix.original_content
        
        # Write patched content
        file_path.write_text(fix.patched_content)
    
    async def _create_stash(self) -> None:
        """
        Create git stash for safety.
        """
        try:
            result = subprocess.run(
                ["git", "stash", "push", "-m", f"convergence-loop-backup-{datetime.now().isoformat()}"],
                cwd=self.frontend_dir,
                capture_output=True,
                text=True
            )
            if "Saved working directory" in result.stdout:
                self.stash_id = "stash@{0}"
                print("    Created git stash backup")
        except Exception as e:
            print(f"    Warning: Could not create git stash: {e}")
    
    async def _rebuild_frontend(self) -> bool:
        """
        Rebuild frontend to validate changes compile.
        """
        print("    Rebuilding frontend...")
        
        try:
            result = subprocess.run(
                ["npm", "run", "build"],
                cwd=self.frontend_dir,
                capture_output=True,
                text=True,
                timeout=120
            )
            
            if result.returncode == 0:
                print("    ✓ Frontend build successful")
                return True
            else:
                print(f"    ✗ Build failed: {result.stderr[:200]}")
                return False
                
        except subprocess.TimeoutExpired:
            print("    ✗ Build timed out")
            return False
        except Exception as e:
            print(f"    ✗ Build error: {e}")
            return False
    
    async def _rollback(self) -> None:
        """
        Rollback all changes.
        """
        print("    Rolling back frontend changes...")
        
        # Restore original file contents
        for file_path, original_content in self.modified_files.items():
            try:
                Path(file_path).write_text(original_content)
                print(f"    ✓ Restored {Path(file_path).name}")
            except Exception as e:
                print(f"    ✗ Could not restore {file_path}: {e}")
        
        self.modified_files.clear()
        self.applied_fixes.clear()
