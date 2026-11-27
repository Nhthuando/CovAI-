import jwt from "jsonwebtoken";

export const refreshSocketAuthToken = (socket, token) => {
  try {
    if (typeof token !== "string" || !token) return { ok: false, code: "AUTH_REQUIRED" };
    const claims = jwt.verify(token, process.env.JWT_SECRET);
    if (!claims?.userId) return { ok: false, code: "AUTH_REQUIRED" };
    socket.data ||= {};
    if (socket.data.authenticatedUserId && socket.data.authenticatedUserId !== claims.userId) {
      return { ok: false, code: "AUTH_IDENTITY_MISMATCH" };
    }
    socket.data.authenticatedUserId = claims.userId;
    socket.data.token = token;
    if (socket.handshake?.auth) socket.handshake.auth.token = token;
    return { ok: true, userId: claims.userId };
  } catch {
    return { ok: false, code: "AUTH_REQUIRED" };
  }
};

export const subscribeToUserRoom = (socket, requestedUserId) => {
  try {
    const rawToken = socket?.data?.token || socket?.handshake?.auth?.token;
    const claims = jwt.verify(rawToken, process.env.JWT_SECRET);
    if (!claims.userId || claims.userId !== requestedUserId) return false;
    socket.data ||= {};
    socket.data.authenticatedUserId = claims.userId;
    socket.join(`user:${claims.userId}`);
    return true;
  } catch {
    socket?.emit?.("auth:expired");
    return false;
  }
};
