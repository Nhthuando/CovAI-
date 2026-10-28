import { describe, expect, it, jest } from "@jest/globals";
import jwt from "jsonwebtoken";
import { subscribeToUserRoom } from "../utils/socketSubscription.js";

describe("socket user room subscription", () => {
  it("joins only the authenticated owner's room", () => {
    const previous = process.env.JWT_SECRET;
    process.env.JWT_SECRET = "socket-test-secret";
    try {
      const socket = { handshake: { auth: { token: jwt.sign({ userId: "owner" }, process.env.JWT_SECRET) } }, join: jest.fn() };
      expect(subscribeToUserRoom(socket, "someone-else")).toBe(false);
      expect(socket.join).not.toHaveBeenCalled();
      expect(subscribeToUserRoom(socket, "owner")).toBe(true);
      expect(socket.join).toHaveBeenCalledWith("user:owner");
      socket.handshake.auth.token = "invalid";
      expect(subscribeToUserRoom(socket, "owner")).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = previous;
    }
  });
});
