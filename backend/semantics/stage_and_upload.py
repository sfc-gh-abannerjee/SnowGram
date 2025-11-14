"""
Stage and Upload Semantic Models to Snowflake
==============================================
Purpose: Upload semantic model YAML files to Snowflake stage for use with Cortex Analyst

Usage:
    python stage_and_upload.py

Requirements:
    - snowflake-connector-python
    - toml (for config file parsing)
"""

import os
import sys
import toml
import snowflake.connector
from pathlib import Path
from typing import List, Dict

# Configuration
SNOWFLAKE_CONFIG_PATH = os.path.expanduser("~/Library/Application Support/snowflake/config.toml")
CONNECTION_NAME = "svcUser"  # Use service account (no MFA)
STAGE_NAME = "SNOWGRAM_DB.CORE.SEMANTIC_MODELS_STAGE"
LOCAL_YAML_DIR = Path(__file__).parent

# YAML files to upload
YAML_FILES = [
    "diagram_components.yaml",
    "architecture_components.yaml",
    "reference_architectures.yaml",
    "user_diagrams.yaml"
]


def load_snowflake_config(config_path: str, connection_name: str) -> Dict:
    """Load Snowflake connection configuration from config.toml"""
    try:
        config = toml.load(config_path)
        connection_config = config.get("connections", {}).get(connection_name)
        
        if not connection_config:
            raise ValueError(f"Connection '{connection_name}' not found in config file")
        
        return connection_config
    except Exception as e:
        print(f"❌ Error loading Snowflake config: {e}")
        sys.exit(1)


def connect_to_snowflake(config: Dict) -> snowflake.connector.SnowflakeConnection:
    """Establish connection to Snowflake"""
    try:
        conn = snowflake.connector.connect(
            account=config["account"],
            user=config["user"],
            password=config.get("password"),  # PAT token for service account
            role=config.get("role", "SYSADMIN"),
            warehouse=config.get("warehouse", "COMPUTE_WH"),
            database=config.get("database", "SNOWGRAM_DB"),
            schema=config.get("schema", "CORE")
        )
        print(f"✅ Connected to Snowflake as {config['user']}")
        return conn
    except Exception as e:
        print(f"❌ Error connecting to Snowflake: {e}")
        sys.exit(1)


def verify_yaml_files(yaml_dir: Path, yaml_files: List[str]) -> None:
    """Verify that all YAML files exist locally"""
    missing_files = []
    for yaml_file in yaml_files:
        file_path = yaml_dir / yaml_file
        if not file_path.exists():
            missing_files.append(yaml_file)
        else:
            print(f"✓ Found: {yaml_file}")
    
    if missing_files:
        print(f"❌ Missing YAML files: {', '.join(missing_files)}")
        sys.exit(1)
    
    print(f"✅ All {len(yaml_files)} YAML files found")


def upload_file_to_stage(
    conn: snowflake.connector.SnowflakeConnection,
    local_file_path: Path,
    stage_name: str
) -> None:
    """Upload a single file to Snowflake stage"""
    try:
        cursor = conn.cursor()
        
        # PUT command to upload file
        put_sql = f"""
            PUT file://{local_file_path.absolute()}
            @{stage_name}
            AUTO_COMPRESS = FALSE
            OVERWRITE = TRUE
        """
        
        cursor.execute(put_sql)
        result = cursor.fetchall()
        
        if result and result[0][6] == "UPLOADED":  # status column
            print(f"  ✓ Uploaded: {local_file_path.name}")
        else:
            print(f"  ⚠️  Upload result: {result}")
        
        cursor.close()
    except Exception as e:
        print(f"  ❌ Error uploading {local_file_path.name}: {e}")
        raise


def list_stage_files(
    conn: snowflake.connector.SnowflakeConnection,
    stage_name: str
) -> None:
    """List files currently in the stage"""
    try:
        cursor = conn.cursor()
        list_sql = f"LIST @{stage_name}"
        cursor.execute(list_sql)
        
        print(f"\n📂 Files in {stage_name}:")
        for row in cursor.fetchall():
            file_name = row[0].split("/")[-1]  # Extract filename from path
            file_size = row[1]  # Size in bytes
            print(f"  • {file_name} ({file_size:,} bytes)")
        
        cursor.close()
    except Exception as e:
        print(f"❌ Error listing stage files: {e}")


def grant_stage_access(
    conn: snowflake.connector.SnowflakeConnection,
    stage_name: str
) -> None:
    """Grant read access on stage to application role"""
    try:
        cursor = conn.cursor()
        
        # Switch to ACCOUNTADMIN to grant privileges
        cursor.execute("USE ROLE ACCOUNTADMIN")
        
        grant_sql = f"GRANT READ ON STAGE {stage_name} TO ROLE SNOWGRAM_APP_ROLE"
        cursor.execute(grant_sql)
        
        print(f"✅ Granted READ privilege on {stage_name} to SNOWGRAM_APP_ROLE")
        
        cursor.close()
    except Exception as e:
        print(f"⚠️  Note: Could not grant stage access (may already be granted): {e}")


def main():
    """Main execution function"""
    print("=" * 60)
    print("  SnowGram: Stage and Upload Semantic Models")
    print("=" * 60)
    print()
    
    # Step 1: Verify YAML files exist
    print("📋 Step 1: Verifying YAML files...")
    verify_yaml_files(LOCAL_YAML_DIR, YAML_FILES)
    print()
    
    # Step 2: Load Snowflake configuration
    print("🔧 Step 2: Loading Snowflake configuration...")
    config = load_snowflake_config(SNOWFLAKE_CONFIG_PATH, CONNECTION_NAME)
    print(f"✅ Loaded config for connection: {CONNECTION_NAME}")
    print()
    
    # Step 3: Connect to Snowflake
    print("🔌 Step 3: Connecting to Snowflake...")
    conn = connect_to_snowflake(config)
    print()
    
    # Step 4: Upload YAML files to stage
    print(f"📤 Step 4: Uploading {len(YAML_FILES)} YAML files to {STAGE_NAME}...")
    for yaml_file in YAML_FILES:
        local_file_path = LOCAL_YAML_DIR / yaml_file
        upload_file_to_stage(conn, local_file_path, STAGE_NAME)
    print(f"✅ All files uploaded successfully")
    print()
    
    # Step 5: Verify uploaded files
    print("🔍 Step 5: Verifying uploaded files...")
    list_stage_files(conn, STAGE_NAME)
    print()
    
    # Step 6: Grant stage access
    print("🔐 Step 6: Granting stage access...")
    grant_stage_access(conn, STAGE_NAME)
    print()
    
    # Close connection
    conn.close()
    print("=" * 60)
    print("✅ Setup complete!")
    print()
    print("Next steps:")
    print("1. Run create_semantic_views.sql to create semantic views")
    print("2. Configure Cortex Agent to use these semantic models")
    print("3. Test natural language queries via Cortex Analyst")
    print("=" * 60)


if __name__ == "__main__":
    main()






