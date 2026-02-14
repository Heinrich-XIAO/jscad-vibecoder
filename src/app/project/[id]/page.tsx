import ProjectPage from "./project-client";

export const dynamic = 'force-dynamic';

export default function Page({ params }: { params: { id: string } }) {
  return <ProjectPage id={params.id} />;
}