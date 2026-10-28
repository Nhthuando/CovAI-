import { useQuery } from "@tanstack/react-query";
import { useAuth } from "./useAuth";
import { getProjectAccessApi } from "../services/projectMember.service";

export const projectAccessKey = (userId, projectId) => ["projectAccess", userId, projectId];

export function useProjectAccess(projectId) {
  const { userId } = useAuth();
  const query = useQuery({
    queryKey: projectAccessKey(userId, projectId),
    queryFn: ({ signal }) => getProjectAccessApi(projectId, signal),
    enabled: !!userId && !!projectId,
    staleTime: 0,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    refetchInterval: 5000,
    retry: (count, error) => error.status >= 500 && count < 1,
  });
  const access = query.error ? null : query.data;
  return { ...query, access, role: access?.role, can: capability => !!access?.capabilities?.includes(capability) };
}
