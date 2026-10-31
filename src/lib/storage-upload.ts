// Brauzer tomonidagi yuklash yordamchisi.
//
// Fayl butunligicha emas, bo'laklab yuboriladi: Vercel'da bitta so'rov tanasi
// 4,5 MB bilan cheklangan, server esa 15 MB gacha hujjatni qabul qiladi.
// Token umumiy hajmni o'zida qulflagan, shuning uchun bu yerda faqat offset
// qo'shiladi — ketma-ketlikni server tekshiradi.
const CHUNK_BYTES = 3 * 1024 * 1024;

export async function uploadToStorage(uploadUrl: string, file: Blob, contentType: string): Promise<void> {
  if (!file.size) throw new Error("Bo'sh fayl yuklanmaydi.");
  for (let offset = 0; offset < file.size; offset += CHUNK_BYTES) {
    const body = file.slice(offset, Math.min(offset + CHUNK_BYTES, file.size));
    const separator = uploadUrl.includes("?") ? "&" : "?";
    const response = await fetch(`${uploadUrl}${separator}offset=${offset}`, {
      method: "PUT",
      headers: { "content-type": contentType },
      body,
    });
    if (!response.ok) {
      const reason = await response.text().catch(() => "");
      throw new Error(reason || "Yuklash amalga oshmadi.");
    }
  }
}
