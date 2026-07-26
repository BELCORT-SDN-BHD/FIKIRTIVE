type Database = {
  contact: {
    findMany: (args: unknown) => unknown;
  };
};

export function find(db: Database, id: string) {
  return db.contact.findMany({ where: { id } });
}

export function findA(db: Database, id: string) {
  return db.contact.findMany({ where: { id } });
}

export function findB(db: Database, id: string) {
  return db.contact.findMany({ where: { id } });
}
