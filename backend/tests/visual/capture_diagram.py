#!/usr/bin/env python3
"""
Playwright script to capture SnowGram diagram screenshot.

This script captures a screenshot of the ReactFlow diagram canvas for
visual comparison against reference architecture images.

Usage:
    python capture_diagram.py [--output OUTPUT_PATH] [--url URL] [--template TEMPLATE_ID]

Examples:
    python capture_diagram.py
    python capture_diagram.py --output my_screenshot.png
    python capture_diagram.py --template STREAMING_DATA_STACK
"""

import asyncio
import argparse
import sys
from pathlib import Path

try:
    from playwright.async_api import async_playwright, TimeoutError as PlaywrightTimeout
except ImportError:
    print("Playwright not installed. Run: pip install playwright && playwright install chromium")
    sys.exit(1)


async def capture_diagram(
    output_path: str = "output/generated.png",
    url: str = "http://localhost:3002",
    template_id: str | None = None,
    viewport_width: int = 1920,
    viewport_height: int = 1080,
    wait_timeout: int = 10000,
    animation_delay: int = 2000
) -> str:
    """
    Capture a screenshot of the SnowGram diagram.
    
    Args:
        output_path: Path to save the screenshot
        url: Frontend URL
        template_id: Optional template ID to load (triggers generation)
        viewport_width: Browser viewport width
        viewport_height: Browser viewport height
        wait_timeout: Timeout for element visibility (ms)
        animation_delay: Delay for layout animation to complete (ms)
    
    Returns:
        Path to the saved screenshot
    """
    async with async_playwright() as p:
        print(f"Launching browser...")
        browser = await p.chromium.launch(headless=True)
        
        context = await browser.new_context(
            viewport={"width": viewport_width, "height": viewport_height}
        )
        page = await context.new_page()
        
        try:
            print(f"Navigating to {url}...")
            await page.goto(url, wait_until="networkidle")
            
            # If template_id provided, trigger diagram generation
            if template_id:
                print(f"Triggering diagram generation for template: {template_id}")
                # Type in the chat input and submit
                chat_input = page.locator('textarea[placeholder*="message"], input[placeholder*="message"]')
                if await chat_input.count() > 0:
                    await chat_input.fill(f"Generate {template_id} architecture diagram")
                    await page.keyboard.press("Enter")
                    # Wait longer for generation
                    await page.wait_for_timeout(5000)
            
            # Wait for ReactFlow canvas to be visible
            print("Waiting for diagram to render...")
            try:
                await page.wait_for_selector('.react-flow', state='visible', timeout=wait_timeout)
            except PlaywrightTimeout:
                print("Warning: ReactFlow canvas not found, capturing full page instead")
                await page.screenshot(path=output_path, full_page=True)
                await browser.close()
                return output_path
            
            # Additional wait for layout animation to complete
            print(f"Waiting {animation_delay}ms for layout animation...")
            await page.wait_for_timeout(animation_delay)
            
            # Capture element-level screenshot (Playwright best practice)
            print("Capturing diagram screenshot...")
            element = page.locator('.react-flow')
            
            # Ensure output directory exists
            output_file = Path(output_path)
            output_file.parent.mkdir(parents=True, exist_ok=True)
            
            await element.screenshot(path=str(output_file))
            print(f"Screenshot saved to: {output_file.absolute()}")
            
        except Exception as e:
            print(f"Error capturing screenshot: {e}")
            # Fallback to full page screenshot
            await page.screenshot(path=output_path, full_page=True)
            print(f"Fallback: Full page screenshot saved to: {output_path}")
        
        finally:
            await browser.close()
        
        return output_path


async def capture_with_mermaid(
    mermaid_code: str,
    output_path: str = "output/generated.png",
    frontend_url: str = "http://localhost:3002",
    viewport_width: int = 1920,
    viewport_height: int = 1080,
    layout_delay: int = 3000
) -> str:
    """
    Inject Mermaid code directly into frontend and capture screenshot.
    
    This bypasses the API/chat and directly calls the frontend's
    parseMermaidAndCreateDiagram function via JavaScript injection.
    
    Args:
        mermaid_code: Mermaid flowchart code to render
        output_path: Path to save the screenshot
        frontend_url: Frontend URL
        viewport_width: Browser viewport width
        viewport_height: Browser viewport height
        layout_delay: Delay for layout to complete (ms)
    
    Returns:
        Path to the saved screenshot
    """
    async with async_playwright() as p:
        print(f"Launching browser...")
        browser = await p.chromium.launch(headless=True)
        
        context = await browser.new_context(
            viewport={"width": viewport_width, "height": viewport_height}
        )
        page = await context.new_page()
        
        # Capture console logs
        console_logs = []
        page.on("console", lambda msg: console_logs.append(f"[{msg.type}] {msg.text}"))
        
        try:
            print(f"Navigating to {frontend_url}...")
            await page.goto(frontend_url, wait_until="networkidle")
            
            # Wait for React app to fully load
            await page.wait_for_selector('.react-flow', state='visible', timeout=10000)
            await page.wait_for_timeout(1000)  # Let React settle
            
            # Inject Mermaid code via window function
            # The frontend exposes parseMermaidAndCreateDiagram on window for testing
            print("Injecting Mermaid code into frontend...")
            
            # Escape the mermaid code for JavaScript
            escaped_code = mermaid_code.replace('\\', '\\\\').replace('`', '\\`').replace('$', '\\$')
            
            # Wait for React to hydrate and expose the test hook
            print("Waiting for test hook to be available...")
            await page.wait_for_function(
                "typeof window.generateDiagram === 'function' || typeof window.__SNOWGRAM_TEST__ === 'object'",
                timeout=10000
            )
            
            # Try to find and use the global diagram generator
            # First, check if there's an exposed API
            result = await page.evaluate(f'''
                async () => {{
                    const mermaidCode = `{escaped_code}`;
                    
                    // Method 1: Try window.generateDiagram if exposed
                    if (typeof window.generateDiagram === 'function') {{
                        await window.generateDiagram(mermaidCode);
                        return {{ success: true, method: 'generateDiagram' }};
                    }}
                    
                    // Method 2: Dispatch custom event that App.tsx might listen to
                    const event = new CustomEvent('snowgram:loadMermaid', {{
                        detail: {{ mermaidCode }}
                    }});
                    window.dispatchEvent(event);
                    
                    // Method 3: Find React instance and call function
                    // This is a fallback - look for exposed test utils
                    if (typeof window.__SNOWGRAM_TEST__ === 'object') {{
                        await window.__SNOWGRAM_TEST__.parseMermaid(mermaidCode);
                        return {{ success: true, method: 'test_utils' }};
                    }}
                    
                    return {{ success: false, method: 'none', message: 'No injection method found' }};
                }}
            ''')
            
            print(f"Injection result: {result}")
            
            if not result.get('success'):
                # Fallback: Simulate typing into chat
                print("Falling back to chat input method...")
                chat_input = page.locator('textarea[placeholder*="message"], textarea[placeholder*="Chat"], input[type="text"]').first
                if await chat_input.count() > 0:
                    # Create a special command format the frontend might recognize
                    command = f"```mermaid\\n{mermaid_code}\\n```"
                    await chat_input.fill(command)
                    await page.keyboard.press("Enter")
            
            # CRITICAL: Wait for React to re-render and nodes to appear in DOM
            # React's setState is async - generateDiagram returns before re-render completes
            print("Waiting for React to re-render nodes into DOM...")
            try:
                # Wait for at least one ReactFlow node to appear
                await page.wait_for_selector('.react-flow__node', state='visible', timeout=10000)
                print("✓ Nodes detected in DOM")
                
                # Count nodes to verify
                node_count = await page.evaluate("document.querySelectorAll('.react-flow__node').length")
                print(f"✓ Found {node_count} nodes in DOM")
                
            except PlaywrightTimeout:
                print("WARNING: No nodes appeared in DOM after 10 seconds")
                # Debug: Check what's in the DOM
                debug_info = await page.evaluate('''
                    () => ({
                        reactFlowExists: !!document.querySelector('.react-flow'),
                        nodeCount: document.querySelectorAll('.react-flow__node').length,
                        edgeCount: document.querySelectorAll('.react-flow__edge').length,
                        viewportExists: !!document.querySelector('.react-flow__viewport'),
                        paneExists: !!document.querySelector('.react-flow__pane'),
                        bodyClasses: document.body.className,
                        // Check if there's an empty state message
                        emptyState: document.body.innerText.includes('Build Your Architecture')
                    })
                ''')
                print(f"Debug DOM info: {debug_info}")
            
            # Additional wait for layout animation to complete
            print(f"Waiting {layout_delay}ms for layout animation...")
            await page.wait_for_timeout(layout_delay)
            
            # Capture the diagram
            print("Capturing diagram screenshot...")
            element = page.locator('.react-flow')
            
            output_file = Path(output_path)
            output_file.parent.mkdir(parents=True, exist_ok=True)
            
            await element.screenshot(path=str(output_file))
            print(f"Screenshot saved to: {output_file.absolute()}")
            
            # Print relevant console logs
            print("\n--- Console Logs (layout related) ---")
            for log in console_logs:
                if 'layout' in log.lower() or 'lane' in log.lower() or 'Node' in log:
                    print(log)
            print("--- End Console Logs ---\n")
            
        except Exception as e:
            print(f"Error: {e}")
            await page.screenshot(path=output_path, full_page=True)
            print(f"Fallback: Full page screenshot saved to: {output_path}")
        
        finally:
            await browser.close()
        
        return output_path


async def capture_with_api(
    output_path: str = "output/generated.png",
    api_url: str = "http://localhost:8000",
    frontend_url: str = "http://localhost:3002",
    template_id: str = "STREAMING_DATA_STACK"
) -> str:
    """
    Trigger diagram generation via API, then capture screenshot.
    
    Args:
        output_path: Path to save the screenshot
        api_url: Backend API URL
        frontend_url: Frontend URL
        template_id: Template ID to generate
    
    Returns:
        Path to the saved screenshot
    """
    import httpx
    
    async with httpx.AsyncClient() as client:
        print(f"Triggering diagram generation via API for: {template_id}")
        try:
            response = await client.post(
                f"{api_url}/api/diagram/generate",
                json={"user_query": f"Generate {template_id} architecture diagram"},
                timeout=60.0
            )
            response.raise_for_status()
            print(f"API response: {response.status_code}")
        except Exception as e:
            print(f"API call failed (proceeding anyway): {e}")
    
    # Now capture the screenshot
    return await capture_diagram(output_path=output_path, url=frontend_url)


def main():
    parser = argparse.ArgumentParser(description="Capture SnowGram diagram screenshot")
    parser.add_argument(
        "--output", "-o",
        default="output/generated.png",
        help="Output path for screenshot (default: output/generated.png)"
    )
    parser.add_argument(
        "--url", "-u",
        default="http://localhost:3002",
        help="Frontend URL (default: http://localhost:3002)"
    )
    parser.add_argument(
        "--template", "-t",
        default=None,
        help="Template ID to generate (optional, triggers generation)"
    )
    parser.add_argument(
        "--api",
        action="store_true",
        help="Use API to trigger diagram generation"
    )
    parser.add_argument(
        "--api-url",
        default="http://localhost:8000",
        help="Backend API URL (default: http://localhost:8000)"
    )
    parser.add_argument(
        "--mermaid-file", "-m",
        default=None,
        help="Path to file containing Mermaid code to inject"
    )
    parser.add_argument(
        "--mermaid-code",
        default=None,
        help="Mermaid code string to inject directly"
    )
    parser.add_argument(
        "--width",
        type=int,
        default=1920,
        help="Viewport width (default: 1920)"
    )
    parser.add_argument(
        "--height",
        type=int,
        default=1080,
        help="Viewport height (default: 1080)"
    )
    
    args = parser.parse_args()
    
    # Priority: mermaid-file > mermaid-code > api > template > basic
    if args.mermaid_file:
        with open(args.mermaid_file, 'r') as f:
            mermaid_code = f.read()
        result = asyncio.run(capture_with_mermaid(
            mermaid_code=mermaid_code,
            output_path=args.output,
            frontend_url=args.url,
            viewport_width=args.width,
            viewport_height=args.height
        ))
    elif args.mermaid_code:
        result = asyncio.run(capture_with_mermaid(
            mermaid_code=args.mermaid_code,
            output_path=args.output,
            frontend_url=args.url,
            viewport_width=args.width,
            viewport_height=args.height
        ))
    elif args.api:
        result = asyncio.run(capture_with_api(
            output_path=args.output,
            api_url=args.api_url,
            frontend_url=args.url,
            template_id=args.template or "STREAMING_DATA_STACK"
        ))
    else:
        result = asyncio.run(capture_diagram(
            output_path=args.output,
            url=args.url,
            template_id=args.template,
            viewport_width=args.width,
            viewport_height=args.height
        ))
    
    print(f"Done! Screenshot at: {result}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
