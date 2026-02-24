#!/usr/bin/env python3
"""Run a single iteration of the visual convergence loop."""

import asyncio
import subprocess
import sys
from playwright.async_api import async_playwright

async def run_visual_test(iteration: int = 2):
    # Get Mermaid code from Snowflake
    result = subprocess.run([
        'snow', 'sql', '-c', 'se_demo', '-q',
        "SELECT FULL_MERMAID_CODE FROM SNOWGRAM_DB.CORE.ARCHITECTURE_TEMPLATES WHERE TEMPLATE_NAME = 'Streaming Data Stack Reference Architecture'"
    ], capture_output=True, text=True)
    
    # Parse the Mermaid code - skip header rows
    lines = result.stdout.strip().split('\n')
    mermaid_code = None
    
    # Find the start of actual mermaid content
    in_content = False
    content_lines = []
    for line in lines:
        # Skip table formatting
        if line.startswith('+--') or line.startswith('|'):
            if '|' in line and 'FULL_MERMAID_CODE' not in line:
                # Extract content between pipes
                parts = line.split('|')
                if len(parts) >= 2:
                    content = parts[1].strip()
                    if content:
                        content_lines.append(content)
            continue
        if 'flowchart' in line.lower() or 'graph' in line.lower():
            in_content = True
        if in_content:
            content_lines.append(line)
    
    if content_lines:
        mermaid_code = '\n'.join(content_lines)
    
    print(f'Mermaid code length: {len(mermaid_code) if mermaid_code else 0}')
    
    if not mermaid_code or len(mermaid_code) < 100:
        print("ERROR: Could not extract Mermaid code")
        print(f"Raw output: {result.stdout[:500]}")
        return
    
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page(viewport={'width': 1920, 'height': 1080})
        
        # Capture console logs
        console_logs = []
        page.on('console', lambda msg: console_logs.append(f'[{msg.type}] {msg.text}'))
        
        await page.goto('http://localhost:3002/', wait_until='networkidle', timeout=30000)
        print('Page loaded')
        
        # Wait for React hydration and test hook
        try:
            await page.wait_for_function('typeof window.generateDiagram === "function"', timeout=10000)
            print('Test hook ready')
        except Exception as e:
            print(f'Hook not found: {e}')
            # Inject the hook if needed
            await page.evaluate('''() => {
                if (typeof window.generateDiagram !== "function") {
                    window.generateDiagram = (code) => {
                        const event = new CustomEvent('generateDiagram', { detail: code });
                        window.dispatchEvent(event);
                        return true;
                    };
                }
            }''')
            print('Hook injected manually')
        
        # Generate diagram by passing code
        gen_result = await page.evaluate('''(code) => {
            try {
                return window.generateDiagram(code);
            } catch(e) {
                return { error: e.message };
            }
        }''', mermaid_code)
        print(f'Generate result: {gen_result}')
        
        # Wait for diagram to render
        await asyncio.sleep(3)
        
        # Take screenshot
        output_path = f'output/iteration_{iteration}.png'
        await page.screenshot(path=output_path, full_page=False)
        print(f'Screenshot saved to {output_path}')
        
        # Print relevant console logs (layout and badge related)
        print('\n=== Console Logs (layout/badge/parser) ===')
        for log in console_logs:
            if any(k in log.lower() for k in ['layout', 'badge', 'lane', 'section', 'subgraph', 'metadata', 'classdef', 'mermaid parser', 'parsed']):
                print(log)
        
        await browser.close()
    
    # Save mermaid code for evaluation
    mermaid_path = f'output/iteration_{iteration}.mmd'
    with open(mermaid_path, 'w') as f:
        f.write(mermaid_code)
    print(f'Mermaid code saved to {mermaid_path}')
    
    # Run evaluation
    from eval_passes import VisualEvaluator
    evaluator = VisualEvaluator(
        mermaid_code=mermaid_code,
        generated_image_path=output_path,
        reference_image_path=None  # No reference yet
    )
    result = await evaluator.evaluate(iteration=iteration)
    evaluator.print_report(result)
    
    return result

if __name__ == '__main__':
    iteration = int(sys.argv[1]) if len(sys.argv) > 1 else 2
    asyncio.run(run_visual_test(iteration))
