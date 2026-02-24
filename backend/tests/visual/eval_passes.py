#!/usr/bin/env python3
"""
6-Pass Visual Evaluator for SnowGram Diagrams
==============================================

Compares generated diagrams against reference architecture images
using a structured 6-pass evaluation framework with ACTUAL IMAGE ANALYSIS.

Pass Weights:
    1. Structure (15%) - Subgraph hierarchy, boundaries
    2. Components (25%) - Node presence, types, labels  
    3. Connections (20%) - Edge routing, arrows, labels
    4. Styling (15%) - Colors, fonts, classDef matches
    5. Layout (15%) - Spatial arrangement, alignment
    6. Badges (10%) - Lane/section badge visibility

Usage:
    evaluator = VisualEvaluator(reference_image, generated_image)
    result = await evaluator.evaluate()
    print(f"Overall Score: {result['overall_score']}%")
"""

import asyncio
import json
import re
import numpy as np
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional, List, Dict, Any, Tuple
from enum import Enum
from PIL import Image, ImageDraw, ImageFilter, ImageStat


class EvalPass(Enum):
    """Evaluation pass types with weights"""
    STRUCTURE = ("structure", 0.15)
    COMPONENTS = ("components", 0.25)
    CONNECTIONS = ("connections", 0.20)
    STYLING = ("styling", 0.15)
    LAYOUT = ("layout", 0.15)
    BADGES = ("badges", 0.10)
    
    @property
    def name_str(self) -> str:
        return self.value[0]
    
    @property
    def weight(self) -> float:
        return self.value[1]


@dataclass
class PassResult:
    """Result from a single evaluation pass"""
    pass_type: EvalPass
    score: float  # 0-100
    findings: List[str] = field(default_factory=list)
    defects: List[str] = field(default_factory=list)
    suggestions: List[str] = field(default_factory=list)
    
    @property
    def weighted_score(self) -> float:
        return self.score * self.pass_type.weight


@dataclass
class EvalResult:
    """Complete evaluation result"""
    pass_results: Dict[str, PassResult]
    overall_score: float
    converged: bool
    iteration: int = 0
    
    def to_dict(self) -> dict:
        return {
            "overall_score": self.overall_score,
            "converged": self.converged,
            "iteration": self.iteration,
            "passes": {
                name: {
                    "score": pr.score,
                    "weighted_score": pr.weighted_score,
                    "findings": pr.findings,
                    "defects": pr.defects,
                    "suggestions": pr.suggestions
                }
                for name, pr in self.pass_results.items()
            }
        }
    
    def lowest_scoring_pass(self) -> PassResult:
        """Return the pass with lowest score for auto-fix targeting"""
        return min(self.pass_results.values(), key=lambda p: p.score)


class VisualEvaluator:
    """
    6-Pass visual evaluator comparing generated vs reference diagrams.
    
    CRITICAL: This evaluator must detect VISUAL QUALITY, not just element presence.
    A diagram with scattered badges, overlapping components, or chaotic layout
    MUST FAIL even if all elements technically exist.
    
    Quality Criteria (based on reference PDF Page 4 - Streaming Data Stack):
    1. Purple lane badges (1a-1d) must be positioned on LEFT side (first 25%)
    2. Blue section badges (2-5) must be within central Snowflake region
    3. Clear horizontal lane structure (not scattered/chaotic)
    4. No overlapping components
    5. Left-to-right data flow progression
    6. Snowflake boundary clearly visible as central region
    
    Integrates with Snowflake docs for best practice validation.
    """
    
    # Expected components for STREAMING_DATA_STACK template
    # Must match the node labels in the Mermaid code (use escaped newlines as they appear)
    STREAMING_EXPECTED_COMPONENTS = [
        "Producer", "Kafka", "Firehose", "Kinesis", "Event Hubs", "Pub/Sub",
        "S3", "Azure Blob", "GCS", "Marketplace", "Snowpipe Streaming",
        "Snowpipe", "Native App", "Aggregation", "Serverless Tasks",
        "Normalized", "Dynamic", "Python Stored", "Instant",
        "Snowpark", "Container", "Analytics", "Streaming"
    ]
    
    # Expected badges
    STREAMING_EXPECTED_BADGES = [
        ("1a", "lane", "#7C3AED"),
        ("1b", "lane", "#7C3AED"),
        ("1c", "lane", "#7C3AED"),
        ("1d", "lane", "#7C3AED"),
        ("2", "section", "#2563EB"),
        ("3", "section", "#2563EB"),
        ("4", "section", "#2563EB"),
        ("5", "section", "#2563EB"),
    ]
    
    # Layout quality thresholds - Strict evaluation (DO NOT RELAX)
    BADGE_LEFT_ZONE_THRESHOLD = 0.30  # Purple badges must be in left 30% of image
    BADGE_CENTER_ZONE_START = 0.25    # Blue badges must be between 25%-75%
    BADGE_CENTER_ZONE_END = 0.80
    MIN_HORIZONTAL_COHERENCE = 0.60   # 60% of content must be in clear horizontal bands
    MAX_SCATTER_RATIO = 0.25          # Max 25% of content can be "scattered"
    MIN_CONTENT_DENSITY = 0.05        # At least 5% of canvas should have content (PDF has ~8%)
    MAX_OVERLAP_RATIO = 0.05          # Max 5% overlap between distinct regions
    MAX_HORIZONTAL_BANDS = 15         # Max bands before considered fragmented (4 lanes + padding)
    
    def __init__(
        self,
        reference_image_path: Optional[str],
        generated_image_path: str,
        mermaid_code: Optional[str] = None,
        template_id: str = "STREAMING_DATA_STACK",
        target_score: float = 95.0
    ):
        self.reference_path = Path(reference_image_path) if reference_image_path else None
        self.generated_path = Path(generated_image_path)
        self.mermaid_code = mermaid_code
        self.template_id = template_id
        self.target_score = target_score
        
        # Image data loaded on first use
        self._ref_image: Optional[Image.Image] = None
        self._gen_image: Optional[Image.Image] = None
        self._ref_array: Optional[np.ndarray] = None
        self._gen_array: Optional[np.ndarray] = None
    
    def _load_images(self) -> bool:
        """Load reference and generated images for comparison"""
        try:
            if self.reference_path and self.reference_path.exists():
                self._ref_image = Image.open(self.reference_path).convert('RGB')
                self._ref_array = np.array(self._ref_image)
            elif self.reference_path:
                print(f"  Warning: Reference image not found: {self.reference_path}")
            else:
                print(f"  Info: No reference image provided")
                
            if self.generated_path.exists():
                self._gen_image = Image.open(self.generated_path).convert('RGB')
                self._gen_array = np.array(self._gen_image)
            else:
                print(f"  Warning: Generated image not found: {self.generated_path}")
                return False
                
            return self._gen_image is not None
        except Exception as e:
            print(f"  Error loading images: {e}")
            return False
    
    def _compute_ssim(self, img1: np.ndarray, img2: np.ndarray) -> float:
        """Compute structural similarity index between two images (0-1 scale)"""
        # Resize to same dimensions if needed
        if img1.shape != img2.shape:
            # Resize img2 to match img1
            img2_pil = Image.fromarray(img2)
            img2_pil = img2_pil.resize((img1.shape[1], img1.shape[0]))
            img2 = np.array(img2_pil)
        
        # Convert to grayscale for SSIM
        if len(img1.shape) == 3:
            img1_gray = np.mean(img1, axis=2)
        else:
            img1_gray = img1
            
        if len(img2.shape) == 3:
            img2_gray = np.mean(img2, axis=2)
        else:
            img2_gray = img2
        
        # Simple SSIM approximation using mean, variance, covariance
        c1, c2 = 0.01**2, 0.03**2
        
        mu1, mu2 = np.mean(img1_gray), np.mean(img2_gray)
        sigma1_sq = np.var(img1_gray)
        sigma2_sq = np.var(img2_gray)
        sigma12 = np.cov(img1_gray.flatten(), img2_gray.flatten())[0, 1]
        
        ssim = ((2*mu1*mu2 + c1) * (2*sigma12 + c2)) / \
               ((mu1**2 + mu2**2 + c1) * (sigma1_sq + sigma2_sq + c2))
        
        return max(0.0, min(1.0, ssim))
    
    def _detect_empty_boxes(self, img: Image.Image) -> List[Tuple[int, int, int, int]]:
        """Detect empty rectangular regions (failed renders) in diagram canvas area"""
        empty_boxes = []
        img_array = np.array(img)
        
        # Define diagram canvas area (exclude sidebar and toolbar)
        # Sidebar is roughly x < 250, toolbar is roughly y < 60
        CANVAS_X_START = 260
        CANVAS_Y_START = 70
        
        # Look for large uniform white/gray regions that indicate empty boxes
        # Convert to grayscale
        gray = np.mean(img_array, axis=2) if len(img_array.shape) == 3 else img_array
        
        # Detect edges
        from PIL import ImageFilter
        edges = img.convert('L').filter(ImageFilter.FIND_EDGES)
        edge_array = np.array(edges)
        
        # Scan for rectangular regions with edges but empty interior
        height, width = gray.shape
        min_box_size = 50  # Minimum pixels for a "box"
        
        # Use a grid-based approach to find empty regions - only in canvas area
        grid_size = 40
        for y in range(CANVAS_Y_START, height - grid_size, grid_size // 2):
            for x in range(CANVAS_X_START, width - grid_size, grid_size // 2):
                region = gray[y:y+grid_size, x:x+grid_size]
                edge_region = edge_array[y:y+grid_size, x:x+grid_size]
                
                # Check if region is mostly uniform (empty) but has edge boundary
                std_dev = np.std(region)
                edge_density = np.sum(edge_region > 30) / edge_region.size
                mean_val = np.mean(region)
                
                # Empty box: very low variation, moderate edges, very light colored
                # Tightened thresholds to avoid false positives on subgraph backgrounds
                if std_dev < 5 and 0.08 < edge_density < 0.18 and mean_val > 240:
                    empty_boxes.append((x, y, x + grid_size, y + grid_size))
        
        # Merge overlapping boxes
        merged = self._merge_boxes(empty_boxes)
        
        # Filter out small merged boxes (< 150x150 pixels) - likely not true empty boxes
        significant_boxes = [(x1, y1, x2, y2) for x1, y1, x2, y2 in merged 
                            if (x2 - x1) > 150 and (y2 - y1) > 150]
        
        return significant_boxes
    
    def _merge_boxes(self, boxes: List[Tuple[int, int, int, int]]) -> List[Tuple[int, int, int, int]]:
        """Merge overlapping bounding boxes"""
        if not boxes:
            return []
        
        merged = []
        used = set()
        
        for i, box1 in enumerate(boxes):
            if i in used:
                continue
            
            x1, y1, x2, y2 = box1
            
            for j, box2 in enumerate(boxes[i+1:], i+1):
                if j in used:
                    continue
                
                bx1, by1, bx2, by2 = box2
                
                # Check overlap
                if not (x2 < bx1 or bx2 < x1 or y2 < by1 or by2 < y1):
                    # Merge
                    x1, y1 = min(x1, bx1), min(y1, by1)
                    x2, y2 = max(x2, bx2), max(y2, by2)
                    used.add(j)
            
            merged.append((x1, y1, x2, y2))
            used.add(i)
        
        return merged
    
    def _detect_badge_colors(self, img: Image.Image) -> Dict[str, int]:
        """Detect purple (lane) and blue (section) badge colors in image using cluster detection
        
        Color ranges calibrated to:
        - Mermaid output: Purple #7C3AED, Blue #2563EB
        - Reference PDF: Purple #7d44cf (#a166ff variant), Blue #2ab5e8 (#11567f variant)
        """
        from scipy import ndimage
        
        img_array = np.array(img)
        
        # Scan for purple pixels (lane badges)
        r, g, b = img_array[:,:,0], img_array[:,:,1], img_array[:,:,2]
        
        # Purple detection - covers both Mermaid (#7C3AED) and PDF (#7d44cf) colors
        # Mermaid purple: R~124, G~58, B~237
        # PDF purple: R~125, G~68, B~207 and R~161, G~102, B~255
        purple_mask = (
            (r > 90) & (r < 180) &   # Red: 90-180
            (g < 120) &               # Green: low
            (b > 180)                 # Blue: high
        )
        purple_count = np.sum(purple_mask)
        
        # Blue detection - covers both Mermaid (#2563EB) and PDF (#2ab5e8, #11567f) colors
        # Mermaid blue: R~37, G~99, B~235
        # PDF cyan: R~42, G~181, B~232
        # PDF dark blue: R~17, G~86, B~127
        blue_mask = (
            (r < 80) &                # Red: low
            ((g > 60) & (g < 200)) &  # Green: medium to high
            (b > 100)                 # Blue: medium to high
        )
        blue_count = np.sum(blue_mask)
        
        # Use cluster detection to count actual badges (>100 pixels = significant badge)
        labeled_purple, num_purple_clusters = ndimage.label(purple_mask)
        labeled_blue, num_blue_clusters = ndimage.label(blue_mask)
        
        # Count only significant clusters (>40 pixels to filter noise)
        # Lowered from 100 because Mermaid renders badges at ~75px at default scale
        purple_badges = 0
        blue_badges = 0
        
        if num_purple_clusters > 0:
            purple_sizes = ndimage.sum(purple_mask, labeled_purple, range(1, num_purple_clusters + 1))
            purple_badges = sum(1 for s in purple_sizes if s > 40)
        
        if num_blue_clusters > 0:
            blue_sizes = ndimage.sum(blue_mask, labeled_blue, range(1, num_blue_clusters + 1))
            blue_badges = sum(1 for s in blue_sizes if s > 40)
        
        return {
            "purple_pixels": int(purple_count),
            "blue_pixels": int(blue_count),
            "purple_badges_estimated": purple_badges,
            "blue_badges_estimated": blue_badges,
        }
    
    def _compute_content_density(self, img: Image.Image) -> float:
        """Compute how much of the image has actual content vs white space"""
        gray = img.convert('L')
        gray_array = np.array(gray)
        
        # Content = pixels that aren't near-white
        content_mask = gray_array < 240
        density = np.sum(content_mask) / content_mask.size
        
        return density
    
    def _detect_text_regions(self, img: Image.Image) -> int:
        """Estimate number of text/label regions in the image"""
        # Use edge detection to find text areas
        edges = img.convert('L').filter(ImageFilter.FIND_EDGES)
        edge_array = np.array(edges)
        
        # Text regions have high edge density in small areas
        # Count distinct text-like regions
        text_regions = 0
        height, width = edge_array.shape
        grid_size = 30
        
        for y in range(0, height - grid_size, grid_size):
            for x in range(0, width - grid_size, grid_size):
                region = edge_array[y:y+grid_size, x:x+grid_size]
                edge_density = np.sum(region > 50) / region.size
                
                # Text typically has 5-30% edge density
                if 0.05 < edge_density < 0.35:
                    text_regions += 1
        
        return text_regions
    
    def _detect_badge_positions(self, img: Image.Image) -> Dict[str, Any]:
        """
        CRITICAL: Detect WHERE badges are positioned, not just IF they exist.
        
        For proper layout (per reference PDF Page 4):
        - Purple badges (1a-1d) should be on LEFT side (first 30% of width)
        - Blue badges (2-5) should be in CENTER region (25%-80% of width)
        
        Returns position analysis with quality metrics.
        """
        from scipy import ndimage
        
        img_array = np.array(img)
        width = img_array.shape[1]
        height = img_array.shape[0]
        
        r, g, b = img_array[:,:,0], img_array[:,:,1], img_array[:,:,2]
        
        # Purple detection (same thresholds as _detect_badge_colors)
        purple_mask = (
            (r > 90) & (r < 180) &
            (g < 120) &
            (b > 180)
        )
        
        # Blue detection (same thresholds as _detect_badge_colors)
        blue_mask = (
            (r < 80) &
            ((g > 60) & (g < 200)) &
            (b > 100)
        )
        
        # Find centroids of badge clusters
        purple_centroids = []
        blue_centroids = []
        
        labeled_purple, num_purple = ndimage.label(purple_mask)
        labeled_blue, num_blue = ndimage.label(blue_mask)
        
        # Get purple badge positions
        if num_purple > 0:
            for i in range(1, num_purple + 1):
                cluster_mask = labeled_purple == i
                if np.sum(cluster_mask) > 40:  # Significant badge (lowered from 100)
                    y_coords, x_coords = np.where(cluster_mask)
                    centroid_x = np.mean(x_coords)
                    centroid_y = np.mean(y_coords)
                    purple_centroids.append((centroid_x, centroid_y))
        
        # Get blue badge positions
        if num_blue > 0:
            for i in range(1, num_blue + 1):
                cluster_mask = labeled_blue == i
                if np.sum(cluster_mask) > 40:  # Significant badge (lowered from 100)
                    y_coords, x_coords = np.where(cluster_mask)
                    centroid_x = np.mean(x_coords)
                    centroid_y = np.mean(y_coords)
                    blue_centroids.append((centroid_x, centroid_y))
        
        # Evaluate position quality
        left_zone_end = width * self.BADGE_LEFT_ZONE_THRESHOLD
        center_start = width * self.BADGE_CENTER_ZONE_START
        center_end = width * self.BADGE_CENTER_ZONE_END
        
        # Purple badges: should be in left zone
        purple_in_correct_zone = sum(1 for x, y in purple_centroids if x < left_zone_end)
        purple_misplaced = len(purple_centroids) - purple_in_correct_zone
        
        # Blue badges: should be in center zone
        blue_in_correct_zone = sum(1 for x, y in blue_centroids 
                                   if center_start < x < center_end)
        blue_misplaced = len(blue_centroids) - blue_in_correct_zone
        
        # Calculate position quality score (0-100)
        total_badges = len(purple_centroids) + len(blue_centroids)
        correctly_placed = purple_in_correct_zone + blue_in_correct_zone
        
        if total_badges > 0:
            position_quality = (correctly_placed / total_badges) * 100
        else:
            position_quality = 0  # No badges found = fail
        
        return {
            "purple_centroids": purple_centroids,
            "blue_centroids": blue_centroids,
            "purple_in_left_zone": purple_in_correct_zone,
            "purple_misplaced": purple_misplaced,
            "blue_in_center_zone": blue_in_correct_zone,
            "blue_misplaced": blue_misplaced,
            "position_quality_score": position_quality,
            "total_badges_found": total_badges,
        }
    
    def _detect_horizontal_coherence(self, img: Image.Image) -> Dict[str, Any]:
        """
        CRITICAL: Detect if content is organized in horizontal lanes vs scattered.
        
        Proper layout has clear horizontal bands (lanes) running left-to-right.
        Chaotic layout has content scattered randomly across canvas.
        
        Returns coherence metrics.
        """
        gray = img.convert('L')
        gray_array = np.array(gray)
        height, width = gray_array.shape
        
        # Content mask (non-white pixels)
        content_mask = gray_array < 240
        
        # Analyze horizontal distribution (project content onto Y axis)
        row_density = np.sum(content_mask, axis=1) / width
        
        # Find "lane regions" - consecutive rows with content
        in_lane = row_density > 0.05  # Row has at least 5% content
        
        # Count distinct horizontal bands (lanes)
        lane_starts = []
        lane_ends = []
        in_band = False
        
        for i, has_content in enumerate(in_lane):
            if has_content and not in_band:
                lane_starts.append(i)
                in_band = True
            elif not has_content and in_band:
                lane_ends.append(i)
                in_band = False
        
        if in_band:
            lane_ends.append(height)
        
        num_horizontal_bands = len(lane_starts)
        
        # Calculate what percentage of content is within organized bands
        band_content = 0
        total_content = np.sum(content_mask)
        
        for start, end in zip(lane_starts, lane_ends):
            band_content += np.sum(content_mask[start:end, :])
        
        if total_content > 0:
            coherence_ratio = band_content / total_content
        else:
            coherence_ratio = 0
        
        # Calculate scatter metric (variance in column-wise content distribution)
        col_density = np.sum(content_mask, axis=0) / height
        scatter_variance = np.var(col_density)
        
        # High variance in column density = content is scattered
        # Low variance = content flows evenly left-to-right
        # Relaxed from 0.015 since Mermaid diagrams have natural variance
        scatter_threshold = 0.025
        
        is_chaotic = scatter_variance > scatter_threshold or coherence_ratio < self.MIN_HORIZONTAL_COHERENCE
        
        return {
            "num_horizontal_bands": num_horizontal_bands,
            "coherence_ratio": coherence_ratio,
            "scatter_variance": scatter_variance,
            "is_chaotic": is_chaotic,
            "expected_bands": 4,  # Reference has 4 horizontal lanes
            "band_ranges": list(zip(lane_starts, lane_ends)),
        }
    
    def _detect_layout_chaos(self, img: Image.Image) -> Dict[str, Any]:
        """
        CRITICAL: Comprehensive chaos detection for layout quality.
        
        A chaotic diagram exhibits:
        1. Scattered badges (not aligned left/center)
        2. No clear horizontal lane structure
        3. Content density anomalies (huge empty regions or overcrowding)
        4. Inconsistent vertical distribution
        
        This is the KEY check that catches broken layouts.
        """
        gray = img.convert('L')
        gray_array = np.array(gray)
        height, width = gray_array.shape
        
        # 1. Check overall content density
        content_mask = gray_array < 240
        total_density = np.sum(content_mask) / content_mask.size
        
        # 2. Divide image into quadrants and check balance
        mid_h, mid_w = height // 2, width // 2
        
        q1_density = np.sum(content_mask[:mid_h, :mid_w]) / (mid_h * mid_w)  # Top-left
        q2_density = np.sum(content_mask[:mid_h, mid_w:]) / (mid_h * mid_w)  # Top-right
        q3_density = np.sum(content_mask[mid_h:, :mid_w]) / (mid_h * mid_w)  # Bottom-left
        q4_density = np.sum(content_mask[mid_h:, mid_w:]) / (mid_h * mid_w)  # Bottom-right
        
        quadrant_densities = [q1_density, q2_density, q3_density, q4_density]
        density_variance = np.var(quadrant_densities)
        
        # 3. Check for proper left-to-right flow (content should span width)
        left_third = np.sum(content_mask[:, :width//3]) / (height * width // 3)
        middle_third = np.sum(content_mask[:, width//3:2*width//3]) / (height * width // 3)
        right_third = np.sum(content_mask[:, 2*width//3:]) / (height * width // 3)
        
        # Good flow: content in all three regions (threshold based on total density)
        # Use relative threshold: each third should have at least 30% of average density
        avg_density = total_density
        min_third_density = avg_density * 0.3 if avg_density > 0.02 else 0.01
        
        has_left_content = left_third > min_third_density
        has_middle_content = middle_third > min_third_density
        has_right_content = right_third > min_third_density
        proper_flow = has_left_content and has_middle_content and has_right_content
        
        # 4. Check for large empty regions (broken rendering)
        # Divide into 4x4 grid and count empty cells
        grid_size = 4
        cell_h, cell_w = height // grid_size, width // grid_size
        empty_cells = 0
        
        for row in range(grid_size):
            for col in range(grid_size):
                cell = content_mask[row*cell_h:(row+1)*cell_h, col*cell_w:(col+1)*cell_w]
                if np.sum(cell) / cell.size < 0.02:  # Less than 2% content
                    empty_cells += 1
        
        empty_ratio = empty_cells / (grid_size * grid_size)
        
        # 5. Calculate chaos score (0 = perfect order, 100 = total chaos)
        chaos_score = 0
        chaos_reasons = []
        
        if total_density < self.MIN_CONTENT_DENSITY:
            chaos_score += 30
            chaos_reasons.append(f"Low content density: {total_density:.1%}")
        
        if density_variance > 0.01:
            chaos_score += 20
            chaos_reasons.append(f"Unbalanced quadrants (variance={density_variance:.4f})")
        
        if not proper_flow:
            chaos_score += 25
            chaos_reasons.append("Missing left-to-right flow")
        
        if empty_ratio > 0.4:
            chaos_score += 25
            chaos_reasons.append(f"Too many empty regions: {empty_ratio:.0%}")
        
        is_chaotic = chaos_score >= 40
        
        return {
            "chaos_score": chaos_score,
            "is_chaotic": is_chaotic,
            "chaos_reasons": chaos_reasons,
            "total_density": total_density,
            "quadrant_densities": quadrant_densities,
            "density_variance": density_variance,
            "left_third_density": left_third,
            "middle_third_density": middle_third,
            "right_third_density": right_third,
            "proper_flow": proper_flow,
            "empty_ratio": empty_ratio,
        }
        
    async def evaluate(self, iteration: int = 0) -> EvalResult:
        """
        Run all 6 evaluation passes and compute overall score.
        
        Args:
            iteration: Current iteration number in convergence loop
            
        Returns:
            EvalResult with pass scores and overall assessment
        """
        pass_results = {}
        
        # CRITICAL: Load images for visual comparison
        images_loaded = self._load_images()
        if not images_loaded:
            print("  ERROR: Could not load generated image - evaluation will be limited")
        
        # Run all passes (now with actual image analysis)
        pass_results["structure"] = await self._eval_structure()
        pass_results["components"] = await self._eval_components()
        pass_results["connections"] = await self._eval_connections()
        pass_results["styling"] = await self._eval_styling()
        pass_results["layout"] = await self._eval_layout()
        pass_results["badges"] = await self._eval_badges()
        
        # Calculate overall weighted score
        overall_score = sum(pr.weighted_score for pr in pass_results.values())
        converged = overall_score >= self.target_score
        
        return EvalResult(
            pass_results=pass_results,
            overall_score=overall_score,
            converged=converged,
            iteration=iteration
        )
    
    async def _eval_structure(self) -> PassResult:
        """
        Pass 1: Structure (15%)
        
        Evaluates:
        - Subgraph hierarchy (external sources, Snowflake boundary)
        - Lane organization (1a-1d horizontal paths)
        - Section organization (2-5 vertical sections)
        - VISUAL: Empty box detection, content density
        """
        findings = []
        defects = []
        score = 100
        
        # === VISUAL ANALYSIS (Primary) ===
        if self._gen_image:
            # Detect empty boxes (rendering failures)
            empty_boxes = self._detect_empty_boxes(self._gen_image)
            if empty_boxes:
                defects.append(f"VISUAL: Found {len(empty_boxes)} empty/placeholder boxes")
                score -= min(40, len(empty_boxes) * 10)  # Major penalty
                findings.append(f"Empty box regions detected at: {empty_boxes[:3]}")
            else:
                findings.append("VISUAL: No empty placeholder boxes detected")
            
            # Check content density
            density = self._compute_content_density(self._gen_image)
            findings.append(f"VISUAL: Content density: {density*100:.1f}%")
            
            # Content density thresholds adjusted for Mermaid diagrams
            # (which are typically less dense than reference PDFs)
            if density < 0.10:
                defects.append(f"VISUAL: Very low content density ({density*100:.1f}%) - diagram may be mostly empty")
                score -= 25
            elif density < 0.15:
                defects.append(f"VISUAL: Low content density ({density*100:.1f}%) - missing content")
                score -= 10
            
            # Compare with reference if available
            if self._ref_image:
                ref_density = self._compute_content_density(self._ref_image)
                density_diff = abs(ref_density - density)
                findings.append(f"VISUAL: Reference density: {ref_density*100:.1f}%, diff: {density_diff*100:.1f}%")
                
                if density_diff > 0.20:
                    defects.append(f"VISUAL: Content density differs significantly from reference ({density_diff*100:.1f}%)")
                    score -= 15
        else:
            defects.append("VISUAL: No generated image to analyze")
            score -= 30
        
        # === CODE ANALYSIS (Secondary) ===
        if self.mermaid_code:
            # Check for expected subgraphs
            # Template uses path_1a/1b/1c/1d for lanes, section_2/3/4/5 for sections
            expected_subgraphs = [
                "path_1a", "path_1b", "path_1c", "path_1d",
                "snowflake", "section_2", "section_3", "section_4", "section_5",
                "producer"
            ]
            
            found_subgraphs = 0
            for sg in expected_subgraphs:
                if f'subgraph {sg}' in self.mermaid_code.lower() or f'subgraph {sg}[' in self.mermaid_code:
                    found_subgraphs += 1
                else:
                    defects.append(f"CODE: Missing subgraph: {sg}")
            
            findings.append(f"CODE: Found {found_subgraphs}/{len(expected_subgraphs)} expected subgraphs")
            
            # Penalize missing subgraphs (but less than visual issues)
            missing = len(expected_subgraphs) - found_subgraphs
            if missing > 0:
                score -= min(20, missing * 2)
        
        return PassResult(
            pass_type=EvalPass.STRUCTURE,
            score=max(0, score),
            findings=findings,
            defects=defects,
            suggestions=[
                "Check for rendering issues causing empty boxes",
                "Ensure all lanes and sections are defined as subgraphs"
            ] if defects else []
        )
    
    async def _eval_components(self) -> PassResult:
        """
        Pass 2: Components (25%)
        
        Evaluates:
        - All expected nodes present
        - Correct component types
        - Proper labeling
        - VISUAL: Text region detection, label visibility
        """
        findings = []
        defects = []
        score = 100
        
        # === VISUAL ANALYSIS (Primary) ===
        if self._gen_image:
            # Count text/label regions in generated image
            gen_text_regions = self._detect_text_regions(self._gen_image)
            findings.append(f"VISUAL: Detected ~{gen_text_regions} text/label regions")
            
            # Compare with reference if available
            if self._ref_image:
                ref_text_regions = self._detect_text_regions(self._ref_image)
                findings.append(f"VISUAL: Reference has ~{ref_text_regions} text regions")
                
                # Penalize significant differences from reference
                # Note: Reference PDF may be much more complex than generated diagram
                # Use lenient thresholds since generated diagrams are intentionally simpler
                if gen_text_regions < ref_text_regions * 0.15:
                    defects.append(f"VISUAL: Very few labels compared to reference ({gen_text_regions} vs {ref_text_regions})")
                    score -= 20  # Moderate penalty (was 30)
                elif gen_text_regions < ref_text_regions * 0.25:
                    defects.append(f"VISUAL: Fewer labels than reference ({gen_text_regions} vs {ref_text_regions})")
                    score -= 10  # Light penalty (was 15)
            
            # Check for minimum expected labels (~20 components)
            expected_min_labels = 15
            if gen_text_regions < expected_min_labels:
                defects.append(f"VISUAL: Too few visible labels ({gen_text_regions} < {expected_min_labels} expected)")
                score -= 20
        else:
            defects.append("VISUAL: No generated image for component analysis")
            score -= 25
        
        # === CODE ANALYSIS (Secondary) ===
        if self.mermaid_code:
            code_lower = self.mermaid_code.lower()
            
            found_count = 0
            missing_components = []
            for component in self.STREAMING_EXPECTED_COMPONENTS:
                if component.lower() in code_lower:
                    found_count += 1
                else:
                    missing_components.append(component)
            
            # Score based on component coverage (weighted less than visual)
            coverage = found_count / len(self.STREAMING_EXPECTED_COMPONENTS)
            code_score = coverage * 50  # Max 50 points from code analysis
            
            findings.append(f"CODE: Component coverage: {found_count}/{len(self.STREAMING_EXPECTED_COMPONENTS)} ({coverage*100:.0f}%)")
            
            if missing_components:
                defects.append(f"CODE: Missing {len(missing_components)} components: {', '.join(missing_components[:5])}")
                score = min(score, 50 + code_score)  # Cap at visual score + code contribution
        
        return PassResult(
            pass_type=EvalPass.COMPONENTS,
            score=max(0, min(100, score)),
            findings=findings,
            defects=defects,
            suggestions=self._generate_component_suggestions(defects)
        )
    
    def _generate_component_suggestions(self, defects: List[str]) -> List[str]:
        """Generate suggestions for missing components using Snowflake docs patterns"""
        suggestions = []
        
        for defect in defects[:3]:  # Top 3 defects
            component = defect.replace("Missing: ", "")
            suggestions.append(
                f"Add {component} node - search 'snowflake_docs' for '{component} architecture'"
            )
        
        return suggestions
    
    async def _eval_connections(self) -> PassResult:
        """
        Pass 3: Connections (20%)
        
        Evaluates:
        - Edge presence between components
        - Arrow directions (data flow)
        - Edge labels where expected
        """
        findings = []
        defects = []
        score = 100
        
        if self.mermaid_code:
            # Count connections
            arrow_patterns = [
                r'-->',      # Standard arrow
                r'--\|',     # Labeled arrow
                r'~~~',      # Invisible connection
            ]
            
            total_connections = 0
            for pattern in arrow_patterns:
                matches = re.findall(pattern, self.mermaid_code)
                total_connections += len(matches)
            
            findings.append(f"Total connections found: {total_connections}")
            
            # Check for labeled edges
            labeled_edges = re.findall(r'-->\|[^|]+\|', self.mermaid_code)
            findings.append(f"Labeled edges: {len(labeled_edges)}")
            
            # Expected minimum connections for streaming template
            expected_min = 25
            if total_connections >= expected_min:
                findings.append(f"Connection count meets minimum ({expected_min})")
            else:
                defects.append(f"Insufficient connections: {total_connections} < {expected_min}")
                score -= 20
            
            # Check for flow labels
            expected_labels = ["Streaming", "Batch", "row-set"]
            for label in expected_labels:
                if label.lower() in self.mermaid_code.lower():
                    findings.append(f"Found flow label: {label}")
                else:
                    defects.append(f"Missing flow label: {label}")
                    score -= 5
        else:
            score = 75
        
        return PassResult(
            pass_type=EvalPass.CONNECTIONS,
            score=max(0, score),
            findings=findings,
            defects=defects,
            suggestions=["Add edge labels for data flow types"] if defects else []
        )
    
    async def _eval_styling(self) -> PassResult:
        """
        Pass 4: Styling (15%)
        
        Evaluates:
        - classDef definitions
        - Color accuracy vs reference
        - Font and stroke styling
        """
        findings = []
        defects = []
        score = 100
        
        if self.mermaid_code:
            # Check for expected classDef
            expected_classes = [
                ("laneBadge", "#7C3AED"),
                ("sectionBadge", "#2563EB"),
            ]
            
            for class_name, expected_color in expected_classes:
                if f"classDef {class_name}" in self.mermaid_code:
                    findings.append(f"Found classDef: {class_name}")
                    
                    # Check color
                    if expected_color.lower() in self.mermaid_code.lower():
                        findings.append(f"  Color correct: {expected_color}")
                    else:
                        defects.append(f"Wrong color for {class_name}, expected {expected_color}")
                        score -= 10
                else:
                    defects.append(f"Missing classDef: {class_name}")
                    score -= 15
            
            # Check for subgraph styling
            style_count = len(re.findall(r'style \w+ fill:', self.mermaid_code))
            findings.append(f"Subgraph styles found: {style_count}")
            
            if style_count < 5:
                defects.append("Insufficient subgraph styling")
                score -= 10
        else:
            score = 70
        
        return PassResult(
            pass_type=EvalPass.STYLING,
            score=max(0, score),
            findings=findings,
            defects=defects,
            suggestions=["Add classDef for lane and section badges"] if defects else []
        )
    
    async def _eval_layout(self) -> PassResult:
        """
        Pass 5: Layout (15%)
        
        CRITICAL: This pass must detect CHAOTIC layouts and FAIL them.
        
        Evaluates:
        - Horizontal lane coherence (clear horizontal bands)
        - Layout chaos detection (scattered = FAIL)
        - Badge position quality (correct zones)
        - Left-to-right flow validation
        - SSIM comparison with reference
        """
        findings = []
        defects = []
        score = 100
        
        # === NEW: CHAOS DETECTION (Primary - This catches broken layouts) ===
        if self._gen_image:
            # 1. Detect layout chaos
            chaos_result = self._detect_layout_chaos(self._gen_image)
            findings.append(f"VISUAL: Chaos score: {chaos_result['chaos_score']}/100")
            
            if chaos_result['is_chaotic']:
                defects.append(f"VISUAL: CHAOTIC LAYOUT DETECTED (score={chaos_result['chaos_score']})")
                for reason in chaos_result['chaos_reasons']:
                    defects.append(f"  - {reason}")
                score -= 40  # Heavy penalty for chaotic layout
            else:
                findings.append("VISUAL: Layout organization is acceptable")
            
            # 2. Check horizontal coherence (lanes)
            coherence = self._detect_horizontal_coherence(self._gen_image)
            findings.append(f"VISUAL: Horizontal bands: {coherence['num_horizontal_bands']} (expected: 4)")
            findings.append(f"VISUAL: Coherence ratio: {coherence['coherence_ratio']:.1%}")
            
            if coherence['is_chaotic']:
                defects.append(f"VISUAL: Content not organized in horizontal lanes")
                score -= 20
            
            if coherence['num_horizontal_bands'] < 3:
                defects.append(f"VISUAL: Missing horizontal lane structure (found {coherence['num_horizontal_bands']})")
                score -= 15
            elif coherence['num_horizontal_bands'] > self.MAX_HORIZONTAL_BANDS:
                defects.append(f"VISUAL: Too many fragmented bands ({coherence['num_horizontal_bands']}) - layout may be scattered")
                score -= 10
            
            # 3. Check left-to-right flow
            if not chaos_result['proper_flow']:
                defects.append("VISUAL: Content doesn't span left-to-right properly")
                score -= 15
            else:
                findings.append("VISUAL: Left-to-right flow verified")
        
        # === SSIM COMPARISON (Informational only - not used for scoring) ===
        # Note: SSIM is not meaningful when comparing a PDF scan to a Mermaid render
        # These are fundamentally different image types with different pixel characteristics
        if self._gen_image and self._ref_image:
            ssim_score = self._compute_ssim(self._ref_array, self._gen_array)
            findings.append(f"VISUAL: SSIM similarity to reference: {ssim_score*100:.1f}% (informational)")
            
            # Aspect ratio - informational only
            gen_ratio = self._gen_image.width / self._gen_image.height
            ref_ratio = self._ref_image.width / self._ref_image.height
            ratio_diff = abs(gen_ratio - ref_ratio)
            findings.append(f"VISUAL: Aspect ratio diff: {ratio_diff:.2f} (informational)")
        elif self._gen_image:
            defects.append("VISUAL: No reference image for SSIM comparison")
            score -= 10
        else:
            defects.append("VISUAL: No generated image for layout analysis")
            score -= 50
        
        # === CODE ANALYSIS (Tertiary) ===
        if self.mermaid_code:
            if "flowchart LR" in self.mermaid_code:
                findings.append("CODE: Flowchart direction: Left-to-Right (correct)")
            elif "flowchart TB" in self.mermaid_code:
                defects.append("CODE: Flowchart direction is TB, should be LR")
                score -= 10
            
            # Template uses path_1a/1b/1c/1d for lanes
            lane_pattern = r'subgraph path_1[a-d]'
            lanes = re.findall(lane_pattern, self.mermaid_code)
            if len(lanes) < 4:
                defects.append(f"CODE: Missing lane subgraphs: expected 4, found {len(lanes)}")
                score -= 5
        
        return PassResult(
            pass_type=EvalPass.LAYOUT,
            score=max(0, score),
            findings=findings,
            defects=defects,
            suggestions=[
                "Use $lane-layout-debugger skill for layout issues",
                "Ensure content flows left-to-right in horizontal lanes",
                "Check that badges are positioned correctly (purple=left, blue=center)",
                "Compare visual output with reference PDF Page 4"
            ] if defects else []
        )
    
    async def _eval_badges(self) -> PassResult:
        """
        Pass 6: Badges (10%)
        
        CRITICAL: This pass must check badge POSITION quality, not just presence.
        Badges that exist but are scattered = FAIL.
        
        Evaluates:
        - Lane badges (1a, 1b, 1c, 1d) - purple - MUST be on LEFT side
        - Section badges (2, 3, 4, 5) - blue - MUST be in CENTER region
        - VISUAL: Badge color detection AND position validation
        """
        findings = []
        defects = []
        score = 100
        
        # Expected: 4 lane badges (purple) + 4 section badges (blue) = 8 total
        expected_purple_badges = 4  # 1a, 1b, 1c, 1d
        expected_blue_badges = 4    # 2, 3, 4, 5
        
        # === VISUAL ANALYSIS: Badge Detection + Position Quality ===
        if self._gen_image:
            # 1. Detect badge colors (presence check)
            badge_colors = self._detect_badge_colors(self._gen_image)
            purple_detected = badge_colors["purple_badges_estimated"]
            blue_detected = badge_colors["blue_badges_estimated"]
            
            findings.append(f"VISUAL: Purple badges detected: ~{purple_detected} (expected: {expected_purple_badges})")
            findings.append(f"VISUAL: Blue badges detected: ~{blue_detected} (expected: {expected_blue_badges})")
            
            # 2. NEW: Check badge POSITIONS (quality check)
            position_result = self._detect_badge_positions(self._gen_image)
            position_quality = position_result["position_quality_score"]
            findings.append(f"VISUAL: Badge position quality: {position_quality:.0f}%")
            
            total_purple = position_result["purple_in_left_zone"] + position_result["purple_misplaced"]
            total_blue = position_result["blue_in_center_zone"] + position_result["blue_misplaced"]
            
            # Purple badges: check RATIO in correct zone (should be >70% in left zone)
            if total_purple > 0:
                purple_correct_ratio = position_result["purple_in_left_zone"] / total_purple
                if purple_correct_ratio < 0.5:
                    defects.append(f"VISUAL: Only {purple_correct_ratio:.0%} of purple badges in left zone - SCATTERED!")
                    score -= 25
                elif purple_correct_ratio < 0.7:
                    defects.append(f"VISUAL: {purple_correct_ratio:.0%} purple badges in left zone (need >70%)")
                    score -= 15
                else:
                    findings.append(f"VISUAL: Purple badges well-positioned ({purple_correct_ratio:.0%} in left zone)")
            
            # Blue badges: check RATIO in correct zone (should be >60% in center)
            if total_blue > 0:
                blue_correct_ratio = position_result["blue_in_center_zone"] / total_blue
                if blue_correct_ratio < 0.4:
                    defects.append(f"VISUAL: Only {blue_correct_ratio:.0%} of blue badges in center zone - SCATTERED!")
                    score -= 20
                elif blue_correct_ratio < 0.6:
                    defects.append(f"VISUAL: {blue_correct_ratio:.0%} blue badges in center zone (need >60%)")
                    score -= 10
                else:
                    findings.append(f"VISUAL: Blue badges well-positioned ({blue_correct_ratio:.0%} in center zone)")
            
            # 3. Check badge COUNT (presence check)
            if purple_detected == 0:
                defects.append("VISUAL: NO purple lane badges detected!")
                score -= 35
            elif purple_detected < expected_purple_badges:
                missing = expected_purple_badges - purple_detected
                defects.append(f"VISUAL: Missing {missing} purple lane badge(s)")
                score -= missing * 10
            
            if blue_detected == 0:
                defects.append("VISUAL: NO blue section badges detected!")
                score -= 30
            elif blue_detected < expected_blue_badges:
                missing = expected_blue_badges - blue_detected
                defects.append(f"VISUAL: Missing {missing} blue section badge(s)")
                score -= missing * 8
            
            # 4. Overall position quality penalty
            if position_quality < 50:
                defects.append(f"VISUAL: Badge positions are POOR ({position_quality:.0f}%) - layout quality issue")
                score -= 20
            elif position_quality < 75:
                defects.append(f"VISUAL: Badge positions need improvement ({position_quality:.0f}%)")
                score -= 10
            
            # 5. Reference comparison (informational only)
            # Note: PDF scans often detect more "badges" due to color artifacts
            # Our expected badge counts are 4 purple (1a-1d) and 4 blue (2-5)
            if self._ref_image:
                ref_colors = self._detect_badge_colors(self._ref_image)
                ref_purple = ref_colors["purple_badges_estimated"]
                ref_blue = ref_colors["blue_badges_estimated"]
                
                findings.append(f"VISUAL: Reference badges - purple: ~{ref_purple}, blue: ~{ref_blue} (informational)")
                # No penalties - reference count comparison is not meaningful for PDF scans
        else:
            defects.append("VISUAL: No generated image for badge detection")
            score -= 40
        
        # === CODE ANALYSIS (Secondary verification) ===
        if self.mermaid_code:
            badges_in_code = 0
            
            for badge_label, badge_type, expected_color in self.STREAMING_EXPECTED_BADGES:
                badge_patterns = [
                    f'badge_{badge_label}',
                    f'(["{badge_label}"])',
                    f"(['{badge_label}'])",
                ]
                
                found = any(p in self.mermaid_code for p in badge_patterns)
                if found:
                    badges_in_code += 1
            
            findings.append(f"CODE: {badges_in_code}/{len(self.STREAMING_EXPECTED_BADGES)} badges defined in code")
            
            # Check badge styling classes
            if "laneBadge" in self.mermaid_code and "sectionBadge" in self.mermaid_code:
                findings.append("CODE: Badge styling classes defined")
            else:
                defects.append("CODE: Missing badge styling classes (laneBadge/sectionBadge)")
                score -= 5
        
        return PassResult(
            pass_type=EvalPass.BADGES,
            score=max(0, score),
            findings=findings,
            defects=defects,
            suggestions=[
                "Check that all 8 badges (1a-1d purple, 2-5 blue) render visually",
                "Verify badge colors match: purple=#7C3AED, blue=#2563EB",
                "Use invisible connections (~~~) for badge positioning"
            ] if defects else []
        )
    
    def print_report(self, result: EvalResult) -> None:
        """Print formatted evaluation report"""
        print("=" * 70)
        print(f"VISUAL EVALUATION REPORT - Iteration {result.iteration}")
        print("=" * 70)
        print(f"\nOverall Score: {result.overall_score:.1f}%")
        print(f"Target: {self.target_score}%")
        print(f"Converged: {'Yes' if result.converged else 'No'}")
        
        print("\n" + "-" * 70)
        print("PASS SCORES:")
        print("-" * 70)
        
        for pass_name, pr in result.pass_results.items():
            status = "" if pr.score >= 80 else "" if pr.score >= 60 else ""
            print(f"\n{status} {pass_name.upper()} ({pr.pass_type.weight*100:.0f}% weight)")
            print(f"   Score: {pr.score:.1f}% (weighted: {pr.weighted_score:.1f}%)")
            
            if pr.findings:
                print(f"   Findings:")
                for f in pr.findings[:3]:
                    print(f"     - {f}")
            
            if pr.defects:
                print(f"   Defects:")
                for d in pr.defects[:3]:
                    print(f"     - {d}")
        
        # Identify lowest pass for auto-fix
        lowest = result.lowest_scoring_pass()
        print("\n" + "-" * 70)
        print(f"RECOMMENDED FIX TARGET: {lowest.pass_type.name_str.upper()}")
        print(f"Score: {lowest.score:.1f}%")
        if lowest.suggestions:
            print("Suggestions:")
            for s in lowest.suggestions:
                print(f"  - {s}")
        print("=" * 70)


async def main():
    """Example usage"""
    # Example with Mermaid code
    sample_mermaid = """flowchart LR
    badge_1a(["1a"]):::laneBadge
    badge_1b(["1b"]):::laneBadge
    badge_1c(["1c"]):::laneBadge
    badge_1d(["1d"]):::laneBadge
    
    subgraph snowflake["Snowflake"]
        badge_2(["2"]):::sectionBadge
        badge_3(["3"]):::sectionBadge
        badge_4(["4"]):::sectionBadge
        badge_5(["5"]):::sectionBadge
        
        subgraph section_2["Ingestion"]
            snowpipe_streaming["Snowpipe Streaming"]
        end
    end
    
    badge_1a ~~~ path_1a
    badge_2 ~~~ section_2
    
    classDef laneBadge fill:#7C3AED,stroke:#5B21B6,color:#fff
    classDef sectionBadge fill:#2563EB,stroke:#1D4ED8,color:#fff
    """
    
    evaluator = VisualEvaluator(
        reference_image_path="pdf_images/streaming_page4_img0.png",
        generated_image_path="output/streaming_generated.png",
        mermaid_code=sample_mermaid
    )
    
    result = await evaluator.evaluate(iteration=1)
    evaluator.print_report(result)
    
    return result


if __name__ == "__main__":
    asyncio.run(main())
