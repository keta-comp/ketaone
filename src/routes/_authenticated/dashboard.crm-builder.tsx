import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Bot, Send } from "lucide-react";

import { PageHeader } from "@/components/app/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { aiCrmBuilder } from "@/lib/crm-config.functions";
import { t } from "@/lib/i18n";
import { friendlyError } from "@/lib/friendly-error";

export const Route = createFileRoute("/_authenticated/dashboard/crm-builder")({
  head: () => ({ meta: [{ title: t("AI bilan CRMni sozlash — KetaOne") }] }),
  component: CrmBuilderPage,
});

type ChatMessage = { role: "user" | "assistant"; content: string };

const EXAMPLES = [
  "Bizga yangi field qo‘sh: mijoz qayerdan kelganini ko‘rsatadigan field.",
  "Pipelinega 'Qayta murojaat qilish kerak' degan bosqich qo‘sh.",
  "'Kasallik tarixi' degan maydon qo‘sh",
];

function CrmBuilderPage() {
  const queryClient = useQueryClient();
  const build = useServerFn(aiCrmBuilder);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content:
        "Salom! Men CRMingizni oddiy tilda sozlashga yordam beraman. Nima qilishni xohlaysiz? Masalan: yangi maydon qo‘shish, pipeline bosqichini o‘zgartirish yoki modul nomini almashtirish.",
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: trimmed }]);
    setBusy(true);
    try {
      const result = await build({ data: { message: trimmed } });
      setMessages((prev) => [...prev, { role: "assistant", content: result.reply }]);
      void queryClient.invalidateQueries({ queryKey: ["crm-config"] });
      void queryClient.invalidateQueries({ queryKey: ["crm-widgets"] });
} catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: friendlyError(error, "Xatolik yuz berdi, qayta urinib ko‘ring."),
        },
      ]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title={t("AI bilan CRMni sozlash")}
        description={t("Oddiy o‘zbek tilida yozing — modullar, maydonlar va pipeline shu zahoti moslashadi.")}
      />

      <section className="clay-panel flex min-h-[420px] flex-col p-4">
        <div className="flex-1 space-y-3 overflow-y-auto">
          {messages.map((message, i) => (
            <div
              key={i}
              className={
                message.role === "user"
                  ? "ml-auto max-w-[80%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm text-primary-foreground shadow-clay-sm"
                  : "mr-auto flex max-w-[80%] items-start gap-2 rounded-2xl rounded-bl-md bg-muted px-4 py-2.5 text-sm"
              }
            >
              {message.role === "assistant" && <Bot className="mt-0.5 size-4 shrink-0 text-primary" />}
              <span className="whitespace-pre-wrap">{message.content}</span>
            </div>
          ))}
          {busy && (
            <div className="mr-auto rounded-2xl bg-muted px-4 py-2.5 text-sm text-muted-foreground">
              {t("CRM yangilanmoqda…")}
            </div>
          )}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => void send(example)}
              className="rounded-full border bg-card px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground hover:shadow-clay-sm"
            >
              {example}
            </button>
          ))}
        </div>

        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
        >
          <Input
            placeholder={t("Masalan: 'Yangi maydon qo‘sh — manzil'")}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={busy}
          />
          <Button type="submit" size="icon" disabled={busy || !input.trim()} aria-label={t("Yuborish")}>
            <Send className="size-4" />
          </Button>
        </form>
        <p className="mt-2 text-xs text-muted-foreground">
          {t("Konfiguratsiya joriy CRMga darhol qo‘llanadi.")}{" "}
          <Link to="/dashboard/pipeline" className="text-primary hover:underline">
            {t("Pipelineni ko‘rish")}
          </Link>
        </p>
      </section>
    </>
  );
}
