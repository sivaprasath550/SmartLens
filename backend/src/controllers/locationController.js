import { sendSuccess } from '../utils/response.js';

export async function submitLocation(req, res) {
  const { sessionService } = req.app.locals.ctx;
  const { session, location } = await sessionService.recordLocation(req.valid.body, req.get('x-session-token'));
  sendSuccess(
    req,
    res,
    {
      sessionId: session.sessionId,
      latitude: location.latitude,
      longitude: location.longitude,
      accuracy: location.accuracy,
      cameraActive: location.cameraActive,
      source: location.source,
      status: session.status,
      updateCount: session.updateCount,
      receivedAt: location.receivedAt,
    },
    { status: 201, meta: { updatedAt: location.receivedAt } },
  );
}
