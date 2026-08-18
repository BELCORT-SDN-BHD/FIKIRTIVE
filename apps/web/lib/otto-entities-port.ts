/**
 * makeOttoEntitiesPort — the ctx.entities port factory (W-B3-D, debt-08~10, $0).
 *
 * Wraps the SAME owner-gated element server actions the human elements UI uses (actions.ts). Owner
 * scope + fail-closed not-found guards live inside each action (requireOwner). $0 by construction.
 *
 * createEntity takes a FormData (its human caller submits a <form> with name/type/files). Otto has no
 * files, so this builds a name+type-only FormData — a genuinely NAMED element with no reference photos
 * (uploading photos stays a human file-picker action). createEntity THROWS on an auth failure; the
 * catch turns that into the same { error } contract the other actions use, so the skill never 500s.
 *
 * NOT an action surface: no "use server", not *-actions — the parity scanner must not discover it.
 */
import { createEntity, updateEntity, softDeleteEntity, softDeleteReferenceImage } from "./actions";

export function makeOttoEntitiesPort() {
  return {
    create: async (input: { name: string; type: string }): Promise<{ id: string } | { error: string }> => {
      const fd = new FormData();
      fd.set("name", input.name);
      fd.set("type", input.type);
      try {
        const res = await createEntity(fd);
        if (res && typeof res === "object" && "id" in res) return { id: (res as { id: string }).id };
        if (res && typeof res === "object" && "error" in res) return { error: (res as { error: string }).error };
        return { error: "Couldn't create that element." };
      } catch (e) {
        return { error: e instanceof Error ? e.message : "Couldn't create that element." };
      }
    },
    // beta bug 4 —— 改名与改类型走的就是人手 Library 卡片按的那一个 `updateEntity`:
    // 白名单、租户闸、在飞作业闸全在那个动作里,这里一行判断都不重做。
    update: async (
      entityId: string,
      fields: { name?: string; type?: string },
    ): Promise<{ ok: true } | { error: string }> => {
      const res = await updateEntity(entityId, fields);
      return "error" in res ? { error: res.error } : { ok: true };
    },
    remove: async (entityId: string): Promise<{ ok: true } | { error: string }> => {
      const res = await softDeleteEntity(entityId);
      return "error" in res ? { error: res.error } : { ok: true };
    },
    removeReferenceImage: async (refImageId: string): Promise<{ ok: true } | { error: string }> => {
      const res = await softDeleteReferenceImage(refImageId);
      return "error" in res ? { error: res.error } : { ok: true };
    },
  };
}
