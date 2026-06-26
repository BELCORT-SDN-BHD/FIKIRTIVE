/** Tally how many of the given gen jobs referenced each entity id.
 *  jobs: each job's entityIds array. Returns { entityId: count }. */
export function tallyEntityUsage(jobs: { entityIds: string[] }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const job of jobs) {
    for (const id of job.entityIds) {
      counts[id] = (counts[id] ?? 0) + 1;
    }
  }
  return counts;
}
