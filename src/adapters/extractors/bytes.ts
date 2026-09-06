// 바이트 뷰 도우미(DESIGN §6 D3). Buffer를 요구하는 파서에 넘길 때 복사 없이 같은 메모리 위의 뷰를 준다 —
// 25 MiB 문서를 두 번 들지 않기 위해. 파서가 버퍼를 detach·변형하는 경우(pdf.js)에는 쓰지 말 것.

/** Buffer면 그대로, 아니면 같은 ArrayBuffer 위의 Buffer 뷰(복사 없음). */
export function asBuffer(bytes: Uint8Array): Buffer {
  return Buffer.isBuffer(bytes)
    ? bytes
    : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
