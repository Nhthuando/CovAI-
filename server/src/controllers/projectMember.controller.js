import { resolveProjectAccess } from '../services/projectAccess.service.js';
import { listProjectMembers, changeProjectMemberRole, removeProjectMember, leaveProject } from '../services/projectMember.service.js';
import { listProjectInvitations, createProjectInvitation, changeProjectInvitation, inspectProjectInvitation, consumeProjectInvitation } from '../services/projectInvitation.service.js';
import { pageSchema, memberChangeSchema, invitationCreateSchema, invitationTokenSchema, revisionSchema } from '../validators/projectMember.validation.js';

function parse(schema, value) {
    const result = schema.safeParse(value);
    if (!result.success) throw Object.assign(new Error('Invalid request'), { statusCode: 400, code: 'VALIDATION_ERROR', details: result.error.flatten() });
    return result.data;
}
function headerRevision(req) {
    const value = req.get('If-Match');
    if (!value || !/^"?\d+"?$/.test(value)) throw Object.assign(new Error('If-Match revision required'), { statusCode: 428, code: 'REVISION_REQUIRED' });
    return Number(value.replaceAll('"', ''));
}
const actor = req => ({ projectId: req.params.id, userId: req.user.id });
const handle = (operation, status = 200) => async (req, res) => {
    try { return res.status(status).json({ success: true, data: await operation(req) }); }
    catch (error) {
        const statusCode = error.statusCode || (error.code === 'P2002' ? 409 : 500);
        return res.status(statusCode).json({ success: false, code: statusCode === 500 ? 'INTERNAL_ERROR' : error.code,
            message: statusCode === 500 ? 'Unable to process project request' : error.message,
            ...(error.details ? { details: error.details } : {}) });
    }
};
export const access = handle(req => resolveProjectAccess({ ...actor(req), capability: 'project.read' }).then(({ project, role, capabilities }) => ({
    role, capabilities, project: { id: project.id, name: project.name, ownerId: project.ownerId, accessRevision: project.accessRevision, workspaceRevision: project.workspaceRevision },
})));
export const members = handle(req => listProjectMembers({ ...actor(req), ...parse(pageSchema, req.query) }));
export const changeMember = handle(req => changeProjectMemberRole({ ...actor(req), memberId: req.params.memberId, ...parse(memberChangeSchema, req.body) }));
export const removeMember = handle(req => removeProjectMember({ ...actor(req), memberId: req.params.memberId, expectedRevision: headerRevision(req) }));
export const leave = handle(req => leaveProject(actor(req)));
export const invitations = handle(req => listProjectInvitations({ ...actor(req), ...parse(pageSchema, req.query) }));
export const invite = handle(req => {
    const requestId = req.get('Idempotency-Key');
    if (requestId && !/^[\w-]{1,128}$/.test(requestId)) throw Object.assign(new Error('Invalid request ID'), { statusCode: 400, code: 'VALIDATION_ERROR' });
    return createProjectInvitation({ ...actor(req), ...parse(invitationCreateSchema, req.body), requestId });
}, 201);
export const resend = handle(req => changeProjectInvitation({ ...actor(req), invitationId: req.params.invitationId, ...parse(revisionSchema, req.body) }));
export const revoke = handle(req => changeProjectInvitation({ ...actor(req), invitationId: req.params.invitationId, expectedRevision: headerRevision(req), revoke: true }));
export const inspect = handle(req => inspectProjectInvitation({ userId: req.user.id, ...parse(invitationTokenSchema, req.body) }));
export const accept = handle(req => consumeProjectInvitation({ userId: req.user.id, ...parse(invitationTokenSchema, req.body) }));
export const decline = handle(req => consumeProjectInvitation({ userId: req.user.id, ...parse(invitationTokenSchema, req.body), decline: true }));
