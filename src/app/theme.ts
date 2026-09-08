export type ColorTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "life-pivot-color-theme";

export const THEME_BOOTSTRAP_SCRIPT = `
(function () {
  var root = document.documentElement;
  var theme = null;
  try {
    theme = localStorage.getItem("${THEME_STORAGE_KEY}");
  } catch (error) {}
  if (theme !== "light" && theme !== "dark") {
    theme = typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  root.setAttribute("data-theme", theme);
  root.style.colorScheme = theme;
})();`;

export function isColorTheme(value: unknown): value is ColorTheme {
  return value === "light" || value === "dark";
}
