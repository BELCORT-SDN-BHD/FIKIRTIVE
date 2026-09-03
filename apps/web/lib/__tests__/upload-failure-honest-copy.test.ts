/**
 * upload-failure-honest-copy.test.ts — 2026-09-03 staging 真商家走查修的两条,钉在这里。
 *
 * 走查现场:staging 的存储桶 CORS 把浏览器直传挡在门外。
 *   S2 商家读到的是上传库自己的原话「Unknown error」——不是我们写的话,也没给出路。
 *   S3 服务器不在直传这条路上,所以 web 日志里一行都没有,我们零感知。
 *
 * 这份测试的变异守卫很直白:把 `direct-upload.ts` 改回「底层 message 直出」,或者把
 * `reportDirectUploadFailure` 那一笔拿掉,下面就有测试红。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

/** 假 Uppy:测试直接摆布「这一趟怎么失败的」,不碰真的网络与真的分片。 */
const uppy = vi.hoisted(() => ({
  listeners: new Map<string, ((...args: unknown[]) => void)[]>(),
  added: [] as { name: string; meta: Record<string, unknown> }[],
  destroyed: 0,
  run: null as null | ((
    emit: (event: string, ...args: unknown[]) => void,
    added: { name: string; meta: Record<string, unknown> }[],
  ) => unknown),
}));

vi.mock("@uppy/core", () => ({
  default: class FakeUppy {
    use() { return this; }
    on(event: string, cb: (...args: unknown[]) => void) {
      uppy.listeners.set(event, [...(uppy.listeners.get(event) ?? []), cb]);
      return this;
    }
    addFile(file: { name: string; meta: Record<string, unknown> }) { uppy.added.push(file); return file.name; }
    async upload() {
      const emit = (event: string, ...args: unknown[]) => {
        for (const cb of uppy.listeners.get(event) ?? []) cb(...args);
      };
      return uppy.run?.(emit, uppy.added);
    }
    destroy() { uppy.destroyed += 1; }
  },
}));
vi.mock("@uppy/aws-s3", () => ({ default: class FakeAwsS3 {} }));

// 哈希只是给存储键取名,与本票无关;别在测试里烧 wasm。
vi.mock("hash-wasm", () => ({
  createSHA256: async () => ({ update: () => {}, digest: () => "a".repeat(64) }),
}));

const actions = vi.hoisted(() => ({
  authorizeUpload: vi.fn(),
  signUploadPart: vi.fn(),
  abortDirectUpload: vi.fn(),
  uploadFileFallback: vi.fn(),
  reportDirectUploadFailure: vi.fn(),
}));
vi.mock("../upload-actions", () => actions);

const { uploadFilesDirect } = await import("../direct-upload");
const { UPLOAD_FAILURE_COPY, UPLOAD_MAX_BYTES } = await import("@fikirtive/core/upload");

/** 走查那天真实签出来的形状:query 里带签名。它一个字符都不许流进日志或界面。 */
const PRESIGNED = "https://bucket.example.com/o/abc.png?X-Amz-Signature=DEADBEEFSECRET";

function png(name = "poster.png", body = "hello"): File {
  return new File([body], name, { type: "image/png" });
}

beforeEach(() => {
  vi.clearAllMocks();
  uppy.listeners.clear();
  uppy.added.length = 0;
  uppy.destroyed = 0;
  uppy.run = null;
  actions.authorizeUpload.mockResolvedValue({ kind: "single", url: PRESIGNED });
  actions.reportDirectUploadFailure.mockResolvedValue({ ok: true });
});

describe("S2 —— 上传失败时商家读到的是人话,不是上传库的原话", () => {
  it("传输被挡住(走查现场:桶的 CORS)时说「再试一次」,而不是把「Unknown error」端上去", async () => {
    uppy.run = (emit, added) => {
      emit("upload-error", { name: added[0]!.name }, { name: "Error", message: "Unknown error" }, undefined);
      return { successful: [], failed: added.map((f) => ({ ...f, error: "Unknown error" })) };
    };

    const outcome = await uploadFilesDirect([png()], () => {});

    expect(outcome.files).toEqual([]);
    expect(outcome.failures).toEqual([
      {
        filename: "poster.png",
        reason: "We couldn’t upload that file. Check your connection and try again.",
        category: "blocked",
      },
    ]);
    // 变异守卫:任何一条把底层字符串放回来的改动都会踩到这一行。
    expect(JSON.stringify(outcome)).not.toContain("Unknown error");
  });

  it("文件类型不在允许名单里时说「换个文件」,并把上限说成商家看得懂的数", async () => {
    const outcome = await uploadFilesDirect([new File(["x"], "invoice.exe")], () => {});

    expect(outcome.failures).toEqual([
      {
        filename: "invoice.exe",
        reason: "We can’t use that file. Pick an image, video, or audio file under 2 GB.",
        category: "rejected",
      },
    ]);
    // 「再试一次」是错的出路:同一个 .exe 试一百次也过不去。
    expect(outcome.failures[0]!.reason).not.toContain("try again");
  });

  it("授权那一步整段够不着服务端(断网)时,不再把异常原话冒到界面", async () => {
    actions.authorizeUpload.mockRejectedValue(new Error("Failed to fetch RSC payload for /create"));

    const outcome = await uploadFilesDirect([png()], () => {});

    expect(outcome.failures[0]).toEqual({
      filename: "poster.png",
      reason: UPLOAD_FAILURE_COPY.blocked,
      category: "blocked",
    });
    expect(JSON.stringify(outcome)).not.toContain("Failed to fetch");
  });

  it("上传整趟抛出来时也收成一条商家话,不静默吞掉", async () => {
    uppy.run = () => { throw new Error("NetworkError when attempting to fetch resource."); };

    const outcome = await uploadFilesDirect([png()], () => {});

    expect(outcome.files).toEqual([]);
    expect(outcome.failures).toEqual([
      { filename: "poster.png", reason: UPLOAD_FAILURE_COPY.blocked, category: "blocked" },
    ]);
    expect(JSON.stringify(outcome)).not.toContain("NetworkError");
  });

  it("服务端自己写的那几句商家话(限流等)比通用句更有指向,原样保留", async () => {
    actions.authorizeUpload.mockResolvedValue({
      error: "You've uploaded a lot of files in the last hour. Try again a little later.",
    });

    const outcome = await uploadFilesDirect([png()], () => {});

    expect(outcome.failures[0]!.reason).toBe(
      "You've uploaded a lot of files in the last hour. Try again a little later.",
    );
  });
});

describe("S2 —— 两句话本身(单一来源,逐字)", () => {
  it("逐字就是这两句", () => {
    expect(UPLOAD_FAILURE_COPY.blocked).toBe("We couldn’t upload that file. Check your connection and try again.");
    expect(UPLOAD_FAILURE_COPY.rejected).toBe("We can’t use that file. Pick an image, video, or audio file under 2 GB.");
  });

  it("不出现库名、供应商名、协议名或任何技术名词", () => {
    const banned = [
      "Unknown error", "Uppy", "S3", "R2", "CORS", "bucket", "presigned",
      "sha256", "multipart", "HTTP", "500", "fetch", "null", "undefined",
    ];
    for (const sentence of Object.values(UPLOAD_FAILURE_COPY)) {
      for (const word of banned) {
        expect(sentence.toLowerCase(), `「${sentence}」里出现了 ${word}`).not.toContain(word.toLowerCase());
      }
    }
  });

  it("句子里的上限跟着集中配置走,不是手写的字面量", () => {
    const gib = Math.round(UPLOAD_MAX_BYTES / (1024 * 1024 * 1024));
    expect(UPLOAD_FAILURE_COPY.rejected).toContain(`${gib} GB`);
  });
});

describe("S3 —— 每一条直传失败都在服务端留下一笔", () => {
  it("传输失败时带上阶段、类别、文件类型、大小与拿得到的状态码", async () => {
    uppy.run = (emit, added) => {
      emit("upload-error", { name: added[0]!.name }, { name: "Error", message: "Unknown error" }, { status: 403 });
      return { successful: [], failed: added.map((f) => ({ ...f, error: "Unknown error" })) };
    };

    await uploadFilesDirect([png()], () => {});

    expect(actions.reportDirectUploadFailure).toHaveBeenCalledTimes(1);
    expect(actions.reportDirectUploadFailure).toHaveBeenCalledWith({
      stage: "transfer",
      category: "blocked",
      ext: "png",
      sizeBytes: 5,
      httpStatus: 403,
    });
  });

  it("被 CORS 掐掉时状态码报 null —— 运维据此分得清「桶没放行」与「我们签错了」", async () => {
    uppy.run = (emit, added) => {
      emit("upload-error", { name: added[0]!.name }, { name: "Error", message: "Unknown error" }, undefined);
      return { successful: [], failed: added.map((f) => ({ ...f, error: "Unknown error" })) };
    };

    await uploadFilesDirect([png()], () => {});

    expect(actions.reportDirectUploadFailure).toHaveBeenCalledWith(
      expect.objectContaining({ stage: "transfer", httpStatus: null }),
    );
  });

  it("浏览器自己拦下的文件也报一笔,阶段写 precheck", async () => {
    await uploadFilesDirect([new File(["x"], "invoice.exe")], () => {});

    expect(actions.reportDirectUploadFailure).toHaveBeenCalledWith({
      stage: "precheck",
      category: "rejected",
      ext: null,
      sizeBytes: 1,
      httpStatus: null,
    });
  });

  it("报的那一笔里没有文件名、没有原始错误串、没有预签名 URL —— 凭据不搭车", async () => {
    uppy.run = (emit, added) => {
      emit("upload-error", { name: added[0]!.name }, { name: "Error", message: `PUT ${PRESIGNED} failed` }, undefined);
      return { successful: [], failed: added.map((f) => ({ ...f, error: `PUT ${PRESIGNED} failed` })) };
    };

    await uploadFilesDirect([png("quarterly-numbers.png")], () => {});

    const sent = JSON.stringify(actions.reportDirectUploadFailure.mock.calls);
    expect(sent).not.toContain("X-Amz-Signature");
    expect(sent).not.toContain("DEADBEEFSECRET");
    expect(sent).not.toContain("quarterly-numbers");
    // 租户身份由服务端的 requireOwner() 定,报告体里根本没有可填的字段。
    expect(sent).not.toContain("orgId");
    expect(sent).not.toContain("ownerId");
  });

  it("留痕本身失败时不许盖掉商家看到的那条错误", async () => {
    actions.reportDirectUploadFailure.mockRejectedValue(new Error("server unreachable"));
    uppy.run = (emit, added) => ({ successful: [], failed: added.map((f) => ({ ...f, error: "Unknown error" })) });

    const outcome = await uploadFilesDirect([png()], () => {});

    expect(outcome.failures[0]!.reason).toBe(UPLOAD_FAILURE_COPY.blocked);
  });

  it("上传成功时一笔都不报", async () => {
    uppy.run = (emit, added) => ({ successful: added, failed: [] });

    const outcome = await uploadFilesDirect([png()], () => {});

    expect(outcome.files).toHaveLength(1);
    expect(actions.reportDirectUploadFailure).not.toHaveBeenCalled();
  });
});
