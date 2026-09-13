# Altare — Konumlandırma Kararı

> **Bu doküman bir tercih değil, bir SINIRDIR.** Ürün, site veya panel üzerinde
> çalışan herkes (insan ya da AI) buna uymak zorundadır. Aksi yönde bir öneri
> gelirse — tasarım, pazarlama ya da "yatırımcı böyle ister" gerekçesiyle —
> cevap bu dosyadır.
>
> Karar sahibi: Berkant Doğrusöz · Tarih: 2026-09

---

## Tek cümle

**Altare bir oyun stüdyosudur.** Altare Panel, stüdyonun hem kendi içinde
kullandığı hem de dışarıya sunduğu bir hizmettir.

---

## Kimlik sırası

| Sıra | Ne | Nerede anlatılır |
|---|---|---|
| **1. Birincil** | Altare = oyun stüdyosu | `index.html` — ana site. Oyunları ve şirketi anlatır. |
| **2. İkincil** | Altare Panel = AI live-ops hizmeti | **Sonradan** anlatılacak. Ana sitenin merkezine konmaz. |

Ana site **oyunları ve şirketi** anlatır. Panel sonradan girer.

---

## ⚠️ Bu karara karşı gelen yaygın öneriler — ve neden reddedildiler

Bunlar gerçekten gündeme geldi ve reddedildi. Tekrar gündeme gelirse cevap
hazır olsun diye yazıyorum.

### "Site yanlış ürünü satıyor, platformu öne çıkar"

**Reddedildi.** Gerekçe kulağa mantıklı geliyor: *"yatırımcı siteye girince
platformu görmeli."* Ama Altare'nin kimliği stüdyodur. Panel, o stüdyonun
kendi ihtiyacından doğan ve sonradan hizmete dönüşen bir üründür — kimliğin
kendisi değil.

Stüdyo kimliğini ikinci plana atmak iki şeyi birden kaybettirir: oyunların
oyuncu kitlesini ve panelin en güçlü kanıtını. *"Kendi oyunumuzda
kullanıyoruz"* ancak ortada gerçek bir oyun stüdyosu varken anlamlıdır.

### "Tamamen B2B SaaS sitesi yap, oyunlar referans satırı kalsın"

**Reddedildi.** Aynı gerekçe, daha sert hâli. Altare oyun yapmayı bırakmıyor.

### "İki ayrı alan adı / iki ayrı site"

**Şimdilik hayır.** Panel sonradan anlatılacak; bunun ana site içinde mi ayrı
bir sayfada mı olacağı o zaman verilecek bir karardır, şimdi değil.

---

## Pratik sonuçlar

Bu karar aşağıdakileri **bağlar**:

- `index.html` hero'su, hakkında bölümü ve menüsü **oyun stüdyosu** dilinde
  kalır. "AI platformu", "analitik", "SDK" ana sayfanın merkezine konmaz.
- Görsel yenileme = stüdyo sitesinin kalitesini yükseltmek. Konumlandırmayı
  değiştirmek **değil**.
- Panel tanıtımı geldiğinde ana sitenin kimliğini **ezmeyecek** biçimde
  konumlanır (ayrı sayfa / alt bölüm — kararı o zaman verilir).
- `panel.html` ve SDK dokümantasyonu zaten hizmet dilinde; onlar bu
  sınırın dışındadır.

---

## Ne DEĞİŞMEDİ

Panelin kendisi, SDK, yol haritası (`ALTARE_SCALE_ROADMAP.md`) ve teknik
hedeflerin hiçbiri bu karardan etkilenmez. Bu doküman yalnızca **kamuya
dönük anlatının** hangi kimlikle konuştuğunu sabitler.
