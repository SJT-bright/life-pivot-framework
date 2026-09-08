export {};

declare global {
  interface Window {
    lifePivotDesktop?: {
      moveCompanion(command:
        | { phase: "start" | "move"; screenY: number }
        | { phase: "end" }
        | { phase: "nudge"; deltaY: number }
      ): void;
      notifyReminder(reminder: {
        id: string;
        scheduledTime: string;
        title: string;
      }): void;
      openMainWindow(path?: string): void;
      rememberMainLocation(pathname: string, search?: string): void;
      setCompanionExpanded(expanded: boolean): void;
    };
  }
}
