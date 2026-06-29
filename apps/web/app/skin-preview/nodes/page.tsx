import { notFound } from "next/navigation";
import { NodesPreview } from "./NodesPreview";

export const dynamic = "force-dynamic";
export const metadata = { title: "Node skin preview (dev)" };

/**
 * DEV-ONLY harness for the Grok-bright canvas-node re-skin. Renders the REAL
 * ImageNode/VideoNode/TextNode in a fixed-height ReactFlow with mock data, so
 * the node cards + type pills can be screenshotted (the main /skin-preview
 * canvas collapses to 0 height with an empty project). 404s in production.
 */
export default function NodesPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <NodesPreview />;
}
