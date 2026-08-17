import express from 'express';
import logger from '../utils/logger.js';
import {
  fetchOrganizations,
  fetchBranches,
  previewSimulation,
  runSimulation,
} from '../services/simulationService.js';

const router = express.Router();

/**
 * The simulation authenticates with a *user* email/password grant rather than
 * the app-wide service-account API key: no OAuth scope grants write access to
 * estimates, jobs or proposals, so a key cannot build the funnel at all.
 * Credentials arrive per request and are never persisted.
 */
function credentialsFrom(body) {
  const missing = ['apiBase', 'supabaseUrl', 'supabaseAnonKey', 'email', 'password']
    .filter((k) => !body?.[k]);
  if (missing.length) {
    const err = new Error(`Missing required fields: ${missing.join(', ')}`);
    err.status = 400;
    throw err;
  }
  return {
    apiBase: String(body.apiBase).replace(/\/$/, ''),
    supabaseUrl: String(body.supabaseUrl).replace(/\/$/, ''),
    supabaseAnonKey: body.supabaseAnonKey,
    email: body.email,
    password: body.password,
  };
}

/** Sign in and list the organizations this user belongs to. */
router.post('/connect', async (req, res) => {
  try {
    const result = await fetchOrganizations(credentialsFrom(req.body));
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(err.status || 400).json({ success: false, error: err.message });
  }
});

/** Branches (with names) inside one organization. */
router.post('/branches', async (req, res) => {
  try {
    const organizationId = Number(req.body?.organizationId);
    if (!organizationId) {
      return res.status(400).json({ success: false, error: 'organizationId is required' });
    }
    const result = await fetchBranches(credentialsFrom(req.body), organizationId);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(err.status || 400).json({ success: false, error: err.message });
  }
});

/** Who will do what, per person, before anything is written. */
router.post('/preview', async (req, res) => {
  try {
    const organizationId = Number(req.body?.organizationId);
    if (!organizationId) {
      return res.status(400).json({ success: false, error: 'organizationId is required' });
    }
    const result = await previewSimulation({
      ...credentialsFrom(req.body),
      organizationId,
      branchId: req.body?.branchId ? Number(req.body.branchId) : null,
      leads: Number(req.body?.leads) || 20,
    });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(err.status || 400).json({ success: false, error: err.message });
  }
});

/**
 * Run the simulation, streaming each step as SSE (matching the multi-industry
 * generator). `commit` defaults to false so a bare call is always a dry run.
 */
router.post('/run', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    const config = {
      ...credentialsFrom(req.body),
      organizationId: Number(req.body?.organizationId),
      branchId: req.body?.branchId ? Number(req.body.branchId) : null,
      commit: req.body?.commit === true,
      // One knob: the operator sets a lead count and the service derives the
      // rest of the funnel from its conversion rates.
      leads: Number(req.body?.leads) || 20,
    };
    if (!config.organizationId) throw new Error('organizationId is required');

    logger.info(
      `Simulation ${config.commit ? 'COMMIT' : 'dry run'} on org ${config.organizationId} @ ${config.apiBase}`,
    );
    const result = await runSimulation(config, (step) => send({ type: 'step', step }));
    send({ type: 'done', result: { success: true, ...result, commit: config.commit } });
  } catch (err) {
    logger.error(`Simulation failed: ${err.message}`);
    send({ type: 'done', result: { success: false, error: err.message } });
  } finally {
    res.end();
  }
});

export default router;
