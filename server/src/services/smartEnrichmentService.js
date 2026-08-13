import sharp from "sharp";
import logger from "../utils/logger.js";

/**
 * Analyze image composition to determine quality and relevance
 */
async function analyzeImageComposition(imageBuffer) {
  try {
    const metadata = await sharp(imageBuffer).metadata();

    // Get histogram data for analyzing image distribution
    const stats = await sharp(imageBuffer)
      .stats()
      .then((s) => s);

    return {
      width: metadata.width,
      height: metadata.height,
      aspectRatio: metadata.width / metadata.height,
      hasAlpha: metadata.hasAlpha || false,
      dominantColor: stats.channels[0]?.mean || 0, // Average brightness
      colorVariance: stats.channels[0]?.sigma || 0, // Color variation
      isEmpty: isImageEmpty(stats),
    };
  } catch (err) {
    logger.warn("Failed to analyze image composition:", err.message);
    return null;
  }
}

/**
 * Check if image is mostly empty/blank (low color variance)
 */
function isImageEmpty(stats) {
  const avgBrightness = stats.channels[0]?.mean || 0;
  const colorVar = stats.channels[0]?.sigma || 0;
  // If very uniform color and either very bright or very dark = probably empty
  return colorVar < 20 && (avgBrightness > 240 || avgBrightness < 15);
}

/**
 * Smart image selection based on multiple factors
 */
export async function smartSelectImage(candidates) {
  if (!candidates || candidates.length === 0) return null;

  const scoredCandidates = [];

  for (const candidate of candidates) {
    let score = 0;

    // 1. Vision score (if available) - 60% weight
    const visionScore = candidate.visionScore || 5;
    score += (visionScore / 10) * 60;

    // 2. Aspect ratio preference (4:3 or 16:9 is better) - 20% weight
    const composition = candidate.composition;
    if (composition) {
      const ratio = composition.aspectRatio;
      if ((ratio >= 1.2 && ratio <= 1.4) || (ratio >= 1.7 && ratio <= 1.9)) {
        score += 20; // Perfect ratio
      } else if (ratio >= 0.8 && ratio <= 2.0) {
        score += 15; // Acceptable ratio
      } else {
        score += 5; // Not ideal but usable
      }
    }

    // 3. Image not empty - 20% weight
    if (composition && !composition.isEmpty) {
      score += 20;
    }

    scoredCandidates.push({
      ...candidate,
      smartScore: score,
    });
  }

  // Sort by smart score
  scoredCandidates.sort((a, b) => b.smartScore - a.smartScore);

  logger.info(
    "Smart image selection:",
    scoredCandidates.slice(0, 3).map((c) => ({
      domain: c.domain,
      visionScore: c.visionScore,
      smartScore: c.smartScore.toFixed(1),
    })),
  );

  return scoredCandidates[0];
}

/**
 * Detect which corner has the most empty space for logo placement
 * Returns the best corner: "top-left", "top-right", "bottom-left", "bottom-right", "bottom-center"
 */
export async function smartDetectLogoPosition(imageBuffer) {
  try {
    const metadata = await sharp(imageBuffer).metadata();
    const width = metadata.width;
    const height = metadata.height;

    // Sample size for each corner
    const sampleSize = 120;
    const positions = [
      { name: "top-left", x: 0, y: 0 },
      { name: "top-right", x: width - sampleSize, y: 0 },
      { name: "top-center", x: (width - sampleSize) / 2, y: 0 },
      { name: "bottom-left", x: 0, y: height - sampleSize },
      { name: "bottom-right", x: width - sampleSize, y: height - sampleSize },
      { name: "bottom-center", x: (width - sampleSize) / 2, y: height - sampleSize },
      { name: "middle-right", x: width - sampleSize, y: (height - sampleSize) / 2 },
    ];

    const analysis = {};

    for (const pos of positions) {
      const region = sharp(imageBuffer)
        .extract({
          left: Math.max(0, pos.x),
          top: Math.max(0, pos.y),
          width: Math.min(sampleSize, width - pos.x),
          height: Math.min(sampleSize, height - pos.y),
        });

      const stats = await region.stats();

      // Calculate emptiness (low saturation = empty/simple background)
      const r = stats.channels[0]?.mean || 0;
      const g = stats.channels[1]?.mean || 0;
      const b = stats.channels[2]?.mean || 0;

      // Saturation = how colorful the region is
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const saturation = max === 0 ? 0 : (max - min) / max;

      // Brightness
      const brightness = (r + g + b) / 3;

      // Emptiness score: high saturation variance = complex image = bad for logo
      // We want low saturation (simple backgrounds)
      const emptiness = Math.max(0, 1 - saturation);

      // Contrast score: prefer medium brightness (not too dark, not too bright)
      let contrastScore = 0;
      if (brightness >= 80 && brightness <= 200) {
        contrastScore = 1.0;
      } else if (brightness >= 40 && brightness <= 240) {
        contrastScore = 0.8;
      } else {
        contrastScore = 0.5;
      }

      const score = emptiness * 0.6 + contrastScore * 0.4;

      analysis[pos.name] = {
        emptiness: emptiness.toFixed(2),
        brightness: brightness.toFixed(0),
        saturation: saturation.toFixed(2),
        contrastScore: contrastScore.toFixed(2),
        finalScore: score.toFixed(3),
      };
    }

    // Find best position
    let bestPosition = "bottom-right"; // default fallback
    let bestScore = -1;

    for (const [pos, scores] of Object.entries(analysis)) {
      const score = parseFloat(scores.finalScore);
      if (score > bestScore) {
        bestScore = score;
        bestPosition = pos;
      }
    }

    logger.info("Smart logo position detection:", {
      bestPosition,
      bestScore: bestScore.toFixed(3),
      analysis: Object.fromEntries(
        Object.entries(analysis).map(([k, v]) => [
          k,
          { score: v.finalScore, emptiness: v.emptiness },
        ]),
      ),
    });

    return bestPosition;
  } catch (err) {
    logger.warn("Logo position detection failed, using default:", err.message);
    return "bottom-right"; // safe default
  }
}

/**
 * Smart scale detection based on image size
 */
export function smartDetectLogoScale(imageWidth) {
  // Larger images can accommodate bigger logos
  if (imageWidth >= 2000) return 0.3;
  if (imageWidth >= 1200) return 0.25;
  if (imageWidth >= 800) return 0.2;
  return 0.15;
}

/**
 * Pre-fill smart suggestions for enrichment
 */
export async function generateSmartSuggestions(
  candidates,
  imageBuffer,
  orgId,
) {
  const bestImage = await smartSelectImage(candidates);
  const logoPosition = await smartDetectLogoPosition(imageBuffer);
  const logoScale = smartDetectLogoScale(imageBuffer?.width || 1024);

  return {
    selectedImage: bestImage,
    logoPosition,
    logoScale,
    logoVariant: null, // auto-detect on server
  };
}

export default {
  smartSelectImage,
  smartDetectLogoPosition,
  smartDetectLogoScale,
  generateSmartSuggestions,
  analyzeImageComposition,
};
