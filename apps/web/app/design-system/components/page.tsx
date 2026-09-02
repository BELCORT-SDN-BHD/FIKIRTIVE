import { ComponentSystemReference } from "./ComponentSystemReference"

import { assertReviewFixtureRoute } from "@/lib/review-fixture-guard"
export const metadata = { title: "Component library · Fikirtive" }

export default function Page() {
  assertReviewFixtureRoute()
  return <ComponentSystemReference />
}
