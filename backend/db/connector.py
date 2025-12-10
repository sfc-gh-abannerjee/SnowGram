"""
Snowflake Database Connector
============================
Manages Snowflake connections and query execution.

Usage:
    connector = SnowflakeConnector(account="...", user="...", password="...")
    await connector.connect()
    result = await connector.execute_query("SELECT * FROM table")
    await connector.close()
"""

import logging
from typing import Optional, List, Dict, Any
import asyncio

import snowflake.connector
from snowflake.connector import DictCursor
from snowflake.connector.errors import Error as SnowflakeError

logger = logging.getLogger(__name__)


class SnowflakeConnector:
    """Async-compatible Snowflake connector"""
    
    def __init__(
        self,
        account: str,
        user: str,
        password: str,
        role: str = "SNOWGRAM_APP_ROLE",
        warehouse: str = "SNOWGRAM_WH",
        database: str = "SNOWGRAM_DB",
        schema: str = "CORE"
    ):
        """
        Initialize Snowflake connector.
        
        Args:
            account: Snowflake account identifier
            user: Username
            password: Password or PAT token
            role: Role to use
            warehouse: Default warehouse
            database: Default database
            schema: Default schema
        """
        self.account = account
        self.user = user
        self.password = password
        self.role = role
        self.warehouse = warehouse
        self.database = database
        self.schema = schema
        
        self.connection: Optional[snowflake.connector.SnowflakeConnection] = None
    
    async def connect(self) -> None:
        """Establish connection to Snowflake"""
        try:
            # Run connection in thread pool (snowflake-connector is sync)
            loop = asyncio.get_event_loop()
            self.connection = await loop.run_in_executor(
                None,
                self._create_connection
            )
            logger.info(f"Connected to Snowflake as {self.user}")
        except SnowflakeError as e:
            logger.error(f"Failed to connect to Snowflake: {e}")
            raise
    
    def _create_connection(self) -> snowflake.connector.SnowflakeConnection:
        """Create Snowflake connection (sync operation)"""
        return snowflake.connector.connect(
            account=self.account,
            user=self.user,
            password=self.password,
            role=self.role,
            warehouse=self.warehouse,
            database=self.database,
            schema=self.schema
        )
    
    async def is_connected(self) -> bool:
        """Check if connection is active"""
        if not self.connection:
            return False
        
        try:
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(
                None,
                lambda: self.connection.cursor().execute("SELECT 1")
            )
            return True
        except Exception:
            return False
    
    async def execute_query(
        self,
        query: str,
        params: Optional[Dict[str, Any]] = None
    ) -> List[Dict[str, Any]]:
        """
        Execute SQL query and return results as list of dicts.
        
        Args:
            query: SQL query string
            params: Optional query parameters
        
        Returns:
            List of result rows as dictionaries
        """
        if not self.connection:
            raise RuntimeError("Not connected to Snowflake")
        
        try:
            loop = asyncio.get_event_loop()
            results = await loop.run_in_executor(
                None,
                self._execute_query_sync,
                query,
                params
            )
            return results
        except SnowflakeError as e:
            logger.error(f"Query execution failed: {e}")
            raise
    
    def _execute_query_sync(
        self,
        query: str,
        params: Optional[Dict[str, Any]] = None
    ) -> List[Dict[str, Any]]:
        """Execute query synchronously (for thread pool)"""
        cursor = self.connection.cursor(DictCursor)
        
        try:
            if params:
                cursor.execute(query, params)
            else:
                cursor.execute(query)
            
            results = cursor.fetchall()
            return results
        finally:
            cursor.close()
    
    async def execute_non_query(
        self,
        query: str,
        params: Optional[Dict[str, Any]] = None
    ) -> int:
        """
        Execute SQL query without fetching results (INSERT, UPDATE, DELETE).
        
        Args:
            query: SQL query string
            params: Optional query parameters
        
        Returns:
            Number of rows affected
        """
        if not self.connection:
            raise RuntimeError("Not connected to Snowflake")
        
        try:
            loop = asyncio.get_event_loop()
            row_count = await loop.run_in_executor(
                None,
                self._execute_non_query_sync,
                query,
                params
            )
            return row_count
        except SnowflakeError as e:
            logger.error(f"Query execution failed: {e}")
            raise
    
    def _execute_non_query_sync(
        self,
        query: str,
        params: Optional[Dict[str, Any]] = None
    ) -> int:
        """Execute non-query synchronously (for thread pool)"""
        cursor = self.connection.cursor()
        
        try:
            if params:
                cursor.execute(query, params)
            else:
                cursor.execute(query)
            
            row_count = cursor.rowcount
            self.connection.commit()
            return row_count
        finally:
            cursor.close()
    
    async def call_function(
        self,
        function_name: str,
        *args
    ) -> Any:
        """
        Call a Snowflake UDF or stored procedure.
        
        Args:
            function_name: Fully qualified function name
            *args: Function arguments
        
        Returns:
            Function result
        """
        placeholders = ', '.join(['%s'] * len(args))
        query = f"SELECT {function_name}({placeholders})"
        
        results = await self.execute_query(query, args)
        
        if results and len(results) > 0:
            return list(results[0].values())[0]
        return None
    
    async def call_cortex_agent(
        self,
        agent_name: str,
        query: str,
        context: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Call Cortex Agent and return structured response
        
        Args:
            agent_name: Name of the Cortex Agent (e.g., 'SNOWGRAM_AGENT')
            query: User's natural language query
            context: Optional context dict (diagram_type, use_case, etc.)
            
        Returns:
            dict with keys: mermaid_code, explanation, components_used
        """
        if not self.connection:
            await self.connect()
        
        try:
            # Build context string if provided
            context_str = ""
            if context:
                context_items = [f"{k}: {v}" for k, v in context.items() if v]
                if context_items:
                    context_str = f"\n\nContext: {', '.join(context_items)}"
            
            # Construct full query with context
            full_query = f"{query}{context_str}"
            
            # Call Cortex Agent using SNOWFLAKE.CORTEX.COMPLETE
            sql = f"""
                SELECT SNOWFLAKE.CORTEX.COMPLETE(
                    '{agent_name}',
                    %s
                ) AS response
            """
            
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(
                None,
                self._execute_cortex_agent_sync,
                sql,
                full_query
            )
            
            if not result or not result[0]:
                raise ValueError("Agent returned empty response")
            
            agent_response = result[0]
            
            # Parse agent response to extract Mermaid code and explanation
            mermaid_code = self._extract_mermaid_code(agent_response)
            explanation = self._extract_explanation(agent_response)
            components_used = self._extract_components(agent_response)
            
            return {
                "mermaid_code": mermaid_code,
                "explanation": explanation,
                "components_used": components_used,
                "raw_response": agent_response
            }
            
        except Exception as e:
            logger.error(f"Error calling Cortex Agent: {e}")
            raise
    
    def _execute_cortex_agent_sync(self, sql: str, query: str):
        """Execute Cortex Agent call synchronously"""
        cursor = self.connection.cursor()
        cursor.execute(sql, (query,))
        result = cursor.fetchone()
        cursor.close()
        return result
    
    def _extract_mermaid_code(self, response: str) -> str:
        """Extract Mermaid code from agent response"""
        import re
        
        # Look for code blocks with mermaid syntax
        pattern = r'```(?:mermaid)?\s*(flowchart.*?)```'
        match = re.search(pattern, response, re.DOTALL | re.IGNORECASE)
        
        if match:
            return match.group(1).strip()
        
        # Fallback: Look for flowchart keyword
        lines = response.split('\n')
        mermaid_lines = []
        in_flowchart = False
        
        for line in lines:
            if 'flowchart' in line.lower():
                in_flowchart = True
            if in_flowchart:
                mermaid_lines.append(line)
                # Stop at empty line or explanation markers
                if line.strip() == '' or 'explanation' in line.lower():
                    break
        
        if mermaid_lines:
            return '\n'.join(mermaid_lines).strip()
        
        # Last fallback: Return full response if it looks like Mermaid
        if 'flowchart' in response.lower():
            return response.strip()
        
        raise ValueError("Could not extract Mermaid code from agent response")
    
    def _extract_explanation(self, response: str) -> str:
        """Extract explanation from agent response"""
        import re
        
        # Look for explanation section
        patterns = [
            r'(?:explanation|description|details?):\s*(.+?)(?:\n\n|$)',
            r'(?:explanation|description|details?)\s*[:\-]\s*(.+?)(?:\n\n|$)',
        ]
        
        for pattern in patterns:
            match = re.search(pattern, response, re.DOTALL | re.IGNORECASE)
            if match:
                return match.group(1).strip()
        
        # Fallback: Extract text after code block
        if '```' in response:
            parts = response.split('```')
            if len(parts) > 2:
                explanation = parts[2].strip()
                if explanation:
                    return explanation[:500]  # Limit length
        
        return "Diagram generated successfully"
    
    def _extract_components(self, response: str) -> List[str]:
        """Extract list of components used from agent response"""
        import re
        
        # Look for components list
        pattern = r'(?:components?|blocks?)(?:\s+used)?:\s*\[?([^\]]+)\]?'
        match = re.search(pattern, response, re.IGNORECASE)
        
        if match:
            components_str = match.group(1)
            # Split by commas and clean up
            components = [c.strip().strip('"\'') for c in components_str.split(',')]
            return [c for c in components if c]
        
        return []
    
    async def close(self) -> None:
        """Close Snowflake connection"""
        if self.connection:
            try:
                loop = asyncio.get_event_loop()
                await loop.run_in_executor(
                    None,
                    self.connection.close
                )
                logger.info("Snowflake connection closed")
            except Exception as e:
                logger.error(f"Error closing connection: {e}")
            finally:
                self.connection = None






