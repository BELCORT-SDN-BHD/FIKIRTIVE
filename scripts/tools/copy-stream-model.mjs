/**
 * #682 文案流模型 —— 测试与取证脚本**共用的唯一一份实现**(#834 r6)。
 *
 * 一份实现两个消费者:`apps/web/lib/__tests__/otto-pronoun-consistency.test.ts`(围栏本体)
 * 与 `scripts/tools/audit-copy-stream-equivalence.mjs`(等价取证)。r6 一度在脚本里手抄了
 * 第二份,当场就漂移了(脚本那份把全仓的分支都数成 0,取证于是变成一句空话)——
 * 抄一份就会漂一份,所以这里只留一份。
 */
import { createRequire } from "node:module";
import path from "node:path";

const ts = createRequire(path.join(import.meta.dirname, "../../apps/web/package.json"))("typescript");

export function scriptKindOf(file) {
  return file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

const VARIANT_CAP = 64;
/**
 * 窗口宽度。规则一次只看「一句 + 它的前一句」,所以能互相改变相邻关系的只有**挨着的
 * 那两个**条件 —— 窗口取 2 就够,再宽只是把同样的结论算很多遍。实测:窗口 6 时全仓
 * 扫描 20s+ 超时,窗口 2 是 2s 上下,而两者在全仓上给出**同一个结果集**。
 */
const WINDOW = 2;
/** 一个文件里参与展开的条件总数上限。超过就不是「这段文案有几种说法」了,拒绝猜。 */
const MAX_CHOICES_PER_FILE = 64;

export class VariantOverflow extends Error {}

function carriesCopy(node) {
  let found = false;
  const walk = (child) => {
    if (found) return;
    if (ts.isJsxText(child) && /[A-Za-z]/.test(child.text)) found = true;
    else if ((ts.isStringLiteral(child) || ts.isNoSubstitutionTemplateLiteral(child)) && /[A-Za-z]/.test(child.text)) found = true;
    else if (ts.isTemplateExpression(child)) found = true;
    if (!found) ts.forEachChild(child, walk);
  };
  walk(node);
  return found;
}

/**
 * 一个分叉的两支。三种运算符,三种呈现语义 —— **别把它们当成同一个形状**(#834 r7 P1):
 *
 *   · `a ? X : Y`     → [X, Y]        两支各是一条呈现路径。
 *   · `cond && X`     → [X, 空]       条件成立出 X,不成立**整段不出现**;
 *                                      「空」这一态是要害:它一走,前后两句就贴在一起。
 *   · `a || b`        → [a, b]        左真取**左**、左假取右 —— 左操作数是可呈现的。
 *   · `a ?? b`        → [a, b]        同上(左非 null/undefined 取左)。
 *
 * r6 把 `||` 也建成 [右支, 空],于是**左操作数整条丢了**。判官的反例:
 *   `{(ready ? "Meet Otto." : "") || "Start."}`
 * `ready=true` 时屏幕上是「Meet Otto.」,而模型只生成「Start.」与空两态 —— 违规看不见。
 */
function branchesOf(node, inRender) {
  if (!inRender) return null;
  if (ts.isConditionalExpression(node) && (carriesCopy(node.whenTrue) || carriesCopy(node.whenFalse))) {
    return [node.whenTrue, node.whenFalse];
  }
  if (!ts.isBinaryExpression(node)) return null;
  const operator = node.operatorToken.kind;
  if (operator === ts.SyntaxKind.AmpersandAmpersandToken && carriesCopy(node.right)) {
    return [node.right, null];
  }
  if (
    (operator === ts.SyntaxKind.BarBarToken || operator === ts.SyntaxKind.QuestionQuestionToken) &&
    (carriesCopy(node.left) || carriesCopy(node.right))
  ) {
    return [node.left, node.right];
  }
  return null;
}

/** 源码 → 带分叉的片段序列。分叉在建树时就编好号,编号与「哪一支被选中」无关。 */
export function copyPieces(source, file) {
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKindOf(file));
  let nextChoiceId = 0;
  const collect = (nodes, inRender) => {
    const pieces = [];
    const push = (node, render) => {
      if (node === null) return;
      const branches = branchesOf(node, render);
      if (branches) {
        const id = nextChoiceId;
        nextChoiceId += 1;
        pieces.push({ kind: "choice", id, branches: branches.map((branch) => collect([branch], true)) });
        return;
      }
      if (ts.isJsxText(node) || ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        pieces.push({ kind: "text", text: node.text });
        return;
      }
      if (ts.isTemplateExpression(node)) {
        pieces.push({ kind: "text", text: node.head.text });
        for (const span of node.templateSpans) {
          // `${…}` 是呈现位置。
          push(span.expression, true);
          pieces.push({ kind: "text", text: span.literal.text });
        }
        return;
      }
      // JSX 的 `{…}` 同样是呈现位置;别处沿用父节点的状态。
      const childRender = render || ts.isJsxExpression(node);
      ts.forEachChild(node, (child) => push(child, childRender));
    };
    for (const node of nodes) push(node, inRender);
    return pieces;
  };
  const top = [];
  ts.forEachChild(parsed, (child) => {
    top.push(child);
  });
  const pieces = collect(top, false);
  return { pieces, choices: nextChoiceId };
}

/** 一条变体 = 每个分叉按 `pick` 选定一支之后拼出来的那段文本。 */
function renderPieces(pieces, pick) {
  const runs = [];
  for (const piece of pieces) {
    if (piece.kind === "text") {
      runs.push(piece.text);
      continue;
    }
    runs.push(...renderPieces(piece.branches[pick(piece.id)] ?? [], pick));
  }
  return runs;
}

/**
 * 片段序列 → 一组变体流。
 *
 * ≤6 个条件:精确全交叉(≤ 64 种,正好是上限)。
 * 更多:按**连续 6 个一组的滑动窗口**展开,窗口外的条件分别钉在各自两支上各跑一遍。
 * 规则一次只看「一句 + 它的前一句」,能改变相邻关系的只有彼此挨着的那几个条件,
 * 所以窗口法把组合压回线性而不留盲区。
 * 实测全仓单个容器最多 14 个并列条件(Otto 详情卡那种一行一条件),全交叉是 2^14;
 * 若对这类容器直接判红,main 上会有 9 处永久红,其中 5 处正是 Otto 卡片 ——
 * 等于把这道围栏最该看的地方蒙上,那不是 fail closed,是 fail blind。
 *
 * 真正的 fail closed 在这里:一个文件参与展开的条件超过 MAX_CHOICES_PER_FILE 时,
 * 不静默放行,而是抛出去让调用方判红并要求拆简或带理由上豁免板。
 *
 * @throws VariantOverflow 条件数超限
 */
export function copyVariants(source, file = "planted.tsx") {
  const { pieces, choices } = copyPieces(source, file);
  if (choices > MAX_CHOICES_PER_FILE) {
    throw new VariantOverflow(
      `${file}:条件文本组合超限 —— 参与展开的条件有 ${choices} 个,上限 ${MAX_CHOICES_PER_FILE}。` +
        "请把这段拆简,或带理由上豁免板;这里不静默放行。",
    );
  }
  /**
   * 收尾:丢掉没有字母的片段(样式类碎片、纯数字),其余按出现顺序用空格接起来。
   *
   * **只有一个例外:句末标点**(`.` `!` `?`)。一句话以插值收尾时——
   * `` `…across every ${PRODUCT_VOCABULARY.canvas}.` ``——模板的尾巴就只剩那个句号,
   * 一律按「没有字母」丢掉的话,这句话就没有句界了,和后面那一句并成一句。
   * 那正是本文件抬头 #816 要修的病,只是方向相反:句界丢了,规则要么零命中,要么把
   * 隔着两个界面的两句话判成相邻(2026-09-06 实例:`StuffLibrary` 的上手空态与
   * `Rename item` 弹层的说明句被并成一句,#682 的代词规则误报)。
   * 句末标点因此不另起一段,直接贴回前一段——它不是文案,它是标点。
   */
  const clean = (runs) => {
    let out = "";
    for (const raw of runs) {
      const run = raw.trim();
      if (!run) continue;
      if (/^[.!?]+$/.test(run)) {
        out += run;
        continue;
      }
      if (!/[A-Za-z]/.test(run)) continue;
      out = out ? `${out} ${run}` : run;
    }
    return out;
  };

  if (choices === 0) return [clean(renderPieces(pieces, () => 0))];

  const variants = new Set();
  for (let start = 0; start === 0 || start + WINDOW <= choices; start += 1) {
    const end = Math.min(start + WINDOW, choices);
    const combinations = 1 << (end - start);
    /* c8 ignore next */
    if (combinations > VARIANT_CAP) throw new VariantOverflow("窗口组合数超过上限");
    // 窗口外的条件钉在各自的两支上各跑一遍,免得「窗口外永远取同一支」制造出新的盲区。
    for (const outside of [0, 1]) {
      for (let mask = 0; mask < combinations; mask += 1) {
        variants.add(clean(renderPieces(pieces, (id) =>
          id >= start && id < end ? (mask >> (id - start)) & 1 : outside)));
      }
    }
    if (end === choices) break;
  }
  return [...variants];
}
