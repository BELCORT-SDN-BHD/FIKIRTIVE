/**
 * 把驱动给的字节迭代器接成响应体 —— 整件东西不进内存,一段视频不再在服务器上摊开。
 * 浏览器中断下载时 `cancel` 会关掉底层流(local 是 fd,r2 是 S3 连接)。
 *
 * 两个调用点共用同一份(7.3 单一事实源):`app/files/[...key]` 的同源附件下载,以及
 * SHARE-A1 之后的公开媒体代理 `app/api/media/pub/[token]`。两条路都不许把对象整块
 * 缓冲进进程,所以「怎么把流接成响应体」只能有一份实现。
 */
export function toWebStream(source: AsyncIterable<Uint8Array>): ReadableStream<Uint8Array> {
  const iterator = source[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { value, done } = await iterator.next();
      if (done) {
        controller.close();
        return;
      }
      controller.enqueue(value);
    },
    async cancel(reason) {
      await iterator.return?.(reason);
    },
  });
}
