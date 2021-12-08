import { LoaderFunction, MetaFunction, useLoaderData, useMatches } from "remix";
import invariant from "tiny-invariant";
import { Deploy, getDeploys, getProject, Project } from "../../database";

export const loader: LoaderFunction = async ({ params }) => {
  const { projectId } = params;
  invariant(projectId);
  const project = await getProject({ id: projectId });
  const deploys = await getDeploys({ projectId });
  return { project, deploys };
};

export const meta: MetaFunction = ({ params }) => {
  return {
    title: params.projectId,
  };
};

export default function Index() {
  const { projectId } = useMatches()[1].params;
  invariant(projectId);

  const { project, deploys } =
    useLoaderData<{ deploys: Deploy[]; project: Project }>();

  return (
    <main className="space-y-4 my-4">
      <table className="w-full border-collapse border-gray-200 border rounded-md">
        <tbody>
          {deploys.map((deploy) => (
            <tr key={deploy.id}>
              <td className="w-1/2 p-2 truncate">
                <a href={`/projects/${project.id}/deploys/${deploy.id}`}>
                  {project.id}
                  {deploy.branch === project.defaultBranch
                    ? null
                    : `.${deploy.branch}`}
                  .queue.run
                </a>
              </td>
              <td className="w-1/4 p-2 truncate">{deploy.status}</td>
              <td className="w-1/4 p-2 truncate">
                {deploy.updatedAt.toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
