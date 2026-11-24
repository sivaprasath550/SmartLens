import { sendSuccess } from '../utils/response.js';

export function getSimulationStatus(req, res) {
  const { demoSimulator, config } = req.app.locals.ctx;
  sendSuccess(req, res, { available: config.demoMode, ...demoSimulator.status() });
}

export async function startSimulation(req, res) {
  const { demoSimulator } = req.app.locals.ctx;
  const result = await demoSimulator.start();
  sendSuccess(
    req,
    res,
    { sessionId: result.session.sessionId, session: result.session, steps: result.steps, intervalMs: result.intervalMs, simulated: true },
    { status: 201 },
  );
}

export async function stopSimulation(req, res) {
  const { demoSimulator } = req.app.locals.ctx;
  const session = await demoSimulator.stop();
  sendSuccess(req, res, { sessionId: session?.sessionId ?? null, session, simulated: true });
}
