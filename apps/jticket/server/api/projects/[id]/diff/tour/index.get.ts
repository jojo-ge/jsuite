// A Diff tab target's guided tour and its build state. Same target query as
// GET …/diff (?pr= / ?gh= / ?head=&base= / none).
// → TourView { key, tour, createdAt, job, failure } (app/utils/tour.ts)
export default defineEventHandler((event) =>
  tourView(tourContext(getRouterParam(event, 'id'), getQuery(event))))
