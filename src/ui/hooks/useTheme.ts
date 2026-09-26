import { useEffect } from "react";
import type { ThemePreference } from "@/domain/types";

function resolve(theme: ThemePreference): "light" | "dark" {
  if (theme === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return theme;
}

export function useTheme(theme: ThemePreference) {
  useEffect(() => {
    const apply = () => {
      document.documentElement.setAttribute("data-theme", resolve(theme));
    };
    apply();
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);
}
