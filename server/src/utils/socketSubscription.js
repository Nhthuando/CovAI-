import jwt from "jsonwebtoken";

export const subscribeToUserRoom = (socket, requestedUserId) => {
  try {
    const claims = jwt.verify(socket.handshake.auth?.token, process.env.JWT_SECRET);
    if (!claims.userId || claims.userId !== requestedUserId) return false;
    socket.join(`user:${claims.userId}`);
    return true;
  } catch {
    return false;
  }
};
