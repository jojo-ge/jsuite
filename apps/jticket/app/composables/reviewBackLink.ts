import type { Project, Ticket } from '~/composables/useTracker'

// What a review screen should call jTicket, and where it should send you back
// to — jTicket's half of `DiffFrom` (@jsuite/diff).
//
// The review screens take the whole viewport, so /diffs is the last page that
// wears <AppHeader>: below it nothing but the screen itself can carry a link
// home. Every jTicket link that leaves for a review hands one of these over,
// and there are three of them (the project page's branch chip, <ProjectGithub>'s
// rows, a record's attachments), so the rule for what a record is called and
// where it lives lives here rather than at each site.

/** Back to a project's page, labelled with its key. */
export function projectBackLink(project: Pick<Project, 'id' | 'key'>): DiffFrom {
  return { path: `/projects/${project.id}`, label: project.key }
}

/**
 * Back to a ticket — which is a modal over a page, not a page, so `at` is the
 * full path of whichever page it is open over and `?ticket=` is the deep link
 * app.vue consumes on arrival to reopen it there. Merged into that page's own
 * query rather than replacing it: coming back to a filtered board with the
 * filter dropped is not coming back.
 */
export function ticketBackLink(ticket: Pick<Ticket, 'key'>, at: string): DiffFrom {
  const [path = '', search = ''] = at.split('#')[0]!.split('?')
  const query = new URLSearchParams(search)
  query.set('ticket', ticket.key)
  return { path: `${path}?${query.toString()}`, label: ticket.key }
}
