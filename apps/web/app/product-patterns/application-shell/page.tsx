import type { Metadata } from "next";

import { ApplicationShellReference } from "./ApplicationShellReference";

export const metadata: Metadata = {
  title: "Application shell · Fikirtive",
};

export default function Page() {
  return <ApplicationShellReference />;
}
