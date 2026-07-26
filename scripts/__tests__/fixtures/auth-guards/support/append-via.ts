export function appendVia(
  carrier: { list: string[] },
  value: string,
) {
  carrier.list.push(value);
}
