import { mapRoute } from "../routes.tsx";
import { TakWorkspace } from "../tak/TakWorkspace.tsx";
import { parseViewParam } from "../tak/tools.ts";

export const MapPage = () => {
  const { tak, event, at } = mapRoute.useSearch();
  const navigate = mapRoute.useNavigate();
  return (
    <TakWorkspace
      view={parseViewParam(at)}
      selection={{ tak, event }}
      onSelect={(next) => navigate({ search: (prev) => ({ ...prev, ...next }), replace: true })}
    />
  );
};
