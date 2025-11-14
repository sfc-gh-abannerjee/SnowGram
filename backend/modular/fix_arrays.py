#!/usr/bin/env python3
"""
Fix ARRAY_CONSTRUCT syntax in SQL files for Snowflake compatibility.
Converts ARRAY_CONSTRUCT(...) to PARSE_JSON('[...]')
"""

import re
import sys

def convert_array_construct(match):
    """Convert ARRAY_CONSTRUCT(...) to PARSE_JSON('[...]')"""
    content = match.group(1)
    
    if not content.strip():
        # Empty array
        return "NULL"
    
    # Split by comma, handling quoted strings
    items = []
    current = ""
    in_quotes = False
    
    for char in content:
        if char == "'" and (not current or current[-1] != '\\'):
            in_quotes = not in_quotes
        elif char == ',' and not in_quotes:
            items.append(current.strip().strip("'"))
            current = ""
            continue
        current += char
    
    if current.strip():
        items.append(current.strip().strip("'"))
    
    # Build JSON array
    json_items = [f'"{item}"' for item in items if item]
    json_array = f'[{", ".join(json_items)}]'
    
    return f"PARSE_JSON('{json_array}')"

def fix_sql_file(input_file, output_file):
    """Fix array syntax in SQL file"""
    with open(input_file, 'r') as f:
        content = f.read()
    
    # Replace ARRAY_CONSTRUCT with PARSE_JSON
    pattern = r'ARRAY_CONSTRUCT\(([^)]*)\)'
    fixed_content = re.sub(pattern, convert_array_construct, content)
    
    with open(output_file, 'w') as f:
        f.write(fixed_content)
    
    print(f"✅ Fixed {input_file} -> {output_file}")

if __name__ == "__main__":
    files = [
        ('component_blocks.sql', 'component_blocks_fixed.sql'),
        ('composed_patterns.sql', 'composed_patterns_fixed.sql'),
        ('full_templates.sql', 'full_templates_fixed.sql')
    ]
    
    for input_file, output_file in files:
        try:
            fix_sql_file(input_file, output_file)
        except FileNotFoundError:
            print(f"⚠️  File not found: {input_file}")
        except Exception as e:
            print(f"❌ Error processing {input_file}: {e}")






