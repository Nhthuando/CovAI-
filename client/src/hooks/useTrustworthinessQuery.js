import { useQuery } from '@tanstack/react-query';
import { useAuth } from './useAuth';
import { evaluationRequest } from '../services/trustworthiness.service';

export const evaluationKey = (userId, projectId) => ['trustworthiness', userId, projectId];
export const isEvaluationActive = status => ['QUEUED', 'RUNNING', 'PROCESSING'].includes(status);
export function useTrustworthinessQuery(projectId, suffix = '', { enabled = true, poll = false } = {}) {
  const { userId } = useAuth();
  return useQuery({ queryKey: [...evaluationKey(userId, projectId), suffix], queryFn: ({ signal }) => evaluationRequest(projectId, suffix, { signal }), enabled: !!projectId && !!userId && enabled,
    staleTime: 0, refetchOnMount: true, refetchOnReconnect: true, refetchOnWindowFocus: false,
    refetchInterval: poll ? query => {
      const data = query.state.data;
      return isEvaluationActive(data?.executionStatus || data?.status) || data?.runs?.some(r => isEvaluationActive(r.executionStatus)) || data?.sources?.some(s => s.status === 'PROCESSING') ? 2000 : false;
    } : false,
    retry: (count, error) => error.status >= 500 && error.code !== 'FEATURE_DISABLED' && count < 1,
  });
}
