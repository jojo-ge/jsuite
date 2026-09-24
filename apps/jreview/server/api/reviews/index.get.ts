export default defineEventHandler(async () => (await listReviews()).map(reviewMeta))
