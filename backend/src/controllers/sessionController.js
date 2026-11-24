import { sendSuccess } from '../utils/response.js';

export async function createSession(req, res) {
  const { sessionService, config } = req.app.locals.ctx;
  const { session, sessionToken } = await sessionService.createSession(req.valid.body);
  sendSuccess(
    req,
    res,
    {
      sessionId: session.sessionId,
      sessionToken,
      session,
      locationUpdateIntervalSeconds: config.locationUpdateIntervalSeconds,
    },
    { status: 201, meta: { updatedAt: session.createdAt } },
  );
}

export async function stopSession(req, res) {
  const { sessionService } = req.app.locals.ctx;
  const session = await sessionService.stopSession(req.valid.params.id, req.get('x-session-token'));
  sendSuccess(req, res, { sessionId: session.sessionId, session }, { meta: { updatedAt: session.endedAt } });
}
