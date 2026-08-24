// Cutting (or linking to) a project's integration branch.
//
// Two places do this — the button in the project header and the GitHub panel
// below it — and each has to see the other's result, so the action and the
// "reload the panel" signal live here rather than in either component.
export function useIntegrationBranch() {
  const toast = useToast()
  const { refresh: refreshTracker } = useTracker()

  // Id of the project whose branch is being cut right now ('' = none), so both
  // buttons can show the spinner on the same action.
  const creating = useState<string>('jticket-branch-creating', () => '')
  // Bumped whenever a branch is cut, adopted or unset. <ProjectGithub> watches
  // it and refetches — the header can change the branch without knowing the
  // panel exists.
  const revision = useState<number>('jticket-github-revision', () => 0)

  function invalidate() {
    revision.value++
  }

  /** POST the integration-branch endpoint; toasts either way. Returns true on success. */
  async function createBranch(projectId: string, branch?: string): Promise<boolean> {
    creating.value = projectId
    try {
      const res = await $fetch<{ branch: string; base: string; created: boolean }>(
        `/api/projects/${projectId}/integration-branch`,
        { method: 'POST', body: { branch: branch?.trim() || undefined } },
      )
      toast.add({
        title: res.created ? `Cut ${res.branch}` : `Adopted ${res.branch}`,
        description: res.created
          ? `Empty branch off ${res.base}, pushed to origin.`
          : 'The branch already existed — it is now this project’s.',
        color: 'success',
        icon: 'i-lucide-git-branch',
      })
      // The branch name now lives on the project, so the board's copy is stale.
      await refreshTracker()
      invalidate()
      return true
    } catch (err: any) {
      toast.add({
        title: 'Could not create the integration branch',
        description: branchErrorText(err),
        color: 'error',
        icon: 'i-lucide-triangle-alert',
      })
      return false
    } finally {
      creating.value = ''
    }
  }

  return { creating, revision, invalidate, createBranch }
}

/** jDiff's branch-review page for a repo path (as stored — '~' is expanded by jDiff). */
export function jdiffBranchLink(base: string, repo: string, branch: string, baseBranch?: string): string {
  const baseParam = baseBranch ? `&base=${encodeURIComponent(baseBranch)}` : ''
  return `${base.replace(/\/+$/, '')}/branch?repo=${encodeURIComponent(repo)}&branch=${encodeURIComponent(branch)}${baseParam}`
}

export function branchErrorText(err: any): string {
  return String(err?.data?.statusMessage ?? err?.data?.message ?? err?.statusMessage ?? err?.message ?? err)
}
