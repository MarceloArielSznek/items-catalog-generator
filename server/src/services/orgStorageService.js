import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ORGS_DIR = path.resolve(__dirname, '../generated-orgs');

function ensureDir() {
  if (!fs.existsSync(ORGS_DIR)) fs.mkdirSync(ORGS_DIR, { recursive: true });
}

function orgPath(slug) {
  return path.join(ORGS_DIR, `${slug}.json`);
}

export function listOrgs() {
  ensureDir();
  return fs
    .readdirSync(ORGS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        const raw = fs.readFileSync(path.join(ORGS_DIR, f), 'utf-8');
        const org = JSON.parse(raw);
        return {
          slug: org.slug,
          name: org.name,
          industry: org.industry,
          region: org.region,
          source: org.source,
          status: org.status,
          createdAt: org.createdAt,
          stats: org.stats,
          websiteUrl: org.websiteUrl,
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export function getOrg(slug) {
  ensureDir();
  const p = orgPath(slug);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

export function saveOrg(org) {
  ensureDir();
  fs.writeFileSync(orgPath(org.slug), JSON.stringify(org, null, 2), 'utf-8');
  return org;
}

export function updateOrg(slug, patch) {
  const existing = getOrg(slug);
  if (!existing) return null;
  const updated = { ...existing, ...patch, slug };
  saveOrg(updated);
  return updated;
}

export function deleteOrg(slug) {
  const p = orgPath(slug);
  if (!fs.existsSync(p)) return false;
  fs.unlinkSync(p);
  return true;
}

export function updateDeploymentLog(slug, result, target) {
  const succeeded = Boolean(result.success);
  return updateOrg(slug, {
    deployment: {
      ...(getOrg(slug)?.deployment || {}),
      lastDeployedAt: new Date().toISOString(),
      target,
      actor: result.actor || null,
      organizationId: result.organizationId || target?.id || null,
      actions: result.actions || [],
      log: result.log || [],
      credentials: result.credentials || [],
      userCount: (result.credentials || []).length,
      lastError: result.error || null,
    },
    status: succeeded ? 'deployed' : 'partial',
  });
}
