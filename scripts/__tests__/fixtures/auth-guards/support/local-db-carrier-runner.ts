export function runLocalDbCarrier(
  ctx: { db: { contact: { findMany: (args: unknown) => unknown } } },
  id: string,
) {
  return ctx.db.contact.findMany({ where: { id } });
}

export function runNestedLocalDbCarrier(
  ctx: {
    nested: {
      dbAlias: { contact: { findMany: (args: unknown) => unknown } };
    };
  },
  id: string,
) {
  return ctx.nested.dbAlias.contact.findMany({ where: { id } });
}
