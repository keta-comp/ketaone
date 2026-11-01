import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Send, Sparkles } from "lucide-react";

import { PageHeader } from "@/components/app/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { askBusinessAssistant } from "@/lib/workspace.functions";
import { t } from "@/lib/i18n";
import { friendlyError } from "@/lib/friendly-error";

export const Route = createFileRoute("/_authenticated/dashboard/assistant")({
  head: () => ({
    meta: [
      { title: t("AI yordamchi — KetaOne") },
      {
        name: "description",
        content: t("Biznesingiz haqida savol bering — javob faqat bazadagi real raqamlar asosida beriladi."),
      },
      { property: "og:title", content: t("AI yordamchi — KetaOne") },
      { property: "og:description", content: t("Savol bering, AI hisobotni o‘zi tahlil qiladi.") },
    ],
  }),
  component: AssistantPage,
});

const SUGGESTIONS = [
  "Bu oyda tushum qancha bo‘ldi?",
  "Eng ko‘p sotilgan mahsulot qaysi?",
  "Qaysi mijozlar qarzdor?",
  "Konversiya foizini yaxshilash uchun nima qilaylik?",
];

type Msg = { role: "user" | "assistant"; content: string };

function AssistantPage() {
  const ask = useServerFn(askBusinessAssistant);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  const send = async (question: string) => {
    const text = question.trim();
    if (!text || busy) return;
    setValue("");
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setBusy(true);
    try {
      const result = await ask({ data: { question: text } });
      setMessages((prev) => [...prev, { role: "assistant", content: result.answer }]);
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: friendlyError(error, "Xatolik yuz berdi.") },
      ]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title={t("AI yordamchi")}
        description={t("Savollarga faqat bazangizdagi real ma’lumotlar asosida javob beradi.")}
      />

      <div className="clay-panel flex min-h-[60vh] flex-col gap-4 p-5">
        <div className="flex-1 space-y-3 overflow-y-auto">
          {messages.length === 0 ? (
            <div className="space-y-3">
              <div className="clay-inset flex items-start gap-3 rounded-2xl p-4">
                <Sparkles className="mt-0.5 size-4 shrink-0" />
                <p className="text-sm text-muted-foreground">
                  {t("Savol yozing yoki quyidagi tayyor savollardan birini tanlang.")}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {SUGGESTIONS.map((s) => (
                  <Button key={s} variant="outline" size="sm" onClick={() => void send(s)}>
                    {s}
                  </Button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((message, index) => (
              <div
                key={index}
                className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm ${
                  message.role === "user" ? "clay-raised ml-auto" : "clay-inset"
                }`}
              >
                {message.content}
              </div>
            ))
          )}
          {busy ? (
            <div className="clay-inset flex w-fit items-center gap-2 rounded-2xl px-4 py-3 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> {t("Tahlil qilinmoqda…")}
            </div>
          ) : null}
        </div>

        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void send(value);
          }}
        >
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={t("Masalan: bu hafta nechta buyurtma bo‘ldi?")}
            maxLength={500}
          />
          <Button type="submit" size="icon" disabled={busy} aria-label={t("Yuborish")}>
            <Send className="size-4" />
          </Button>
        </form>
      </div>
    </>
  );
}
