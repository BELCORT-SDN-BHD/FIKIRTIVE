export const storage = {
  async get(_key: string) {
    return new Uint8Array();
  },
  url(key: string) {
    return `/files/${key}`;
  },
};
