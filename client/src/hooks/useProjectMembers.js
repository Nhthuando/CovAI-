import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "./useAuth";
import { listProjectMembersApi, updateProjectMemberApi, removeProjectMemberApi, leaveProjectApi } from "../services/projectMember.service";
import { listProjectInvitationsApi, inviteProjectMemberApi, resendProjectInvitationApi, revokeProjectInvitationApi } from "../services/projectInvitation.service";

export function useProjectMembers(projectId, canManage) {
  const { userId } = useAuth();
  const client = useQueryClient();
  const membersKey = ["projectMembers", userId, projectId];
  const invitesKey = ["projectInvitations", userId, projectId];
  const options = { initialPageParam: undefined, getNextPageParam: page => page.nextCursor || undefined, staleTime: 0, refetchOnMount: true, refetchOnWindowFocus: true, refetchInterval: 5000 };
  const members = useInfiniteQuery({ ...options, queryKey: membersKey, queryFn: ({ pageParam, signal }) => listProjectMembersApi(projectId, { cursor: pageParam, signal }), enabled: !!userId && !!projectId });
  const invitations = useInfiniteQuery({ ...options, queryKey: invitesKey, queryFn: ({ pageParam, signal }) => listProjectInvitationsApi(projectId, { cursor: pageParam, signal }), enabled: !!userId && !!projectId && canManage });
  const refresh = () => Promise.all([
    client.invalidateQueries({ queryKey: membersKey }), client.invalidateQueries({ queryKey: invitesKey }),
    client.invalidateQueries({ queryKey: ["projectAccess", userId, projectId] }),
    client.invalidateQueries({ queryKey: ["projects"] }),
  ]);
  const mutationOptions = { onSuccess: refresh, onError: error => { if (error.status === 409) refresh(); } };
  const invite = useMutation({ mutationFn: input => inviteProjectMemberApi(projectId, input), ...mutationOptions });
  const changeRole = useMutation({ mutationFn: ({ memberId, ...input }) => updateProjectMemberApi(projectId, memberId, input), ...mutationOptions });
  const remove = useMutation({ mutationFn: row => removeProjectMemberApi(projectId, row.id, row.revision), ...mutationOptions });
  const resend = useMutation({ mutationFn: row => resendProjectInvitationApi(projectId, row.id, row.revision), ...mutationOptions });
  const revoke = useMutation({ mutationFn: row => revokeProjectInvitationApi(projectId, row.id, row.revision), ...mutationOptions });
  const leave = useMutation({ mutationFn: () => leaveProjectApi(projectId), ...mutationOptions });
  return { members, invitations, invite, changeRole, remove, resend, revoke, leave, refresh };
}
