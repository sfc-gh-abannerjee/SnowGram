/**
 * Deep debug test to trace parser line-by-line for Azure/Google nodes
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('Deep Debug: Parser Line-by-Line', () => {
  const mermaidPath = join(__dirname, '../../../../output/streaming_mermaid.txt');
  
  it('should trace why event_hubs is not being parsed', () => {
    const mermaidCode = readFileSync(mermaidPath, 'utf-8');
    
    // Recreate the parser's line processing
    const lines = mermaidCode.split('\n').map(l => l.trim()).filter(Boolean);
    
    // Regexes from the parser
    const edgeRegex = /^([\w-]+)\s*([-.=]+>)\s*(?:\|[^|]*\|\s*)?([\w-]+)/;
    const nodeDefRegex = /^([\w-]+)\s*\[(.+)\]/;
    
    // Find lines with our target nodes
    const targetNodes = ['event_hubs', 'pubsub', 'azure_blob', 'gcs', 'kinesis', 's3'];
    
    console.log('\n=== SEARCHING FOR TARGET NODES ===\n');
    
    for (const target of targetNodes) {
      console.log(`\n--- Searching for: ${target} ---`);
      
      // Find all lines mentioning this node
      const matchingLines = lines.filter(l => l.includes(target));
      console.log(`Lines containing "${target}":`, matchingLines.length);
      
      for (const line of matchingLines) {
        console.log(`  Line: "${line}"`);
        
        // Test node definition regex
        const nodeMatch = line.match(nodeDefRegex);
        if (nodeMatch) {
          console.log(`    -> nodeDefRegex MATCH: id="${nodeMatch[1]}", label="${nodeMatch[2]}"`);
        } else {
          console.log(`    -> nodeDefRegex: NO MATCH`);
        }
        
        // Test edge regex
        const edgeMatch = line.match(edgeRegex);
        if (edgeMatch) {
          console.log(`    -> edgeRegex MATCH: source="${edgeMatch[1]}", arrow="${edgeMatch[2]}", target="${edgeMatch[3]}"`);
        } else {
          console.log(`    -> edgeRegex: NO MATCH`);
        }
      }
    }
    
    // Specifically test the node def lines
    console.log('\n=== DIRECT REGEX TESTS ===\n');
    const testLines = [
      'kinesis["Amazon Kinesis"]',
      'event_hubs["Azure Event Hubs"]',
      'pubsub["Google Pub/Sub"]',
      's3["Amazon S3"]',
      'azure_blob["Azure Blob Storage"]',
      'gcs["Google Cloud Storage"]',
    ];
    
    for (const line of testLines) {
      const match = line.match(nodeDefRegex);
      console.log(`"${line}" -> ${match ? `MATCH: id=${match[1]}` : 'NO MATCH'}`);
    }
    
    // Test edge lines
    console.log('\n=== EDGE REGEX TESTS ===\n');
    const edgeTestLines = [
      'prod_app -->|"Streaming"| kinesis',
      'prod_app -->|"Streaming"| event_hubs',
      'prod_app -->|"Batch"| s3',
      'prod_app -->|"Batch"| azure_blob',
    ];
    
    for (const line of edgeTestLines) {
      const match = line.match(edgeRegex);
      console.log(`"${line}" -> ${match ? `MATCH: ${match[1]} -> ${match[3]}` : 'NO MATCH'}`);
    }
    
    expect(true).toBe(true); // Always pass - this is for debugging
  });
});
