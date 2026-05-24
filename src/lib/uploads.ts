import { writeFile } from "node:fs/promises";
import path from "node:path";
import { v7 as uuidv7 } from "uuid";

const UPLOAD_DIR = "/usr/src/app/uploads";

export const saveUploadFiles = async (rawBody: Record<string, unknown>) => {
  // Collect File instances under any field name — matches multer's upload.any() semantics.
  const files: File[] = [];
  for (const value of Object.values(rawBody)) {
    const items = Array.isArray(value) ? value : [value];
    for (const item of items) {
      if (item instanceof File) files.push(item);
    }
  }
  const saved: { filename: string; url: string }[] = [];
  for (const file of files) {
    const filename = `${uuidv7()}${path.extname(file.name)}`;
    await writeFile(path.join(UPLOAD_DIR, filename), Buffer.from(await file.arrayBuffer()));
    saved.push({ filename, url: path.join("uploads", filename) });
  }
  return saved;
};
