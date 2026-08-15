// Shared modal state for creating/editing projects, epics, and tickets.
// State lives in useState so any page (board, projects hub, project detail) can
// open the same modals, which are rendered once globally in app.vue.
import type { Epic, Project, Ticket } from '~/composables/useTracker'

export function useTrackerModals() {
  const { deleteProject, deleteEpic, deleteTicket } = useTracker()

  const ticketModalOpen = useState('modal-ticket-open', () => false)
  const editingTicket = useState<Ticket | null>('modal-ticket-edit', () => null)
  const newTicketEpicId = useState<string | null>('modal-ticket-epic', () => null)

  const epicModalOpen = useState('modal-epic-open', () => false)
  const editingEpic = useState<Epic | null>('modal-epic-edit', () => null)
  const newEpicProjectId = useState<string | null>('modal-epic-project', () => null)

  const projectModalOpen = useState('modal-project-open', () => false)
  const editingProject = useState<Project | null>('modal-project-edit', () => null)

  // The header's one create button: a tabbed modal that can make any of the
  // four things. Editing still goes through the per-entity modals above.
  const createModalOpen = useState('modal-create-open', () => false)
  const createProjectId = useState<string | null>('modal-create-project', () => null)

  function openCreate(projectId: string | null = null) {
    createProjectId.value = projectId
    createModalOpen.value = true
  }
  function openNewTicket(epicId: string | null = null) {
    editingTicket.value = null
    newTicketEpicId.value = epicId
    ticketModalOpen.value = true
  }
  function openEditTicket(t: Ticket) {
    editingTicket.value = t
    newTicketEpicId.value = null
    ticketModalOpen.value = true
  }
  function openNewEpic(projectId: string | null = null) {
    editingEpic.value = null
    newEpicProjectId.value = projectId
    epicModalOpen.value = true
  }
  function openEditEpic(e: Epic) {
    editingEpic.value = e
    newEpicProjectId.value = null
    epicModalOpen.value = true
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
  async function onDeleteEpic(e: Epic) {
    if (confirm(`Delete ${e.key} — ${e.title}? Its tickets move to the backlog.`)) await deleteEpic(e.id)
  }
  async function onDeleteProject(p: Project) {
    if (confirm(`Delete ${p.key} — ${p.title}? Its epics become unassigned.`)) await deleteProject(p.id)
  }

  return {
    // state (bound by the global modals in app.vue)
    ticketModalOpen,
    editingTicket,
    newTicketEpicId,
    epicModalOpen,
    editingEpic,
    newEpicProjectId,
    projectModalOpen,
    editingProject,
    createModalOpen,
    createProjectId,
    // openers
    openCreate,
    openNewTicket,
    openEditTicket,
    openNewEpic,
    openEditEpic,
    openNewProject,
    openEditProject,
    // delete-with-confirm
    onDeleteTicket,
    onDeleteEpic,
    onDeleteProject,
  }
}
