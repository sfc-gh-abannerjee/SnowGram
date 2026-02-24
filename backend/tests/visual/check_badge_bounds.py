#!/usr/bin/env python3
"""Check badge node bounds and styling in rendered diagram."""
import sys
import os
sys.path.insert(0, '/Users/abannerjee/Documents/SnowGram')
os.chdir('/Users/abannerjee/Documents/SnowGram')

from playwright.sync_api import sync_playwright
import snowflake.connector
import tomllib

config_path = os.path.expanduser('~/.snowflake/config.toml')
with open(config_path, 'rb') as f:
    config = tomllib.load(f)
se_demo = config.get('connections', {}).get('se_demo', {})

def get_connection_params():
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
        page = browser.new_page(viewport={'width': 1400, 'height': 900})
        page.goto('http://localhost:3002')
        page.wait_for_timeout(2000)
        
        # Get the mermaid code for STREAMING_DATA_STACK
        conn = snowflake.connector.connect(**get_connection_params())
        cursor = conn.cursor()
        cursor.execute("SELECT SNOWGRAM_DB.CORE.COMPOSE_DIAGRAM_FROM_TEMPLATE('STREAMING_DATA_STACK') as mermaid")
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
        
        # Fit to view (like Ralph loop does)
        page.evaluate('window.fitViewOnDiagram && window.fitViewOnDiagram()')
        page.wait_for_timeout(1000)
        
        # Check ALL nodes to understand what's rendered
        info = page.evaluate("""
            () => {
                const results = [];
                document.querySelectorAll('.react-flow__node').forEach(node => {
                    const id = node.getAttribute('data-id');
                    if (!id) return;
                    
                    const rect = node.getBoundingClientRect();
                    const inner = node.querySelector('div');
                    
                    // Get transform to find actual position
                    const transform = node.style.transform;
                    
                    results.push({
                        id: id,
                        type: node.className.includes('laneLabelNode') ? 'laneLabelNode' : 'other',
                        width: rect.width.toFixed(0),
                        height: rect.height.toFixed(0),
                        bg: inner ? window.getComputedStyle(inner).backgroundColor : 'N/A',
                        borderRadius: inner ? window.getComputedStyle(inner).borderRadius : 'N/A',
                        transform: transform ? transform.substring(0, 40) : 'none'
                    });
                });
                return results.filter(r => r.id.includes('label') || r.id.includes('badge'));
            }
        """)
        
        print('Badge/Label nodes:')
        for item in info:
            print(f"  {item['id']}: {item['width']}x{item['height']} bg={item['bg']} br={item['borderRadius']} type={item['type']}")
        
        # Screenshot showing the badge positions
        page.screenshot(path='/Users/abannerjee/Documents/SnowGram/output/badge_bounds_check.png')
        print('\nScreenshot saved to output/badge_bounds_check.png')
        
        browser.close()

if __name__ == '__main__':
    main()
