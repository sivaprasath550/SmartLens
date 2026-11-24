import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createSession, makeTestApp } from './helpers.js';
import { EVENTS } from '../src/sockets/realtime.js';

// Smallest valid-looking JPEG payload: SOI marker + filler + EOI marker.
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1), Buffer.from([0xff, 0xd9])]);

function postFrame(api, sessionId, token, body = JPEG, type = 'image/jpeg') {
  const req = api.post(`/api/sessions/${sessionId}/frame`).set('Content-Type', type);
  if (token) req.set('X-Session-Token', token);
  return req.send(body);
}

describe('live view frames', () => {
  it('accepts a JPEG frame, relays it and serves it as the latest frame', async () => {
    const { api, realtime } = makeTestApp();
    const { sessionId, token } = await createSession(api);

    const res = await postFrame(api, sessionId, token).expect(202);
    assert.equal(res.body.data.bytes, JPEG.length);
    assert.ok(res.body.data.receivedAt);

    const event = realtime.emitted.find((e) => e.event === EVENTS.CAMERA_FRAME);
    assert.ok(event, 'camera:frame must be emitted');
    assert.equal(event.payload.sessionId, sessionId);
    assert.ok(Buffer.isBuffer(event.payload.image));
    assert.equal(event.payload.mimeType, 'image/jpeg');

    const latest = await api.get(`/api/sessions/${sessionId}/frame`).buffer(true).expect(200);
    assert.equal(latest.headers['content-type'], 'image/jpeg');
    assert.equal(latest.headers['cache-control'], 'no-store');
    assert.ok(latest.headers['x-frame-received-at']);
    assert.ok(Buffer.from(latest.body).equals(JPEG));
  });

  it('requires the session token', async () => {
    const { api } = makeTestApp();
    const { sessionId } = await createSession(api);
    await postFrame(api, sessionId, null).expect(401);
    await postFrame(api, sessionId, 'wrong').expect(403);
  });

  it('returns 404 for an unknown session', async () => {
    const { api } = makeTestApp();
    const res = await postFrame(api, 'ses_missing', 'x').expect(404);
    assert.equal(res.body.error.code, 'SESSION_NOT_FOUND');
    await api.get('/api/sessions/ses_missing/frame').expect(404);
  });

  it('rejects non-JPEG bodies and wrong content types', async () => {
    const { api } = makeTestApp();
    const { sessionId, token } = await createSession(api);
    const png = await postFrame(api, sessionId, token, Buffer.from('not a jpeg at all')).expect(415);
    assert.equal(png.body.error.code, 'UNSUPPORTED_MEDIA_TYPE');
    await postFrame(api, sessionId, token, 'hello', 'text/plain').expect(415);
  });

  it('rejects oversized frames', async () => {
    const { api } = makeTestApp();
    const { sessionId, token } = await createSession(api);
    const big = Buffer.concat([JPEG.subarray(0, 4), Buffer.alloc(600 * 1024)]);
    const res = await postFrame(api, sessionId, token, big).expect(413);
    assert.equal(res.body.error.code, 'PAYLOAD_TOO_LARGE');
  });

  it('reports no frame until one is shared, and clears it when the session stops', async () => {
    const { api } = makeTestApp();
    const { sessionId, token } = await createSession(api);
    const none = await api.get(`/api/sessions/${sessionId}/frame`).expect(404);
    assert.equal(none.body.error.code, 'FRAME_NOT_AVAILABLE');

    await postFrame(api, sessionId, token).expect(202);
    await api.post(`/api/sessions/${sessionId}/stop`).set('X-Session-Token', token).expect(200);
    await api.get(`/api/sessions/${sessionId}/frame`).expect(404);
    const res = await postFrame(api, sessionId, token).expect(409);
    assert.equal(res.body.error.code, 'SESSION_INACTIVE');
  });

  it('ignores frames that arrive after a newer one (parallel uploads)', async () => {
    const { api, realtime } = makeTestApp();
    const { sessionId, token } = await createSession(api);
    const newer = Buffer.concat([JPEG, Buffer.from([2])]);
    await postFrame(api, sessionId, token, newer).set('X-Frame-Seq', '5').expect(202);
    const late = await postFrame(api, sessionId, token).set('X-Frame-Seq', '4').expect(202);
    assert.equal(late.body.data.dropped, true);
    assert.equal(realtime.emitted.filter((e) => e.event === EVENTS.CAMERA_FRAME).length, 1);
    const latest = await api.get(`/api/sessions/${sessionId}/frame`).buffer(true).expect(200);
    assert.ok(Buffer.from(latest.body).equals(newer));
    await postFrame(api, sessionId, token).set('X-Frame-Seq', 'abc').expect(400);
  });

  it('carries the rotation the viewer must apply', async () => {
    const { api, realtime } = makeTestApp();
    const { sessionId, token } = await createSession(api);
    await postFrame(api, sessionId, token).set('X-Frame-Rotation', '90').expect(202);
    const event = realtime.emitted.find((e) => e.event === EVENTS.CAMERA_FRAME);
    assert.equal(event.payload.rotation, 90);
    const latest = await api.get(`/api/sessions/${sessionId}/frame`).expect(200);
    assert.equal(latest.headers['x-frame-rotation'], '90');
    await postFrame(api, sessionId, token).set('X-Frame-Rotation', '45').expect(400);
  });

  it('protects the latest frame with the dashboard key when configured', async () => {
    const { api } = makeTestApp({ env: { DASHBOARD_ACCESS_KEY: 'k3y' } });
    const { sessionId, token } = await createSession(api);
    await postFrame(api, sessionId, token).expect(202);
    await api.get(`/api/sessions/${sessionId}/frame`).expect(401);
    await api.get(`/api/sessions/${sessionId}/frame`).set('X-Dashboard-Key', 'k3y').expect(200);
  });
});
