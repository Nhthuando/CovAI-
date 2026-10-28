import { collaborationRequest, projectPath } from "./collaborationHttp";

export const listProjectInvitationsApi = (projectId, { cursor, signal } = {}) => collaborationRequest(`${projectPath(projectId)}/invitations?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, { signal });
export const inviteProjectMemberApi = (projectId, { email, role, requestId }) => collaborationRequest(`${projectPath(projectId)}/invitations`, { method: "POST", headers: { "Idempotency-Key": requestId }, body: { email, role } });
export const resendProjectInvitationApi = (projectId, invitationId, expectedRevision) => collaborationRequest(`${projectPath(projectId)}/invitations/${encodeURIComponent(invitationId)}/resend`, { method: "POST", body: { expectedRevision } });
export const revokeProjectInvitationApi = (projectId, invitationId, expectedRevision) => collaborationRequest(`${projectPath(projectId)}/invitations/${encodeURIComponent(invitationId)}`, { method: "DELETE", headers: { "If-Match": String(expectedRevision) } });
export const inspectInvitationApi = token => collaborationRequest("/invitations/inspect", { method: "POST", body: { token } });
export const acceptInvitationApi = token => collaborationRequest("/invitations/accept", { method: "POST", body: { token } });
export const declineInvitationApi = token => collaborationRequest("/invitations/decline", { method: "POST", body: { token } });
