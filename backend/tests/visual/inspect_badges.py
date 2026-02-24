#!/usr/bin/env python3
"""Inspect badge node styling in rendered diagram."""
import sys
import os
sys.path.insert(0, '/Users/abannerjee/Documents/SnowGram')
os.chdir('/Users/abannerjee/Documents/SnowGram')

from playwright.sync_api import sync_playwright
import snowflake.connector

# Inline connection params
import tomllib
config_path = os.path.expanduser('~/.snowflake/config.toml')
with open(config_path, 'rb') as f:
    config = tomllib.load(f)
se_demo = config.get('connections', {}).get('se_demo', {})

def get_connection_params(name='se_demo'):
    return {
        'account': se_demo.get('account'),
        'user': se_demo.get('user'),
        'password': se_demo.get('password'),
        'database': se_demo.get('database', 'SNOWGRAM_DB'),
        'schema': se_demo.get('schema', 'CORE'),
        'warehouse': se_demo.get('warehouse', 'COMPUTE_WH'),
    }

def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto('http://localhost:3002')
        page.wait_for_timeout(2000)
        
        # Get the mermaid code for STREAMING_DATA_STACK
        conn = snowflake.connector.connect(**get_connection_params('se_demo'))
        cursor = conn.cursor()
        cursor.execute("""
            SELECT SNOWGRAM_DB.CORE.COMPOSE_DIAGRAM_FROM_TEMPLATE('STREAMING_DATA_STACK') as mermaid
        """)
        row = cursor.fetchone()
        mermaid_code = row[0] if row else None
        cursor.close()
        conn.close()
        
        if not mermaid_code:
            print('ERROR: No mermaid code generated')
            return
        
        # Escape for JS template literal
        escaped_code = mermaid_code.replace('\\', '\\\\').replace('`', '\\`').replace('$', '\\$')
        
        # Inject the mermaid code
        page.evaluate(f'window.generateDiagram(`{escaped_code}`)')
        page.wait_for_timeout(5000)
        
        # Check all badge nodes
        badges = page.evaluate("""
            () => {
                const results = [];
                
                // Check lane_label_* nodes
                document.querySelectorAll('[data-id^="lane_label_"]').forEach(node => {
                    const inner = node.querySelector('div');
                    results.push({
                        id: node.getAttribute('data-id'),
                        type: 'lane_label',
                        innerBg: inner ? window.getComputedStyle(inner).backgroundColor : 'N/A'
                    });
                });
                
                // Then badge_* nodes  
                document.querySelectorAll('[data-id^="badge_"]').forEach(node => {
                    const inner = node.querySelector('div');
                    results.push({
                        id: node.getAttribute('data-id'),
                        type: 'badge_mermaid',
                        innerBg: inner ? window.getComputedStyle(inner).backgroundColor : 'N/A'
                    });
                });
                
                // Also check for section_label_*
                document.querySelectorAll('[data-id^="section_label_"]').forEach(node => {
                    const inner = node.querySelector('div');
                    results.push({
                        id: node.getAttribute('data-id'),
                        type: 'section_label',
                        innerBg: inner ? window.getComputedStyle(inner).backgroundColor : 'N/A'
                    });
                });
                
                return results;
            }
        """)
        
        print('Rendered badge nodes:')
        for b in badges:
            print(f"  {b['id']} ({b['type']}): bg={b['innerBg']}")
        
        # Save a test screenshot
        page.screenshot(path='/Users/abannerjee/Documents/SnowGram/output/test_badge_colors.png')
        print('\nScreenshot saved to output/test_badge_colors.png')
        
        browser.close()

if __name__ == '__main__':
    main()
