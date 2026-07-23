export function ottoGreetingName(userName: string): string {
  const trimmed = userName.trim();
  if (/^[^\s@]+@[^\s@]+$/.test(trimmed)) return trimmed.slice(0, trimmed.indexOf("@"));
  return trimmed.split(/\s+/)[0] ?? "";
}
