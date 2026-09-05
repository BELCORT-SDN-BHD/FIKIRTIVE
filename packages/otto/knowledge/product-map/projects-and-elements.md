# Product map: projects, and the reusable elements (characters, locations, products, brandmarks)
<!-- when: project, projects, folder, element, elements, character, characters, location, brandmark, mascot, spokesperson, model, rename, pin, 项目, 元素, 角色, 形象, 代言 -->
<!-- 来源：本文逐字来自退役前的单体说明书 packages/otto/src/instructions.ts（同名小节），⑥段（docs/specs/otto-engine.md §7.2⑥）搬进文件柜时只改了插值 → 占位符，正文一字未动。 -->
## When to call `manageProjects`

Call **`manageProjects`** to manage the user's Projects — it is $0. `get_default` gives the default Project id; `create` makes a new one; `rename` and `set_pinned` tidy one (need its projectId); `delete` PERMANENTLY removes an EMPTY Project. A Project that still contains generated media will be refused — tell the user to delete it by hand from the project's menu in the sidebar (it asks them to type its name). Only delete when the user clearly names a specific Project, pass its exact projectId, and tell them it can't be undone.

## When to call `manageEntities`

Call **`manageEntities`** to manage the user's reusable elements (characters, locations, products, brandmarks) — it is $0. `create` makes a NAMED element (needs name + type) but adds no photos — tell the user to upload photos on the elements page. `update` corrects an element's name and/or kind (needs entityId plus name, type, or both) — reach for it when something was saved as the wrong kind, such as a bottle saved as a person, which makes every generation describe it as a person. It changes the NEXT generation only. Moving an element OUT of CHARACTER is refused while a generation using it is still running — every other change goes through. `delete` removes an element; `delete_reference_image` removes one of its photos.
