import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { EmptyState, ErrorState, LoadingState, PageHeader, StatusBadge } from "@/components/app/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  deleteProduct,
  listCategories,
  listProducts,
  saveCategory,
  saveProduct,
} from "@/lib/catalog.functions";
import { formatMoney, stockState } from "@/lib/types";
import { useSectionTitle, useTerminology } from "@/lib/terminology";
import { t } from "@/lib/i18n";
import { friendlyError } from "@/lib/friendly-error";

export const Route = createFileRoute("/_authenticated/dashboard/products")({
  head: () => ({
    meta: [
      { title: t("Mahsulotlar — KetaOne") },
      { name: "description", content: t("AI savdo agentingiz taklif beradigan jonli mahsulotlar katalogi.") },
      { property: "og:title", content: t("Mahsulotlar — KetaOne") },
      { property: "og:description", content: t("AI savdo agentini boshqaradigan katalog va narxlar.") },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ProductsPage,
});

type Draft = {
  id?: string;
  sku: string;
  name: string;
  category_id: string;
  description: string;
  price: string;
  stock_quantity: string;
  low_stock_threshold: string;
  tags: string;
  is_active: boolean;
};

const EMPTY: Draft = {
  sku: "",
  name: "",
  category_id: "none",
  description: "",
  price: "0",
  stock_quantity: "0",
  low_stock_threshold: "3",
  tags: "",
  is_active: true,
};

function ProductsPage() {
  const queryClient = useQueryClient();
  const { term } = useTerminology();
  const catalog = term("products");
  const fetchProducts = useServerFn(listProducts);
  const fetchCategories = useServerFn(listCategories);
  const save = useServerFn(saveProduct);
  const remove = useServerFn(deleteProduct);
  const addCategory = useServerFn(saveCategory);

  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("all");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [newCategory, setNewCategory] = useState("");

  const products = useQuery({
    queryKey: ["products", search, categoryId],
    queryFn: () => fetchProducts({ data: { search, categoryId } }),
  });
  const categories = useQuery({ queryKey: ["categories"], queryFn: () => fetchCategories() });
  useSectionTitle(catalog.many);

  const saveMutation = useMutation({
    mutationFn: (value: Draft) =>
      save({
        data: {
          ...(value.id ? { id: value.id } : {}),
          sku: value.sku,
          name: value.name,
          category_id: value.category_id === "none" ? null : value.category_id,
          description: value.description,
          price: Number(value.price),
          stock_quantity: Number(value.stock_quantity),
          low_stock_threshold: Number(value.low_stock_threshold),
          images: [],
          tags: value.tags
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean),
          specifications: {},
          is_active: value.is_active,
        },
      }),
    onSuccess: () => {
      toast.success(t("{term} saqlandi", { term: catalog.one }));
      setDraft(null);
      void queryClient.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (error: unknown) => toast.error(friendlyError(error, t("Saqlash amalga oshmadi"))),
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => remove({ data: { id } }),
    onSuccess: () => {
      toast.success(t("{term} o'chirildi", { term: catalog.one }));
      void queryClient.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (error: unknown) => toast.error(friendlyError(error, t("O'chirish amalga oshmadi"))),
  });

  const categoryMutation = useMutation({
    mutationFn: (name: string) => addCategory({ data: { name } }),
    onSuccess: () => {
      setNewCategory("");
      void queryClient.invalidateQueries({ queryKey: ["categories"] });
    },
    onError: (error: unknown) => toast.error(friendlyError(error, t("Kategoriya qo'shilmadi"))),
  });

  return (
    <>
      <PageHeader
        title={catalog.many}
        description={t(
          "AI agent faqat shu yerdagi {many}ni, shu narx va zaxira bo'yicha sotadi.",
          { many: catalog.many },
        )}
        actions={<Button onClick={() => setDraft(EMPTY)}>{t("Yangi {term}", { term: catalog.one })}</Button>}
      />

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-48 flex-1">
          <Label htmlFor="p-search">{t("Qidiruv")}</Label>
          <Input
            id="p-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("Nomi yoki SKU")}
          />
        </div>
        <div className="w-52">
          <Label>{t("Kategoriya")}</Label>
          <Select value={categoryId} onValueChange={setCategoryId}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("Barcha kategoriyalar")}</SelectItem>
              {(categories.data ?? []).map((category) => (
                <SelectItem key={category.id} value={category.id}>
                  {category.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <form
          className="flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (newCategory.trim()) categoryMutation.mutate(newCategory.trim());
          }}
        >
          <div>
            <Label htmlFor="new-cat">{t("Yangi kategoriya")}</Label>
            <Input id="new-cat" value={newCategory} onChange={(event) => setNewCategory(event.target.value)} />
          </div>
          <Button variant="outline" type="submit">
            {t("Qo'shish")}
          </Button>
        </form>
      </div>

      {products.isPending ? (
        <LoadingState />
      ) : products.error ? (
        <ErrorState error={products.error} onRetry={() => void products.refetch()} />
      ) : products.data.length === 0 ? (
        <EmptyState
          title={t("Hozircha {many} yo'q", { many: catalog.many })}
          description={t("AI agent haqiqiy narx va zaxira asosida taklif berishi uchun katalogingizni qo'shing.")}
          action={<Button onClick={() => setDraft(EMPTY)}>{t("Yangi {term}", { term: catalog.one })}</Button>}
        />
      ) : (
        <div className="clay-panel clay-inset overflow-x-auto rounded-3xl p-2">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3">{catalog.one}</th>
                <th className="px-4 py-3">{t("Kategoriya")}</th>
                <th className="px-4 py-3">{t("Narx")}</th>
                <th className="px-4 py-3">{t("Zaxira")}</th>
                <th className="px-4 py-3">{t("Mavjudlik")}</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {products.data.map((product) => {
                const category = product.categories as { id: string; name: string } | null;
                return (
                  <tr key={product.id} className="hover:bg-muted/40">
                    <td className="px-4 py-3">
                      <p className="font-medium text-foreground">{product.name}</p>
                      <p className="text-xs text-muted-foreground">{product.sku}</p>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{category?.name ?? "—"}</td>
                    <td className="px-4 py-3 tabular-nums">{formatMoney(product.price)}</td>
                    <td className="px-4 py-3 tabular-nums">
                      {product.stock_quantity}
                      <span className="text-xs text-muted-foreground"> ({product.reserved_quantity} {t("band)")}</span>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge
                        value={stockState(
                          product.stock_quantity,
                          product.reserved_quantity,
                          product.low_stock_threshold,
                        )}
                      />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            setDraft({
                              id: product.id,
                              sku: product.sku,
                              name: product.name,
                              category_id: product.category_id ?? "none",
                              description: product.description ?? "",
                              price: String(product.price),
                              stock_quantity: String(product.stock_quantity),
                              low_stock_threshold: String(product.low_stock_threshold),
                              tags: (product.tags ?? []).join(", "),
                              is_active: product.is_active,
                            })
                          }
                        >
                          {t("Tahrirlash")}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => removeMutation.mutate(product.id)}>
                          {t("O'chirish")}
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Sheet open={Boolean(draft)} onOpenChange={(open) => (open ? null : setDraft(null))}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>
              {draft?.id
                ? t("{term}ni tahrirlash", { term: catalog.one })
                : t("Yangi {term}", { term: catalog.one })}
            </SheetTitle>
          </SheetHeader>
          {draft ? (
            <form
              className="space-y-3 px-4 pb-8"
              onSubmit={(event) => {
                event.preventDefault();
                saveMutation.mutate(draft);
              }}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="d-sku">{t("SKU")}</Label>
                  <Input
                    id="d-sku"
                    value={draft.sku}
                    onChange={(event) => setDraft({ ...draft, sku: event.target.value })}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="d-name">{t("Nomi")}</Label>
                  <Input
                    id="d-name"
                    value={draft.name}
                    onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                    required
                  />
                </div>
                <div className="sm:col-span-2">
                  <Label>{t("Kategoriya")}</Label>
                  <Select
                    value={draft.category_id}
                    onValueChange={(value) => setDraft({ ...draft, category_id: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t("Kategoriyasiz")}</SelectItem>
                      {(categories.data ?? []).map((category) => (
                        <SelectItem key={category.id} value={category.id}>
                          {category.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="d-price">{t("Narx")}</Label>
                  <Input
                    id="d-price"
                    type="number"
                    min={0}
                    value={draft.price}
                    onChange={(event) => setDraft({ ...draft, price: event.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="d-stock">{t("Zaxira")}</Label>
                  <Input
                    id="d-stock"
                    type="number"
                    min={0}
                    value={draft.stock_quantity}
                    onChange={(event) => setDraft({ ...draft, stock_quantity: event.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="d-threshold">{t("Kam zaxira ogohlantirishi")}</Label>
                  <Input
                    id="d-threshold"
                    type="number"
                    min={0}
                    value={draft.low_stock_threshold}
                    onChange={(event) => setDraft({ ...draft, low_stock_threshold: event.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="d-tags">{t("Teglar (vergul bilan ajrating)")}</Label>
                  <Input
                    id="d-tags"
                    value={draft.tags}
                    onChange={(event) => setDraft({ ...draft, tags: event.target.value })}
                  />
                </div>
                <div className="sm:col-span-2">
                  <Label htmlFor="d-desc">{t("AI foydalanadigan tavsif")}</Label>
                  <Textarea
                    id="d-desc"
                    rows={4}
                    value={draft.description}
                    onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                  />
                </div>
              </div>
              <Button type="submit" className="w-full" disabled={saveMutation.isPending}>
                {t("{term}ni saqlash", { term: catalog.one })}
              </Button>
            </form>
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  );
}
