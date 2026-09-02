import { ChecklistReference } from "./ChecklistReference";

import { assertReviewFixtureRoute } from "@/lib/review-fixture-guard";
export const metadata = { title: "Design system checklist · Fikirtive" };

export default function Page() {
  assertReviewFixtureRoute();
  return <ChecklistReference />;
}
