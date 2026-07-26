export function getBoss(): Promise<{ send(name: string, data: unknown): Promise<string> }> {
  throw new Error("fixture only");
}
