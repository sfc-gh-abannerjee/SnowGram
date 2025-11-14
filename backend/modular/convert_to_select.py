#!/usr/bin/env python3
"""
Convert INSERT INTO ... VALUES to INSERT INTO ... SELECT
for Snowflake compatibility with function calls
"""

import re

def convert_insert_to_select(sql_content):
    """Convert INSERT VALUES to INSERT SELECT"""
    
    # Pattern to match INSERT statements
    pattern = r"INSERT INTO (\w+)\s*\(([\w\s,]+)\)\s*VALUES\s*\((.*?)\);"
    
    def replace_insert(match):
        table_name = match.group(1)
        columns = match.group(2)
        values = match.group(3)
        
        # Build SELECT statement
        select_stmt = f"""INSERT INTO {table_name} ({columns})
SELECT
    {values};"""
        
        return select_stmt
    
    # Replace all INSERT statements
    result = re.sub(pattern, replace_insert, sql_content, flags=re.DOTALL)
    
    return result

def process_file(input_file, output_file):
    """Process SQL file"""
    with open(input_file, 'r') as f:
        content = f.read()
    
    fixed_content = convert_insert_to_select(content)
    
    with open(output_file, 'w') as f:
        f.write(fixed_content)
    
    print(f"✅ Converted {input_file} -> {output_file}")

if __name__ == "__main__":
    files = [
        ('component_blocks_fixed.sql', 'component_blocks_select.sql'),
        ('composed_patterns_fixed.sql', 'composed_patterns_select.sql'),
        ('full_templates_fixed.sql', 'full_templates_select.sql')
    ]
    
    for input_file, output_file in files:
        try:
            process_file(input_file, output_file)
        except FileNotFoundError:
            print(f"⚠️  File not found: {input_file}")
        except Exception as e:
            print(f"❌ Error processing {input_file}: {e}")






