import { File, Files } from "lucide-react";
import type { PublicFile } from "@directdrop/protocol";
import { formatBytes } from "@directdrop/shared";

export function FileList({ files }: { files: PublicFile[] }) {
  return (
    <section aria-labelledby="file-list-title">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2
          id="file-list-title"
          className="flex items-center gap-2 text-sm font-bold text-slate-900"
        >
          {files.length > 1 ? (
            <Files aria-hidden="true" size={18} />
          ) : (
            <File aria-hidden="true" size={18} />
          )}
          공유된 파일 {files.length > 1 ? `${files.length}개` : ""}
        </h2>
        <span className="tabular text-sm font-semibold text-slate-600">
          {formatBytes(files.reduce((sum, file) => sum + file.size, 0))}
        </span>
      </div>
      <ul className="divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white">
        {files.map((file) => (
          <li
            key={file.id}
            className="flex min-w-0 items-center gap-3 px-4 py-3.5"
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-700">
              <File aria-hidden="true" size={18} />
            </span>
            <span className="min-w-0 flex-1">
              <span
                className="block truncate text-sm font-semibold text-slate-900"
                title={file.name}
              >
                {file.name}
              </span>
              <span className="tabular mt-0.5 block text-xs text-slate-500">
                {formatBytes(file.size)}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
