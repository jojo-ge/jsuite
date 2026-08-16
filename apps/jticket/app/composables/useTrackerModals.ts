// Shared modal state for creating/editing projects and tickets.
// State lives in useState so any page (board, projects hub, project detail) can
// open the same modals, which are rendered once globally in app.vue.
import type { Project, Ticket } from '~/composables/useTracker'

export function useTrackerModals() {
  const { deleteProject, deleteTicket } = useTracker()

  const ticketModalOpen = useState('modal-ticket-open', () => false)
  const editingTicket = useState<Ticket | null>('modal-ticket-edit', () => null)
  const newTicketProjectId = useState<string | null>('modal-ticket-project', () => null)

  const projectModalOpen = useState('modal-project-open', () => false)
  const editingProject = useState<Project | null>('modal-project-edit', () => null)

  // The header's one create button: a tabbed modal that can make any of the
  // three things. Editing still goes through the per-entity modals above.
  const createModalOpen = useState('modal-create-open', () => false)
  const createProjectId = useState<string | null>('modal-create-project', () => null)

  function openCreate(projectId: string | null = null) {
    createProjectId.value = projectId
    createModalOpen.value = true
  }
  function openNewTicket(projectId: string | null = null) {
    editingTicket.value = null
    newTicketProjectId.value = projectId
    ticketModalOpen.value = true
  }
  function openEditTicket(t: Ticket) {
    editingTicket.value = t
    newTicketProjectId.value = null
    ticketModalOpen.value = true
  }
  function openNewProject() {
    editingProject.value = null
    projectModalOpen.value = true
  }
  function openEditProject(p: Project) {
    editingProject.value = p
    projectModalOpen.value = true
  }

  async function onDeleteTicket(t: Ticket) {
    if (confirm(`Delete ${t.key} — ${t.title}?`)) await deleteTicket(t.id)
  }
  async function onDeleteProject(p: Project) {
    if (confirm(`Delete ${p.key} — ${p.title}? Its tickets move to the backlog.`)) await deleteProject(p.id)
  }

  return {
    // state (bound by the global modals in app.vue)
    ticketModalOpen,
    editingTicket,
    newTicketProjectId,
    projectModalOpen,
    editingProject,
    createModalOpen,
    createProjectId,
    // openers
    openCreate,
    openNewTicket,
    openEditTicket,
    openNewProject,
    openEditProject,
    // delete-with-confirm
    onDeleteTicket,
    onDeleteProject,
  }
}
