// Where the viewer is, in the address bar, so a reload stays put and a link can be shared:
//   /?page=settings&setting=<key>&group=<id>
// The overview is the bare address. Pages are named as the sidebar names them, not by their code ids.
export type View = "overview" | "configuration" | "compliance" | "enrollment" | "changes" | "baselines";
/** The panel open over the page. */
export type Open = { type: "setting"; key: string } | { type: "enrollment"; id: string } | null;

const PAGES: Record<string, View> = { settings: "configuration", compliance: "compliance", enrollment: "enrollment", changes: "changes", baselines: "baselines" };
const NAME_OF: Partial<Record<View, string>> = Object.fromEntries(Object.entries(PAGES).map(([name, id]) => [id, name]));

/** The page, the open panel and the group the address names; anything it doesn't name is null. */
export function readRoute(search: string): { view: View; open: Open; group: string | null; named: boolean } {
  const params = new URLSearchParams(search);
  const setting = params.get("setting");
  const enrollment = params.get("enrollment");
  return {
    view: PAGES[params.get("page") ?? ""] ?? "overview",
    open: setting ? { type: "setting", key: setting } : enrollment ? { type: "enrollment", id: enrollment } : null,
    group: params.get("group"),
    named: params.has("page") || params.has("setting") || params.has("enrollment") || params.has("group"),
  };
}

export function routeSearch({ view, open, group }: { view: View; open: Open; group: string | null }): string {
  const params = new URLSearchParams();
  const page = NAME_OF[view];
  if (page) params.set("page", page);
  if (open?.type === "setting") params.set("setting", open.key);
  if (open?.type === "enrollment") params.set("enrollment", open.id);
  if (group) params.set("group", group);
  const text = params.toString();
  return text ? "?" + text : "";
}
