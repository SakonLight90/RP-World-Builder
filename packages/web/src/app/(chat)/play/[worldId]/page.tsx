import PlayClient from "./client";

/** Dynamic-route params are a promise in Next 15. */
export default async function PlayRoute({ params }: { params: Promise<{ worldId: string }> }) {
  const { worldId } = await params;
  return <PlayClient worldId={worldId} />;
}
