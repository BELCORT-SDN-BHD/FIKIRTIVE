export function depthClientTwo(client: any) {
  return client.user.findMany();
}

export function depthNestedClientTwo(carrier: any) {
  return carrier.nested.client.user.findMany();
}
