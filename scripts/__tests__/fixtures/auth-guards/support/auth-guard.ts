export async function requireOwner() {
  return { ownerId: "owner-session", email: "owner@example.test" };
}

export async function requireRole(_section: string, _action: string) {
  return { email: "admin@example.test", role: "super-admin" };
}
