/**
 * Debug test to parse the actual streaming_mermaid.txt file
 * and verify Azure/Google nodes are being parsed correctly
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { convertMermaidToFlow } from '../mermaidToReactFlow';

describe('Parse Actual Streaming Mermaid File', () => {
  const mermaidPath = join(__dirname, '../../../../output/streaming_mermaid.txt');
  
  it('should parse all nodes including Azure/Google components', () => {
    const mermaidCode = readFileSync(mermaidPath, 'utf-8');
    console.log('Mermaid file length:', mermaidCode.length);
    
    // Check file contains the expected nodes
    expect(mermaidCode).toContain('event_hubs["Azure Event Hubs"]');
    expect(mermaidCode).toContain('pubsub["Google Pub/Sub"]');
    expect(mermaidCode).toContain('azure_blob["Azure Blob Storage"]');
    expect(mermaidCode).toContain('gcs["Google Cloud Storage"]');
    
    const result = convertMermaidToFlow(mermaidCode, {});
    
    console.log('\n=== PARSING RESULTS ===');
    console.log('Total nodes:', result.nodes.length);
    console.log('Total edges:', result.edges.length);
    
    const nodeIds = result.nodes.map(n => n.id);
    console.log('\nAll node IDs:');
    nodeIds.sort().forEach(id => console.log(' -', id));
    
    // Check for Azure/Google nodes
    console.log('\n=== AZURE/GOOGLE NODE CHECK ===');
    console.log('event_hubs present:', nodeIds.includes('event_hubs'));
    console.log('pubsub present:', nodeIds.includes('pubsub'));
    console.log('azure_blob present:', nodeIds.includes('azure_blob'));
    console.log('gcs present:', nodeIds.includes('gcs'));
    
    // These assertions should pass if parsing is correct
    expect(nodeIds).toContain('event_hubs');
    expect(nodeIds).toContain('pubsub');
    expect(nodeIds).toContain('azure_blob');
    expect(nodeIds).toContain('gcs');
  });
  
  it('should have edges connecting Azure/Google nodes', () => {
    const mermaidCode = readFileSync(mermaidPath, 'utf-8');
    const result = convertMermaidToFlow(mermaidCode, {});
    
    const edgeConnections = result.edges.map(e => `${e.source} -> ${e.target}`);
    console.log('\n=== EDGE CHECK FOR AZURE/GOOGLE ===');
    
    // Check edges exist for these nodes
    const azureGoogleEdges = edgeConnections.filter(e => 
      e.includes('event_hubs') || e.includes('pubsub') || 
      e.includes('azure_blob') || e.includes('gcs')
    );
    console.log('Edges involving Azure/Google:', azureGoogleEdges);
    
    expect(azureGoogleEdges.length).toBeGreaterThan(0);
  });
});
