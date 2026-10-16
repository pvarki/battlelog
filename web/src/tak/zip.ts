import { Unzip, type UnzipFile, UnzipInflate } from "fflate";

export class ZipLimitError extends Error {}

// Deflate expands at most ~1032:1, so one chunk inflates to ~16 MB before it is counted.
const CHUNK_BYTES = 16 * 1024;
const ZIP_SIGNATURES = new Set([0x04034b50, 0x06054b50]);

const joined = (chunks: Uint8Array[], size: number) => {
  if (chunks.length === 1) return chunks[0] as Uint8Array;
  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
};

/**
 * The accepted entries of a zip from elsewhere, counting what each really
 * inflates to: the sizes a zip declares are only its sender's word. Throws
 * ZipLimitError past either limit or when an entry isn't the size it declares.
 */
export const unzipCapped = (
  zip: Uint8Array,
  accept: (file: UnzipFile) => boolean,
  { maxEntryBytes, maxTotalBytes }: { maxEntryBytes: number; maxTotalBytes: number },
): Record<string, Uint8Array> => {
  if (
    zip.length < 4 ||
    !ZIP_SIGNATURES.has(new DataView(zip.buffer, zip.byteOffset).getUint32(0, true))
  )
    throw new Error("invalid zip data");
  const files: Record<string, Uint8Array> = {};
  let total = 0;
  const unzip = new Unzip((file) => {
    if (!accept(file)) return;
    const chunks: Uint8Array[] = [];
    let size = 0;
    file.ondata = (err, chunk, final) => {
      if (err) throw err;
      size += chunk.length;
      total += chunk.length;
      if (size > maxEntryBytes || total > maxTotalBytes) {
        file.terminate();
        throw new ZipLimitError("Archive expands too large to open");
      }
      chunks.push(chunk);
      if (!final) return;
      if (file.originalSize !== undefined && size !== file.originalSize)
        throw new ZipLimitError(`${file.name} isn't the size the archive says`);
      files[file.name] = joined(chunks, size);
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  for (let at = 0; at < zip.length; at += CHUNK_BYTES)
    unzip.push(zip.subarray(at, at + CHUNK_BYTES), at + CHUNK_BYTES >= zip.length);
  return files;
};
