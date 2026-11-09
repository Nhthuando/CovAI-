// Test files, rather than installed frameworks or old run results, unlock the workspace.
export const systemTestEntryState = ({ discovery, error, activeJob = false }) => {
  if (activeJob) return 'workspace';
  if (error || discovery?.error) return 'error';
  if (!discovery) return 'loading';
  const count = Number.isInteger(discovery.totalFilesCount) ? discovery.totalFilesCount : discovery.allTestFiles?.length;
  if (!Number.isInteger(count) || (count === 0 && discovery.errors?.length)) return 'error';
  return count > 0 ? 'workspace' : 'empty';
};
