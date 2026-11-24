/**
 * Latest camera preview frame per session, held in process memory only.
 * Frames are never written to MongoDB or disk; each new frame replaces the
 * previous one and the entry is removed when the session ends.
 */
export function createLiveFrameStore({ maxSessions = 50 } = {}) {
  const frames = new Map();

  return {
    set(sessionId, frame) {
      frames.delete(sessionId);
      frames.set(sessionId, frame);
      while (frames.size > maxSessions) frames.delete(frames.keys().next().value);
    },
    get(sessionId) {
      return frames.get(sessionId) ?? null;
    },
    delete(sessionId) {
      return frames.delete(sessionId);
    },
    get size() {
      return frames.size;
    },
  };
}

/** JPEG files start with the SOI marker FF D8 followed by another marker byte FF. */
export function isJpeg(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
}
