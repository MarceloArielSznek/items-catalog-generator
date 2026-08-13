import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import logger from "../utils/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ORG_CONFIGS_DIR = path.resolve(__dirname, "../org-configs");

function configPath(orgId) {
  return path.join(ORG_CONFIGS_DIR, `org-${orgId}.json`);
}

export async function getOrgConfig(orgId) {
  try {
    const content = await fs.readFile(configPath(orgId), "utf-8");
    return JSON.parse(content);
  } catch (err) {
    if (err.code === "ENOENT") return { isDemoOrg: false, websiteUrl: null, websiteContext: null, updatedAt: null };
    logger.warn(`Error reading org config for ${orgId}: ${err.message}`);
    return { isDemoOrg: false, websiteUrl: null, websiteContext: null, updatedAt: null };
  }
}

export async function setOrgConfig(orgId, fields) {
  await fs.mkdir(ORG_CONFIGS_DIR, { recursive: true });
  const existing = await getOrgConfig(orgId);
  const config = {
    ...existing,
    ...fields,
    // websiteContext should be cleared when websiteUrl changes
    ...(fields.websiteUrl !== undefined && fields.websiteUrl !== existing.websiteUrl
      ? { websiteContext: null }
      : {}),
    updatedAt: new Date().toISOString(),
  };
  await fs.writeFile(configPath(orgId), JSON.stringify(config, null, 2));
  logger.info(`Org config saved: orgId=${orgId}`, { isDemoOrg: config.isDemoOrg, websiteUrl: config.websiteUrl });
  return config;
}

export async function setWebsiteContext(orgId, websiteContext) {
  await fs.mkdir(ORG_CONFIGS_DIR, { recursive: true });
  const existing = await getOrgConfig(orgId);
  const config = { ...existing, websiteContext, updatedAt: new Date().toISOString() };
  await fs.writeFile(configPath(orgId), JSON.stringify(config, null, 2));
  return config;
}
