import { removeBackground } from "@imgly/background-removal-node";
import fsp from "fs/promises";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import env from "../config/env.js";
import logger from "../utils/logger.js";

export async function removeItemBackground(itemPath) {
  logger.info("Removing background from item image", { itemPath });

  const start = Date.now();

  const inputBuffer = await fsp.readFile(itemPath);
  const blob = new Blob([inputBuffer], { type: "image/png" });

  const resultBlob = await removeBackground(blob, {
    output: { format: "image/png", quality: 1 },
  });

  const arrayBuffer = await resultBlob.arrayBuffer();
  const outputBuffer = Buffer.from(arrayBuffer);

  const outputFilename = `nobg-${uuidv4()}.png`;
  const outputPath = path.resolve(env.GENERATED_DIR, outputFilename);
  await fsp.writeFile(outputPath, outputBuffer);

  const elapsed = Date.now() - start;
  logger.info("Background removal complete", { outputFilename, elapsed_ms: elapsed });

  return { outputPath, outputFilename };
}
