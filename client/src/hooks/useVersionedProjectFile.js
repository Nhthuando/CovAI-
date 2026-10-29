import { useQuery } from "@tanstack/react-query";
import { useAuth } from "./useAuth";
import { getFileContentApi } from "../services/project.service";

export function useVersionedProjectFile(projectId, snapshotId, path, enabled = true) {
  const { userId } = useAuth();
  return useQuery({
    queryKey: ["versionedFile", userId, projectId, snapshotId, path],
    queryFn: async ({ signal }) => (await getFileContentApi(projectId, path, { snapshotId, signal })).data,
    enabled: !!userId && !!projectId && !!snapshotId && !!path && enabled,
    staleTime: 0, refetchOnMount: true, refetchOnWindowFocus: false,
  });
}
