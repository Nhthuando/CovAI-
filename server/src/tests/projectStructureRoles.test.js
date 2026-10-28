import { describe, expect, it } from "@jest/globals";
import { classifyProjectStructureRole } from "../services/projectStructureRoles.service.js";

describe("project structure roles", () => {
  it("classifies only evidence-based role paths", () => {
    expect(classifyProjectStructureRole("src/routes/user.route.js")).toMatchObject({ role: "route", confidence: "high" });
    expect(classifyProjectStructureRole("client/src/components/Button.jsx")).toMatchObject({ role: "component" });
    expect(classifyProjectStructureRole("src/ambiguous.js")).toMatchObject({ role: "unknown", confidence: "none" });
  });
});
