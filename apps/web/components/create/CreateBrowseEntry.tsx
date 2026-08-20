import "server-only";

import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth-guard";
import { getEntities, getProjects } from "@/lib/data";
import { toEntityDTO } from "@/lib/dto";
import { CreateBrowseSections } from "@/components/create/CreateBrowseSections";

/**
 * `/create` 页面下方两个区段的受控入口(W2-5)。
 *
 * 与 `NorthstarHomeEntry` 同一处约定:创作路由文件一行后端都不 import,身份只由
 * `requireOwner()` 解析,客户端传来的任何 ownerId 都不采信。
 *
 * **不 bootstrap 画布**:`/otto` 与画布路由会 `getOrCreateDefaultProject()`,那是它们各自
 * 要用的东西;逛一眼模板不该在商家的画布列表里凭空多出一张他没建过的画布 —— 那正是这一页
 * 上方那份「诚实的空」会说的第一个谎。所以这里只读已有的画布,一张都没有时把区段画成实话
 * (见 `CreateBrowseSections`)。
 */
export async function CreateBrowseEntry() {
  const owner = await requireOwner();
  if ("error" in owner) redirect("/login");
  const { ownerId } = owner;

  const [projects, entities] = await Promise.all([getProjects(ownerId), getEntities(ownerId)]);

  return (
    <CreateBrowseSections
      projectId={projects[0]?.id ?? null}
      entities={entities.map(toEntityDTO)}
    />
  );
}
