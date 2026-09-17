"use client";

/**
 * 「按住 Shift 再点一张」这件事，读的是**这一下点击自己带的修饰键**（FRONT-A15，Refs #1357）。
 *
 * 病在哪。React Flow 的加选开关是它 store 里的 `multiSelectionActive`，而它是这样被写进去的：
 * Shift 的 keydown 先变成一个 React state（`useKeyPress`，@xyflow/react 12.11.1
 * dist/esm/index.mjs:377），那次渲染提交之后，再由一个 **passive effect** 写进 store
 * （同文件 :1246-1249 `useGlobalKeyHandler`）。而一张卡到底是「加选」还是「换选」，判定发生在
 * 卡自己的 `onClick` 里（:2261 `onSelectNodeHandler` → :1639 `handleNodeClick` → :3511
 * `addSelectedNodes`；`nodeDragThreshold` 默认 1，所以走的是点击这条路，不是拖拽那条），它是
 * **同步**读 store 的。两者之间隔着一次 React 的 passive-effect 冲刷 —— 而浏览器把排队的输入
 * 事件排在 React 那个 MessageChannel 任务前面，于是点击可以抢在开关写进去之前落地：读到的还是
 * `false`，`addSelectedNodes` 就走「换一张」那条分支，把商家上一张选中的卡悄悄取消掉。
 *
 * 屏幕上是这样的：商家点中一张图，按住 Shift 点第二张 —— 第一张的描边没了，手里只剩第二张。
 * 他没做错任何事，板子自己把他刚选的东西丢了。CI 上 journey 17（FRONT-A15）偶发的那条红
 * （run 34820228755 / 34681183175）就是这一下；机器慢的时候更容易撞上。
 *
 * 修在根上。修饰键的真相在事件对象里：`shiftKey` 是随这一下点击一起到达的，不需要等任何一次
 * 渲染、任何一次 effect。捕获阶段挂在 document 上，先于 React 把这一下点击派给卡，所以卡做
 * 判定时读到的开关，就是商家此刻手上的那个键。keyup 之后由 React Flow 自己那条 effect 归位，
 * 这里不接管它的生命周期，只保证「做判定的那一刻」是对的。
 */
import { useEffect } from "react";
import { useStoreApi } from "@xyflow/react";

export function CanvasMultiSelectModifier(): null {
  const store = useStoreApi();
  useEffect(() => {
    const sync = (event: MouseEvent): void => {
      // 与 FlowCanvas 交给 React Flow 的 `multiSelectionKeyCode` 是同一组键，一个都不多一个不少。
      const active = event.shiftKey || event.metaKey || event.ctrlKey;
      if (store.getState().multiSelectionActive !== active) {
        store.setState({ multiSelectionActive: active });
      }
    };
    // pointerdown 盖住拖拽那条路（它先于 mousedown），click 盖住点击这条路。
    document.addEventListener("pointerdown", sync, true);
    document.addEventListener("click", sync, true);
    return () => {
      document.removeEventListener("pointerdown", sync, true);
      document.removeEventListener("click", sync, true);
    };
  }, [store]);
  return null;
}
