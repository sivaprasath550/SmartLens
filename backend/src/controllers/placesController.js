import { sendSuccess } from '../utils/response.js';

/**
 * Nearby search for POST (JSON body) and GET (query string). When a
 * `sessionId` is supplied with a valid X-Session-Token, the result is also
 * stored as that session's latest snapshot and pushed to dashboards.
 */
export async function findNearby(req, res) {
  const { placesService, sessionService } = req.app.locals.ctx;
  const params = req.method === 'GET' ? req.valid.query : req.valid.body;

  // Authorise before calling the (possibly billed) external API.
  if (params.sessionId) await sessionService.authorize(params.sessionId, req.get('x-session-token'));

  const result = await placesService.findNearby(params);
  if (params.sessionId) await sessionService.attachPlaces(params.sessionId, result);

  sendSuccess(
    req,
    res,
    {
      center: result.center,
      radius: result.radius,
      category: result.category,
      count: result.places.length,
      places: result.places,
      source: result.source,
      simulated: result.simulated,
      attribution: result.attribution,
      sessionId: params.sessionId ?? null,
    },
    { meta: { updatedAt: result.fetchedAt, cached: result.cached, placesSource: result.source } },
  );
}
