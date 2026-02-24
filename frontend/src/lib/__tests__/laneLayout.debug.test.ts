/**
 * Lane Layout Debug Test
 * Tests the STREAMING_DATA_STACK template parsing to identify why lane badges don't appear
 */
import { describe, it, expect } from 'vitest';
import { convertMermaidToFlow, buildSubgraphLayoutInfo, detectSubgraphLayoutType } from '../mermaidToReactFlow';

describe('Lane Layout Debug: STREAMING_DATA_STACK', () => {
  // Simplified version of streaming template for testing
  const streamingMermaid = `flowchart LR
    subgraph producer["Producer App"]
        prod_app["Producer App"]
    end
    
    subgraph path_1a["1a - Kafka Path"]
        firehose["Amazon Data Firehose"]
        kafka["Kafka"]
        kafka_connector["Snowflake Connector for Kafka"]
    end
    
    subgraph path_1b["1b - CSP Stream Processing"]
        kinesis["Amazon Kinesis"]
        compute["Compute"]
    end
    
    subgraph path_1c["1c - Batch/Files"]
        s3["Amazon S3"]
    end
    
    subgraph path_1d["1d - Native App"]
        marketplace["Snowflake Marketplace"]
    end
    
    subgraph snowflake["Snowflake"]
        subgraph section_2["2 - Ingestion"]
            snowpipe_streaming["Snowpipe Streaming"]
            snowpipe["Snowpipe"]
        end
        
        subgraph section_3["3 - Aggregation"]
            streams["Streams"]
            tasks["Tasks"]
        end
        
        subgraph section_4["4 - Tables"]
            tables["Tables"]
        end
        
        subgraph section_5["5 - Consumption"]
            analytics["Analytics"]
        end
    end
    
    prod_app --> firehose
    firehose --> kafka
    kafka --> kafka_connector
    kafka_connector --> snowpipe_streaming
    
    prod_app --> kinesis
    kinesis --> compute
    compute --> snowpipe_streaming
    
    prod_app --> s3
    s3 --> snowpipe
    
    marketplace --> snowpipe_streaming
    
    snowpipe_streaming --> streams
    snowpipe --> streams
    streams --> tasks
    tasks --> tables
    tables --> analytics
`;

  describe('Step 1: detectSubgraphLayoutType', () => {
    it('should detect path_1a as lane type with index 0', () => {
      const result = detectSubgraphLayoutType('path_1a', '1a - Kafka Path');
      expect(result.type).toBe('lane');
      expect(result.index).toBe(0);
      expect(result.badgeLabel).toBe('1A');
    });

    it('should detect path_1b as lane type with index 1', () => {
      const result = detectSubgraphLayoutType('path_1b', '1b - CSP Stream Processing');
      expect(result.type).toBe('lane');
      expect(result.index).toBe(1);
      expect(result.badgeLabel).toBe('1B');
    });

    it('should detect section_2 as section type with index 1', () => {
      const result = detectSubgraphLayoutType('section_2', '2 - Ingestion');
      expect(result.type).toBe('section');
      expect(result.index).toBe(1); // section_2 → index 1 (2-1)
      expect(result.badgeLabel).toBe('2');
    });

    it('should detect snowflake as boundary type', () => {
      const result = detectSubgraphLayoutType('snowflake', 'Snowflake');
      expect(result.type).toBe('boundary');
    });

    it('should detect producer as boundary type', () => {
      const result = detectSubgraphLayoutType('producer', 'Producer App');
      expect(result.type).toBe('boundary');
    });
  });

  describe('Step 2: Full Mermaid Parsing', () => {
    it('should parse subgraphs correctly', () => {
      const result = convertMermaidToFlow(streamingMermaid, {}, false);
      
      console.log('Subgraphs count:', result.subgraphs?.size || 0);
      
      expect(result.subgraphs).toBeDefined();
      expect(result.subgraphs!.size).toBeGreaterThan(0);
      
      // Should have at least 10 subgraphs: producer, 4 paths, snowflake, 4 sections
      expect(result.subgraphs!.size).toBeGreaterThanOrEqual(10);
    });

    it('should build layoutInfo correctly', () => {
      const result = convertMermaidToFlow(streamingMermaid, {}, false);
      
      console.log('LayoutInfo count:', result.layoutInfo?.size || 0);
      
      expect(result.layoutInfo).toBeDefined();
      expect(result.layoutInfo!.size).toBeGreaterThan(0);
      
      // Check specific entries
      const path1a = result.layoutInfo!.get('path_1a');
      expect(path1a).toBeDefined();
      expect(path1a!.type).toBe('lane');
      
      const section2 = result.layoutInfo!.get('section_2');
      expect(section2).toBeDefined();
      expect(section2!.type).toBe('section');
    });

    it('should apply layout metadata to nodes', () => {
      const result = convertMermaidToFlow(streamingMermaid, {}, false);
      
      // Count nodes with layout metadata
      const nodesWithLayoutType = result.nodes.filter(n => (n.data as any).layoutType);
      const nodesWithLane = result.nodes.filter(n => typeof (n.data as any).lane === 'number');
      const nodesWithSubgraph = result.nodes.filter(n => (n.data as any).subgraph);
      
      console.log('Nodes with layoutType:', nodesWithLayoutType.length);
      console.log('Nodes with lane:', nodesWithLane.length);
      console.log('Nodes with subgraph:', nodesWithSubgraph.length);
      console.log('Total nodes:', result.nodes.length);
      
      // Log each node's metadata for debugging
      for (const node of result.nodes) {
        const d = node.data as any;
        console.log(`  ${node.id}: subgraph=${d.subgraph || 'none'}, layoutType=${d.layoutType || 'none'}, lane=${d.lane ?? 'none'}`);
      }
      
      expect(nodesWithSubgraph.length).toBeGreaterThan(0);
      expect(nodesWithLayoutType.length).toBeGreaterThan(0);
    });

    it('CRITICAL: hasLayoutMetadata should be true', () => {
      const result = convertMermaidToFlow(streamingMermaid, {}, false);
      
      // This is the exact check from elkLayout.ts line 458-461
      const hasLayoutMetadata = result.nodes.some(n => {
        const data = n.data as any;
        return typeof data.layoutType === 'string' || typeof data.lane === 'number';
      });
      
      console.log('hasLayoutMetadata:', hasLayoutMetadata);
      
      expect(hasLayoutMetadata).toBe(true);
    });
  });
});
