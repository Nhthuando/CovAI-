import { collaborationRequest, projectPath } from "./collaborationHttp";

export const getProjectAccessApi = (projectId, signal) => collaborationRequest(`${projectPath(projectId)}/access`, { signal });
export const listProjectMembersApi = (projectId, { cursor, signal } = {}) => collaborationRequest(`${projectPath(projectId)}/members?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, { signal });
export const updateProjectMemberApi = (projectId, memberId, { role, expectedRevision }) => collaborationRequest(`${projectPath(projectId)}/members/${encodeURIComponent(memberId)}`, { method: "PATCH", body: { role, expectedRevision } });
export const removeProjectMemberApi = (projectId, memberId, expectedRevision) => collaborationRequest(`${projectPath(projectId)}/members/${encodeURIComponent(memberId)}`, { method: "DELETE", headers: { "If-Match": String(expectedRevision) } });
export const leaveProjectApi = projectId => collaborationRequest(`${projectPath(projectId)}/leave`, { method: "POST" });
