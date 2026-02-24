#!/usr/bin/env python3
"""
Backend Fixer for Visual Convergence Loop
==========================================

Modifies ARCHITECTURE_TEMPLATES table in Snowflake to fix
template Mermaid code defects identified by the evaluator.

Capabilities:
- Generates Mermaid code patches using LLM
- Updates templates via SQL
- Preserves original templates for rollback
- Validates syntax before committing
"""

from dataclasses import dataclass
from typing import Dict, List, Optional, Any
import os
import json
import toml
from pathlib import Path
from datetime import datetime

from defect_classifier import Defect, DefectType, DiagnosisResult


@dataclass
class BackendFix:
    """A fix to apply to template code"""
    template_id: str
    defect: Defect
    original_code: str
    patched_code: str
    patch_description: str
    validated: bool = False


@dataclass
class BackendFixResult:
    """Result of applying a backend fix"""
    success: bool
    template_id: str
    fixes_applied: List[str]
    original_code: str
    patched_code: str
    error: Optional[str] = None
    rollback_available: bool = True


class BackendFixer:
    """
    Fixes defects in ARCHITECTURE_TEMPLATES Mermaid code.
    """
    
    def __init__(
        self,
        template_id: str,
        current_mermaid_code: str,
        snowflake_connection: str = "se_demo"
    ):
        self.template_id = template_id
        self.current_code = current_mermaid_code
        self.connection_name = snowflake_connection
        
        # Store original for rollback
        self.original_code = current_mermaid_code
        
        # Load Snowflake config
        config_path = Path.home() / ".snowflake" / "config.toml"
        if config_path.exists():
            config = toml.load(config_path)
            self.sf_config = config["connections"].get(snowflake_connection, {})
        else:
            self.sf_config = {}
        
        # Track applied fixes
        self.applied_fixes: List[BackendFix] = []
    
    async def apply_fixes(
        self,
        diagnosis: DiagnosisResult
    ) -> BackendFixResult:
        """
        Apply fixes for backend defects.
        
        Args:
            diagnosis: Diagnosis result with backend defects
            
        Returns:
            BackendFixResult with outcome
        """
        if not diagnosis.backend_defects:
            return BackendFixResult(
                success=True,
                template_id=self.template_id,
                fixes_applied=[],
                original_code=self.original_code,
                patched_code=self.current_code,
                error="No backend defects to fix"
            )
        
        print(f"\n  Applying {len(diagnosis.backend_defects)} backend fixes...")
        
        patched_code = self.current_code
        fixes_applied = []
        
        # Apply each fix in priority order
        for defect in sorted(diagnosis.backend_defects, key=lambda d: d.severity, reverse=True):
            try:
                fix = await self._generate_fix(defect, patched_code)
                
                if fix and fix.validated:
                    patched_code = fix.patched_code
                    fixes_applied.append(fix.patch_description)
                    self.applied_fixes.append(fix)
                    print(f"    ✓ Applied: {fix.patch_description[:50]}...")
                else:
                    print(f"    ✗ Could not generate valid fix for: {defect.defect_type.value}")
                    
            except Exception as e:
                print(f"    ✗ Fix failed: {e}")
        
        # Update database if we have fixes
        if fixes_applied:
            update_success = await self._update_template_in_db(patched_code)
            
            if update_success:
                self.current_code = patched_code
                return BackendFixResult(
                    success=True,
                    template_id=self.template_id,
                    fixes_applied=fixes_applied,
                    original_code=self.original_code,
                    patched_code=patched_code
                )
            else:
                return BackendFixResult(
                    success=False,
                    template_id=self.template_id,
                    fixes_applied=[],
                    original_code=self.original_code,
                    patched_code=self.current_code,
                    error="Failed to update template in database"
                )
        
        return BackendFixResult(
            success=False,
            template_id=self.template_id,
            fixes_applied=[],
            original_code=self.original_code,
            patched_code=self.current_code,
            error="No fixes could be applied"
        )
    
    async def _generate_fix(
        self,
        defect: Defect,
        current_code: str
    ) -> Optional[BackendFix]:
        """
        Generate a fix for a specific defect.
        """
        if defect.defect_type == DefectType.MISSING_BADGE:
            return await self._fix_missing_badge(defect, current_code)
        elif defect.defect_type == DefectType.MISSING_NODE:
            return await self._fix_missing_node(defect, current_code)
        elif defect.defect_type == DefectType.MISSING_SUBGRAPH:
            return await self._fix_missing_subgraph(defect, current_code)
        elif defect.defect_type == DefectType.WRONG_LABEL:
            return await self._fix_wrong_label(defect, current_code)
        elif defect.defect_type == DefectType.WRONG_CONNECTION:
            return await self._fix_wrong_connection(defect, current_code)
        else:
            # Use LLM for complex fixes
            return await self._llm_generate_fix(defect, current_code)
    
    async def _fix_missing_badge(
        self,
        defect: Defect,
        current_code: str
    ) -> Optional[BackendFix]:
        """
        Fix missing badge nodes in Mermaid code.
        """
        # Parse defect description to find which badges are missing
        description = defect.description.lower()
        
        # Badge patterns for streaming architecture
        badge_definitions = {
            "1a": 'badge_1a(["1a"]):::laneBadge',
            "1b": 'badge_1b(["1b"]):::laneBadge',
            "1c": 'badge_1c(["1c"]):::laneBadge',
            "1d": 'badge_1d(["1d"]):::laneBadge',
            "2": 'badge_2(["2"]):::sectionBadge',
            "3": 'badge_3(["3"]):::sectionBadge',
            "4": 'badge_4(["4"]):::sectionBadge',
            "5": 'badge_5(["5"]):::sectionBadge',
        }
        
        patched_code = current_code
        badges_added = []
        
        # Check which badges are missing
        for badge_id, badge_def in badge_definitions.items():
            badge_var = f"badge_{badge_id}" if len(badge_id) > 1 else f"badge_{badge_id}"
            if badge_var not in current_code:
                # Add badge definition after flowchart declaration
                insert_pos = patched_code.find('\n', patched_code.find('flowchart'))
                if insert_pos > 0:
                    patched_code = (
                        patched_code[:insert_pos + 1] +
                        f"    {badge_def}\n" +
                        patched_code[insert_pos + 1:]
                    )
                    badges_added.append(badge_id)
        
        if not badges_added:
            return None
        
        # Ensure badge styling exists
        if "classDef laneBadge" not in patched_code:
            patched_code += "\n    classDef laneBadge fill:#7C3AED,stroke:#5B21B6,color:#fff,font-weight:bold"
        if "classDef sectionBadge" not in patched_code:
            patched_code += "\n    classDef sectionBadge fill:#2563EB,stroke:#1D4ED8,color:#fff,font-weight:bold"
        
        # Validate syntax
        is_valid = self._validate_mermaid_syntax(patched_code)
        
        return BackendFix(
            template_id=self.template_id,
            defect=defect,
            original_code=current_code,
            patched_code=patched_code,
            patch_description=f"Added badges: {', '.join(badges_added)}",
            validated=is_valid
        )
    
    async def _fix_missing_node(
        self,
        defect: Defect,
        current_code: str
    ) -> Optional[BackendFix]:
        """
        Fix missing node definitions.
        Uses LLM to generate appropriate node code.
        """
        # For now, delegate to LLM
        return await self._llm_generate_fix(defect, current_code)
    
    async def _fix_missing_subgraph(
        self,
        defect: Defect,
        current_code: str
    ) -> Optional[BackendFix]:
        """
        Fix missing subgraph definitions.
        """
        # For now, delegate to LLM
        return await self._llm_generate_fix(defect, current_code)
    
    async def _fix_wrong_label(
        self,
        defect: Defect,
        current_code: str
    ) -> Optional[BackendFix]:
        """
        Fix incorrect node labels.
        """
        return await self._llm_generate_fix(defect, current_code)
    
    async def _fix_wrong_connection(
        self,
        defect: Defect,
        current_code: str
    ) -> Optional[BackendFix]:
        """
        Fix incorrect edge definitions.
        """
        return await self._llm_generate_fix(defect, current_code)
    
    async def _llm_generate_fix(
        self,
        defect: Defect,
        current_code: str
    ) -> Optional[BackendFix]:
        """
        Use LLM to generate a fix for complex defects.
        """
        try:
            import snowflake.connector
            
            # Connect to Snowflake
            conn = snowflake.connector.connect(
                account=self.sf_config.get("account"),
                user=self.sf_config.get("user"),
                password=self.sf_config.get("password"),
                role=self.sf_config.get("role", "ACCOUNTADMIN")
            )
            
            prompt = f"""Fix this Mermaid diagram defect.

Defect Type: {defect.defect_type.value}
Description: {defect.description}
Fix Hint: {defect.fix_hint}

Current Mermaid Code:
```mermaid
{current_code}
```

Provide ONLY the corrected Mermaid code, no explanations.
Keep all existing structure but fix the specific defect.
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
                patched_code = result[0]
                
                # Extract code from markdown if present
                if "```mermaid" in patched_code:
                    start = patched_code.find("```mermaid") + 10
                    end = patched_code.find("```", start)
                    patched_code = patched_code[start:end].strip()
                elif "```" in patched_code:
                    start = patched_code.find("```") + 3
                    end = patched_code.find("```", start)
                    patched_code = patched_code[start:end].strip()
                
                is_valid = self._validate_mermaid_syntax(patched_code)
                
                return BackendFix(
                    template_id=self.template_id,
                    defect=defect,
                    original_code=current_code,
                    patched_code=patched_code,
                    patch_description=f"LLM fix for {defect.defect_type.value}",
                    validated=is_valid
                )
            
        except Exception as e:
            print(f"    LLM fix generation failed: {e}")
        
        return None
    
    def _validate_mermaid_syntax(self, code: str) -> bool:
        """
        Validate Mermaid syntax.
        """
        if not code or len(code.strip()) == 0:
            return False
        
        checks = [
            code.strip().startswith(('flowchart', 'graph')),
            '-->' in code or '[' in code,
            code.count('[') == code.count(']'),
            code.count('(') == code.count(')'),
            code.count('{') == code.count('}'),
        ]
        
        return all(checks)
    
    async def _update_template_in_db(self, patched_code: str) -> bool:
        """
        Update the template in Snowflake database.
        """
        try:
            import snowflake.connector
            
            conn = snowflake.connector.connect(
                account=self.sf_config.get("account"),
                user=self.sf_config.get("user"),
                password=self.sf_config.get("password"),
                role=self.sf_config.get("role", "ACCOUNTADMIN")
            )
            
            cursor = conn.cursor()
            
            # First, backup current template
            cursor.execute(f"""
                INSERT INTO SNOWGRAM_DB.CORE.TEMPLATE_HISTORY 
                    (template_id, full_mermaid_code, saved_at)
                SELECT template_id, full_mermaid_code, CURRENT_TIMESTAMP()
                FROM SNOWGRAM_DB.CORE.ARCHITECTURE_TEMPLATES
                WHERE template_id = '{self.template_id}'
            """)
            
            # Update template
            cursor.execute(f"""
                UPDATE SNOWGRAM_DB.CORE.ARCHITECTURE_TEMPLATES
                SET full_mermaid_code = $${patched_code}$$,
                    updated_at = CURRENT_TIMESTAMP()
                WHERE template_id = '{self.template_id}'
            """)
            
            conn.commit()
            conn.close()
            
            print(f"    ✓ Template {self.template_id} updated in database")
            return True
            
        except Exception as e:
            print(f"    ✗ Database update failed: {e}")
            return False
    
    async def rollback(self) -> bool:
        """
        Rollback to original template code.
        """
        try:
            import snowflake.connector
            
            conn = snowflake.connector.connect(
                account=self.sf_config.get("account"),
                user=self.sf_config.get("user"),
                password=self.sf_config.get("password"),
                role=self.sf_config.get("role", "ACCOUNTADMIN")
            )
            
            cursor = conn.cursor()
            cursor.execute(f"""
                UPDATE SNOWGRAM_DB.CORE.ARCHITECTURE_TEMPLATES
                SET full_mermaid_code = $${self.original_code}$$,
                    updated_at = CURRENT_TIMESTAMP()
                WHERE template_id = '{self.template_id}'
            """)
            
            conn.commit()
            conn.close()
            
            self.current_code = self.original_code
            print(f"    ✓ Template {self.template_id} rolled back")
            return True
            
        except Exception as e:
            print(f"    ✗ Rollback failed: {e}")
            return False
