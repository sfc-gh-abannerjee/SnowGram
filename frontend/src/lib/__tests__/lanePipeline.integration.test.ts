/**
 * Full Pipeline Integration Test for Lane Layout
 * Simulates the exact transformations in App.tsx to verify metadata preservation
 */
import { describe, it, expect } from 'vitest';
import { convertMermaidToFlow } from '../mermaidToReactFlow';
import { layoutWithLanes } from '../elkLayout';
import { Node, Edge } from 'reactflow';

describe('Lane Layout Pipeline Integration', () => {
  // Simplified STREAMING_DATA_STACK template
  const streamingMermaid = `flowchart LR
    subgraph producer["Producer App"]
        prod_app["Producer App"]
    end
    
    subgraph path_1a["1a - Kafka Path"]
        firehose["Amazon Data Firehose"]
        kafka["Kafka"]
    end
    
    subgraph path_1b["1b - CSP Stream Processing"]
        kinesis["Amazon Kinesis"]
        compute["Compute"]
    end
    
    subgraph snowflake["Snowflake"]
        subgraph section_2["2 - Ingestion"]
            snowpipe_streaming["Snowpipe Streaming"]
        end
        
        subgraph section_3["3 - Aggregation"]
            streams["Streams"]
        end
    end
    
    prod_app --> firehose
    firehose --> kafka
    kafka --> snowpipe_streaming
    
    prod_app --> kinesis
    kinesis --> compute
    compute --> snowpipe_streaming
    
    snowpipe_streaming --> streams
`;

  it('Step 1: Parse mermaid and verify metadata', () => {
    const { nodes, edges, subgraphs, layoutInfo } = convertMermaidToFlow(streamingMermaid, {}, false);
    
    console.log('\n=== STEP 1: After convertMermaidToFlow ===');
    console.log('Nodes:', nodes.length);
    console.log('Subgraphs:', subgraphs?.size);
    console.log('LayoutInfo:', layoutInfo?.size);
    
    const nodesWithMetadata = nodes.filter(n => (n.data as any).layoutType);
    console.log('Nodes with layoutType:', nodesWithMetadata.length);
    
    expect(layoutInfo?.size).toBeGreaterThan(0);
    expect(nodesWithMetadata.length).toBeGreaterThan(0);
  });

  it('Step 2: Simulate nodesWithIcons transformation (spread data)', () => {
    const { nodes: newNodes, edges, subgraphs, layoutInfo } = convertMermaidToFlow(streamingMermaid, {}, false);
    
    // Simulate the transformation in App.tsx lines 2997-3014
    const nodesWithIcons = newNodes.map((n) => ({
      ...n,
      data: {
        ...(n.data as any),
        componentType: (n.data as any)?.componentType || 'default',
        icon: 'test-icon',
        showHandles: true,
      },
    }));
    
    console.log('\n=== STEP 2: After nodesWithIcons transformation ===');
    
    // Check if metadata is preserved
    const nodesWithMetadataAfter = nodesWithIcons.filter(n => (n.data as any).layoutType);
    console.log('Nodes with layoutType:', nodesWithMetadataAfter.length);
    
    for (const node of nodesWithIcons) {
      const d = node.data as any;
      console.log(`  ${node.id}: layoutType=${d.layoutType || 'MISSING'}, lane=${d.lane ?? 'MISSING'}`);
    }
    
    expect(nodesWithMetadataAfter.length).toBe(newNodes.filter(n => (n.data as any).layoutType).length);
  });

  it('Step 3: Verify hasLayoutMetadata check before layoutWithLanes', () => {
    const { nodes: newNodes, edges, subgraphs, layoutInfo } = convertMermaidToFlow(streamingMermaid, {}, false);
    
    // Simulate nodesWithIcons
    const nodesWithIcons = newNodes.map((n) => ({
      ...n,
      data: {
        ...(n.data as any),
        componentType: (n.data as any)?.componentType || 'default',
        icon: 'test-icon',
      },
    }));
    
    // Simulate finalNodes filter (App.tsx line 3027-3031)
    const finalNodes = nodesWithIcons.filter((n) => {
      const id = n.id.toLowerCase();
      const compType = ((n.data as any)?.componentType || '').toString().toLowerCase();
      return !(id.startsWith('account_boundary_') && compType.startsWith('account_boundary_'));
    });
    
    console.log('\n=== STEP 3: finalNodes before layoutWithLanes ===');
    console.log('finalNodes count:', finalNodes.length);
    
    // This is the exact check from elkLayout.ts line 458-461
    const hasLayoutMetadata = finalNodes.some(n => {
      const data = n.data as any;
      return typeof data.layoutType === 'string' || typeof data.lane === 'number';
    });
    
    console.log('hasLayoutMetadata:', hasLayoutMetadata);
    
    for (const node of finalNodes) {
      const d = node.data as any;
      console.log(`  ${node.id}: layoutType=${d.layoutType || 'MISSING'}, lane=${d.lane ?? 'MISSING'}, subgraph=${d.subgraph || 'MISSING'}`);
    }
    
    expect(hasLayoutMetadata).toBe(true);
  });

  it('Step 4: Call layoutWithLanes and verify usedLaneLayout', () => {
    const { nodes: newNodes, edges, subgraphs, layoutInfo } = convertMermaidToFlow(streamingMermaid, {}, false);
    
    // Simulate the full transformation pipeline
    const nodesWithIcons = newNodes.map((n) => ({
      ...n,
      data: {
        ...(n.data as any),
        componentType: (n.data as any)?.componentType || 'default',
        icon: 'test-icon',
      },
    })) as Node[];
    
    const finalNodes = nodesWithIcons.filter((n) => {
      const id = n.id.toLowerCase();
      const compType = ((n.data as any)?.componentType || '').toString().toLowerCase();
      return !(id.startsWith('account_boundary_') && compType.startsWith('account_boundary_'));
    });
    
    console.log('\n=== STEP 4: Calling layoutWithLanes ===');
    console.log('finalNodes:', finalNodes.length);
    console.log('layoutInfo size:', layoutInfo?.size);
    
    // Call layoutWithLanes exactly as App.tsx does
    const result = layoutWithLanes(finalNodes, edges, subgraphs, layoutInfo);
    
    console.log('usedLaneLayout:', result.usedLaneLayout);
    console.log('Result nodes:', result.nodes.length);
    
    // Check for badge nodes (lane_label_*, section_label_*)
    const badgeNodes = result.nodes.filter(n => 
      n.id.startsWith('lane_label_') || n.id.startsWith('section_label_')
    );
    console.log('Badge nodes created:', badgeNodes.length);
    
    for (const badge of badgeNodes) {
      console.log(`  Badge: ${badge.id} at (${badge.position.x}, ${badge.position.y})`);
    }
    
    expect(result.usedLaneLayout).toBe(true);
    expect(badgeNodes.length).toBeGreaterThan(0);
  });
});
