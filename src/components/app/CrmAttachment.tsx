import { useRef, useState } from "react";
import { Download, Paperclip, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { getCrmAttachmentUrl, issueCrmAttachmentPath } from "@/lib/crm-config.functions";
import { t } from "@/lib/i18n";
import { uploadToStorage } from "@/lib/storage-upload";

/** Objects are stored under `{business}/{module}/{uuid}/{name}` — the last segment is the display name. */
function attachmentName(path: string): string {
  return decodeURIComponent(path.split("/").pop() ?? path);
}

/**
 * Opens a private attachment through a short-lived signed URL. The server function re-checks
 * tenancy and the module's access rights before handing the link out.
 */
async function openAttachment(moduleKey: string, path: string): Promise<void> {
  const { url } = await getCrmAttachmentUrl({ data: { moduleKey, path } });
  window.open(url, "_blank", "noopener,noreferrer");
}

async function runOpen(moduleKey: string, path: string) {
  try {
    await openAttachment(moduleKey, path);
  } catch (error) {
    toast.error(error instanceof Error ? error.message : t("Faylni ochib bo‘lmadi"));
  }
}

export function AttachmentCell({ moduleKey, path }: { moduleKey: string; path: string }) {
  const [busy, setBusy] = useState(false);
  if (!path) return <>—</>;
  return (
    <Button
      variant="link"
      size="sm"
      className="h-auto max-w-52 justify-start gap-1 p-0"
      disabled={busy}
      onClick={(e) => {
        e.stopPropagation();
        setBusy(true);
        void runOpen(moduleKey, path).finally(() => setBusy(false));
      }}
    >
      <Paperclip className="size-3.5 shrink-0" />
      <span className="truncate">{attachmentName(path)}</span>
    </Button>
  );
}

export function AttachmentField({
  moduleKey,
  value,
  onChange,
}: {
  moduleKey: string;
  value: string;
  onChange: (path: string) => void;
}) {
  const picker = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const { path, uploadUrl } = await issueCrmAttachmentPath({
        data: { moduleKey, filename: file.name, contentType: file.type, size: file.size },
      });
      await uploadToStorage(uploadUrl, file, file.type);
      onChange(path);
      toast.success(t("Fayl biriktirildi"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("Yuklash amalga oshmadi"));
    } finally {
      setBusy(false);
      if (picker.current) picker.current.value = "";
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        ref={picker}
        type="file"
        accept=".pdf,.png,.jpg,.jpeg,.webp,.tif,.tiff"
        className="hidden"
        onChange={(e) => void upload(e.target.files?.[0])}
      />
      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => picker.current?.click()}>
        <Paperclip className="size-4" />
        {busy ? t("Yuklanmoqda…") : value ? t("Faylni almashtirish") : t("Fayl yuklash")}
      </Button>
      {value && (
        <>
          <span className="max-w-48 truncate text-sm text-muted-foreground">{attachmentName(value)}</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void runOpen(moduleKey, value)}
          >
            <Download className="size-4" /> {t("Ochish")}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange("")}>
            <X className="size-4" /> {t("Olib tashlash")}
          </Button>
        </>
      )}
    </div>
  );
}
