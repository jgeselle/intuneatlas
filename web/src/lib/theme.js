// Light or dark: the viewer's own choice, kept in this browser only, or
// else whatever their system is set to (and following it when it changes).
// index.html applies the same rule before the page first paints, so a dark
// page never flashes white on load.
const KEY = "intuneatlas-theme";
const query = window.matchMedia("(prefers-color-scheme: dark)");

export function themeChoice() {
  try {
    const stored = window.localStorage.getItem(KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

function apply() {
  const choice = themeChoice();
  const dark = choice === "dark" || (choice === "system" && query.matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

export function setThemeChoice(choice) {
  try {
    if (choice === "system") window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, choice);
  } catch {
    // Can't remember it (private window, blocked storage): it still applies until the page reloads.
    document.documentElement.dataset.theme = choice === "system" ? (query.matches ? "dark" : "light") : choice;
    return;
  }
  apply();
}

query.addEventListener("change", apply);
apply();
