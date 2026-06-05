import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import env from './src/config/env.js';
import { deployOrg } from './src/services/deploymentService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const slug = process.argv[2] || 'ken-builders';
const org = JSON.parse(fs.readFileSync(path.join(__dirname, 'src/generated-orgs', `${slug}.json`), 'utf8'));

const options = {
  apiUrl: env.MENAIA_API_URL,
  expectedOrganizationId: 13,
  confirmation: '13:homeimprovement',
  credentials: { apiKey: env.MENAIA_API_KEY },
};

console.log(`Deploying ${slug} → ${options.apiUrl} (org ${options.expectedOrganizationId})\n`);
const result = await deployOrg(org, options, (step) => {
  console.log(`  [${step.status}] ${step.name}${step.detail ? ' — ' + step.detail : ''}`);
});

const media = result.actions.filter((a) => a.collection === 'item-media').length;
const logo = result.actions.filter((a) => a.collection === 'org-logo').length;
console.log(`\nsuccess=${result.success} | item-media=${media} | org-logo=${logo} | totalActions=${result.actions.length}`);
if (result.error) console.log('ERROR:', result.error);
