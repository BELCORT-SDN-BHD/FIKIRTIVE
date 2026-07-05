export function getOttoNavCollapseAction(drawerOpen: boolean): "close-drawer" | "collapse-sidebar" {
  return drawerOpen ? "close-drawer" : "collapse-sidebar";
}

export function getOttoNavCollapseLabel(drawerOpen: boolean): string {
  return drawerOpen ? "Close menu" : "Collapse sidebar";
}
