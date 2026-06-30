/// <reference types="vite/client" />

// File System Access API の「名前を付けて保存」。Chromium系のみ対応で lib.dom に
// 未収録なため、利用する最小限のみをここで宣言する (非対応環境では undefined)。
interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: Array<{ description?: string; accept: Record<string, string[]> }>;
}
interface SaveFileWritableStream {
  write(data: string | Blob | BufferSource): Promise<void>;
  close(): Promise<void>;
}
interface SaveFileHandle {
  readonly name: string;
  createWritable(): Promise<SaveFileWritableStream>;
}
interface Window {
  showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<SaveFileHandle>;
}
