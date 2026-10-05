import WorldClient from "./client";

export default async function WorldRoute({ params }: { params: Promise<{ worldId: string }> }) {
  const { worldId } = await params;
  return <WorldClient worldId={worldId} />;
}
