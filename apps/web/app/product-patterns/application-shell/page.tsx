import type { Metadata } from "next";

import { ApplicationShellReference } from "./ApplicationShellReference";

import { assertReviewFixtureRoute } from "@/lib/review-fixture-guard";
export const metadata: Metadata = {
  title: "Application shell · Fikirtive",
};

export default function Page() {
  assertReviewFixtureRoute();
  return <ApplicationShellReference />;
}
