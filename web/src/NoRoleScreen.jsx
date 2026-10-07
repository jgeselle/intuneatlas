
function NoRoleScreen({ session }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-50 px-4">
      <div className="w-full max-w-sm rounded-lg border border-stone-200 bg-white p-6">
        <div className="font-display text-2xl leading-none text-teal-800">IntuneAtlas</div>
        <h1 className="mt-4 text-lg font-semibold">No role assigned</h1>
        <p className="mt-1 text-sm text-stone-500">
          You're signed in as {session?.name ?? "you"}, but you don't have a role assigned in IntuneAtlas yet. Ask your
          tenant admin to assign you Viewer, Contributor, or Admin under Entra ID → Enterprise applications → this app →
          Users and groups.
        </p>
        <p className="mt-4 text-center text-xs text-stone-400">
          Wrong account? <a href="/auth/logout" className="text-stone-500 underline hover:text-stone-700">Sign out</a>
        </p>
      </div>
    </div>
  );
}

export { NoRoleScreen };
