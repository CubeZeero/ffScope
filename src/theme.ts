export type Theme = "dark" | "light" | "glass-dark" | "glass-light" | "obsidian-dark" | "obsidian-light" | "matrix-dark" | "matrix-light";
export type ThemeStyle = "classic" | "glass" | "obsidian" | "matrix";
export type ThemeMode = "dark" | "light";

export function composeTheme(style: ThemeStyle, mode: ThemeMode): Theme {
  return style === "classic" ? mode : `${style}-${mode}`;
}

export function parseTheme(value: string | null): Theme {
  return value === "light" || value === "glass-dark" || value === "glass-light" || value === "obsidian-dark" || value === "obsidian-light" || value === "matrix-dark" || value === "matrix-light" ? value : "dark";
}

export function isDarkTheme(theme: Theme): boolean {
  return theme === "dark" || theme.endsWith("-dark");
}

export function themeStyle(theme: Theme): ThemeStyle {
  if (theme.startsWith("glass-")) return "glass";
  if (theme.startsWith("obsidian-")) return "obsidian";
  if (theme.startsWith("matrix-")) return "matrix";
  return "classic";
}

export function toggleTheme(theme: Theme): Theme {
  switch (theme) {
    case "matrix-dark": return "matrix-light";
    case "matrix-light": return "matrix-dark";
    case "obsidian-dark": return "obsidian-light";
    case "obsidian-light": return "obsidian-dark";
    case "glass-dark": return "glass-light";
    case "glass-light": return "glass-dark";
    case "dark": return "light";
    case "light": return "dark";
  }
}
