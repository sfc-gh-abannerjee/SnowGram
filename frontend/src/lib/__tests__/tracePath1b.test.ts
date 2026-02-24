/**
 * Trace parser behavior for path_1b subgraph specifically
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('Trace path_1b Subgraph Parsing', () => {
  const mermaidPath = join(__dirname, '../../../../output/streaming_mermaid.txt');
  
  it('should trace what happens in path_1b subgraph', () => {
    const mermaidCode = readFileSync(mermaidPath, 'utf-8');
    const lines = mermaidCode.split('\n').map(l => l.trim()).filter(Boolean);
    
    // Regexes from the parser
    const subgraphStartRegex = /^subgraph\s+([\w-]+)\s*\[?"?(.+?)"?\]?$/;
    const subgraphEndRegex = /^end$/i;
    const nodeDefRegex = /^([\w-]+)\s*\[(.+)\]/;
    const edgeRegex = /^([\w-]+)\s*([-.=]+>)\s*(?:\|[^|]*\|\s*)?([\w-]+)/;
    const nodeWithClassRegex = /^([\w-]+)\s*\(\[?"?([^"\]]+)"?\]\):::(\w+)/;
    
    // Simulate parser state
    const subgraphStack: string[] = [];
    const nodesCreated = new Set<string>();
    let inPath1b = false;
    
    console.log('\n=== TRACING path_1b SUBGRAPH ===\n');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // Skip lines parser would skip
      if (line.startsWith('flowchart') || line.startsWith('graph') || 
          line.startsWith('%%') || line.startsWith('style ') || 
          line.startsWith('classDef ')) {
        continue;
      }
      
      // Check badge nodes (parser does this first)
      if (line.match(nodeWithClassRegex)) {
        continue; // Skip badge nodes
      }
      
      // Check subgraph start
      const subgraphMatch = line.match(subgraphStartRegex);
      if (subgraphMatch) {
        const subgraphId = subgraphMatch[1];
        subgraphStack.push(subgraphId);
        
        if (subgraphId === 'path_1b' || subgraphStack.includes('path_1b')) {
          console.log(`[Line ${i+1}] SUBGRAPH START: ${subgraphId}, stack=[${subgraphStack.join(', ')}]`);
          if (subgraphId === 'path_1b') inPath1b = true;
        }
        continue;
      }
      
      // Check subgraph end
      if (subgraphEndRegex.test(line)) {
        const popped = subgraphStack.pop();
        if (popped === 'path_1b') {
          console.log(`[Line ${i+1}] SUBGRAPH END: path_1b`);
          inPath1b = false;
        }
        continue;
      }
      
      // Only trace while in/near path_1b context
      const currentSubgraph = subgraphStack[subgraphStack.length - 1];
      
      // Check node definition
      const nodeMatch = line.match(nodeDefRegex);
      if (nodeMatch) {
        const nodeId = nodeMatch[1];
        nodesCreated.add(nodeId);
        
        if (currentSubgraph === 'path_1b' || inPath1b) {
          console.log(`[Line ${i+1}] NODE DEF in ${currentSubgraph}: "${nodeId}"`);
        }
        continue;
      }
      
      // Check edge
      const edgeMatch = line.match(edgeRegex);
      if (edgeMatch) {
        const source = edgeMatch[1];
        const target = edgeMatch[3];
        
        // Log if related to path_1b nodes
        if (['kinesis', 'event_hubs', 'pubsub', 'compute'].includes(source) ||
            ['kinesis', 'event_hubs', 'pubsub', 'compute'].includes(target)) {
          console.log(`[Line ${i+1}] EDGE: ${source} -> ${target}`);
        }
        continue;
      }
    }
    
    console.log('\n=== FINAL NODES CREATED ===');
    console.log('kinesis:', nodesCreated.has('kinesis'));
    console.log('event_hubs:', nodesCreated.has('event_hubs'));
    console.log('pubsub:', nodesCreated.has('pubsub'));
    console.log('compute:', nodesCreated.has('compute'));
    
    console.log('\n=== ALL path_1b-related nodes ===');
    const path1bNodes = ['kinesis', 'event_hubs', 'pubsub', 'compute'];
    for (const n of path1bNodes) {
      console.log(`  ${n}: ${nodesCreated.has(n) ? 'CREATED' : 'NOT CREATED'}`);
    }
    
    expect(nodesCreated.has('event_hubs')).toBe(true);
  });
});
