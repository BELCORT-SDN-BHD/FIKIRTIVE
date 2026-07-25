export function runEach<T>(items: T[], callback: (item: T) => void) {
  for (const item of items) callback(item);
}
