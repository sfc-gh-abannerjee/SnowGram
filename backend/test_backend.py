#!/usr/bin/env python3
"""
Quick test script for SnowGram backend
Tests Snowflake connection and data retrieval
"""

import sys
import os
from pathlib import Path

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent / 'backend'))

try:
    import snowflake.connector
    import toml
    print("✅ Snowflake connector imported successfully")
except ImportError as e:
    print(f"❌ Import error: {e}")
    sys.exit(1)

def test_connection():
    """Test Snowflake connection"""
    print("\n🔍 Testing Snowflake Connection...")
    
    try:
        # Load connection config
        config_path = os.path.expanduser('~/Library/Application Support/snowflake/config.toml')
        config = toml.load(config_path)
        
        # Use svcUser connection (no MFA)
        conn_config = config['connections']['svcUser']
        
        conn = snowflake.connector.connect(
            account=conn_config['account'],
            user=conn_config['user'],
            password=conn_config['password'],
            role=conn_config['role'],
            warehouse=conn_config.get('warehouse', 'COMPUTE_WH'),
            database='SNOWGRAM_DB',
            schema='CORE'
        )
        
        print("✅ Connected to Snowflake successfully")
        return conn
    
    except Exception as e:
        print(f"❌ Connection failed: {e}")
        return None

def test_data_retrieval(conn):
    """Test data retrieval from component blocks"""
    print("\n🔍 Testing Data Retrieval...")
    
    try:
        cursor = conn.cursor()
        
        # Test 1: Count component blocks
        cursor.execute("SELECT COUNT(*) FROM COMPONENT_BLOCKS")
        count = cursor.fetchone()[0]
        print(f"✅ Component Blocks: {count} rows")
        
        # Test 2: Get sample block
        cursor.execute("""
            SELECT block_id, block_name, block_category, complexity
            FROM COMPONENT_BLOCKS
            LIMIT 5
        """)
        
        print("\n📦 Sample Component Blocks:")
        for row in cursor:
            print(f"  - {row[0]}: {row[1]} ({row[2]}, {row[3]})")
        
        # Test 3: Count patterns
        cursor.execute("SELECT COUNT(*) FROM COMPOSED_PATTERNS")
        pattern_count = cursor.fetchone()[0]
        print(f"\n✅ Composed Patterns: {pattern_count} rows")
        
        # Test 4: Count templates
        cursor.execute("SELECT COUNT(*) FROM ARCHITECTURE_TEMPLATES")
        template_count = cursor.fetchone()[0]
        print(f"✅ Architecture Templates: {template_count} rows")
        
        cursor.close()
        return True
        
    except Exception as e:
        print(f"❌ Data retrieval failed: {e}")
        return False

def test_custom_function(conn):
    """Test custom UDF if available"""
    print("\n🔍 Testing Custom Functions...")
    
    try:
        cursor = conn.cursor()
        
        # Test GENERATE_MERMAID_FROM_COMPONENTS
        cursor.execute("""
            SELECT GENERATE_MERMAID_FROM_COMPONENTS(
                PARSE_JSON('["S3_BUCKET_BLOCK"]'),
                PARSE_JSON('{}')
            ) AS mermaid_code
        """)
        
        result = cursor.fetchone()
        if result:
            print(f"✅ Generated Mermaid code:\n{result[0][:200]}...")
        
        cursor.close()
        return True
        
    except Exception as e:
        print(f"⚠️  Custom function test skipped: {e}")
        return False

def main():
    """Run all tests"""
    print("=" * 60)
    print("  SnowGram Backend Test Suite")
    print("=" * 60)
    
    # Test connection
    conn = test_connection()
    if not conn:
        print("\n❌ Tests failed: Could not connect to Snowflake")
        return 1
    
    # Test data retrieval
    if not test_data_retrieval(conn):
        print("\n⚠️  Data retrieval had issues")
    
    # Test custom functions
    test_custom_function(conn)
    
    # Close connection
    conn.close()
    print("\n" + "=" * 60)
    print("✅ Backend tests complete!")
    print("=" * 60)
    
    return 0

if __name__ == "__main__":
    sys.exit(main())






