import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, Copy, Database, Eye, EyeOff, FileText, Heading,
  Image as ImageIcon, Italic, Layout, Loader2, Lock, MoveDown, MoveUp, Pilcrow, Plus, RotateCcw, Save, Square,
  Trash2, Type, Underline, Unlock,
} from "lucide-react";
import { api, ApiError } from "../../lib/api";
import { toast } from "../../store/toast";
import RichTextEditor from "../../components/RichTextEditor";

type Align = "left" | "center" | "right" | "justify";
type ElType = "text" | "heading" | "field" | "image" | "box" | "richtext";
interface El {
  id: string; type: ElType; x: number; y: number; w: number; h: number;
  visible?: boolean; text?: string; field?: string;
  size?: number; weight?: "normal" | "bold"; color?: string; align?: Align;
  bg?: string; borderW?: number; borderColor?: string; radius?: number; pad?: number;
  html?: string; font?: "sans" | "serif" | "mono"; italic?: boolean; underline?: boolean; lh?: number; opacity?: number; locked?: boolean;
  padT?: number; padR?: number; padB?: number; padL?: number; bT?: number; bR?: number; bB?: number; bL?: number; shadow?: boolean; widthMode?: "custom" | "full" | "inline"; imgW?: number; imgH?: number;
}
type PageKind = "stock" | "fixed";
type PageWhen = "first" | "rest" | "all";
interface Page { id: string; kind: PageKind; when?: PageWhen; bg?: string; elements: El[] }
interface Design { theme_color: string; pages: Page[] }
interface SampleData { company_name: string; registration: string; channel: string; platform: string; url: string; company_logo: string | null; channel_logo: string | null; stock: { stock_name: string; stock_symbol: string; short_name: string; date: string; analysis: string; chart: string | null } | null }

// Dynamic fields from the pipeline / template.
const TEXT_FIELDS: { key: string; label: string; sample: string; stockOnly?: boolean; multiline?: boolean }[] = [
  { key: "stock_name", label: "Stock name", sample: "Reliance Industries", stockOnly: true },
  { key: "stock_symbol", label: "Stock symbol", sample: "RELIANCE", stockOnly: true },
  { key: "short_name", label: "Short name", sample: "RELIANCE", stockOnly: true },
  { key: "date", label: "Call date", sample: "23-06-2026", stockOnly: true },
  { key: "analysis", label: "Analysis / rationale", sample: "Hold for 2 months, stoploss ₹1,250, target ₹1,475+…", stockOnly: true, multiline: true },
  { key: "company_name", label: "Company name", sample: "Acme Research Pvt. Ltd." },
  { key: "registration", label: "Registration", sample: "SEBI Reg: INH000000000" },
  { key: "channel", label: "Channel name", sample: "Money9" },
  { key: "platform", label: "Platform", sample: "YouTube" },
  { key: "url", label: "Video URL", sample: "youtu.be/abc123" },
  { key: "page_no", label: "Page number", sample: "Page 1" },
];
const IMAGE_FIELDS = [
  { key: "chart", label: "Stock chart", stockOnly: true },
  { key: "logo", label: "Company logo" },
  { key: "channel_logo", label: "Channel logo" },
];
const fieldSample = (k?: string) => TEXT_FIELDS.find((f) => f.key === k)?.sample ?? `{${k ?? "field"}}`;
const uid = () => Math.random().toString(36).slice(2, 10);

function blankPage(kind: PageKind = "stock"): Page { return { id: uid(), kind, when: kind === "stock" ? "all" : undefined, elements: [] }; }
function defaultDesign(): Design {
  const f = (type: ElType, x: number, y: number, w: number, h: number, extra: Partial<El>): El => ({ id: uid(), type, x, y, w, h, visible: true, ...extra });
  return {
    theme_color: "#6C4CF1",
    pages: [
      { id: uid(), kind: "stock", when: "first", elements: [
        f("box", 0, 0, 100, 9, { bg: "#6C4CF1" }),
        f("field", 4, 2, 55, 4, { field: "company_name", color: "#ffffff", size: 13.5, weight: "bold" }),
        f("field", 4, 6, 70, 2.5, { field: "registration", color: "#ffffff", size: 7.5 }),
        f("image", 86, 2, 10, 5, { field: "logo" }),
        f("field", 60, 12, 36, 4, { field: "date", color: "#111111", size: 11, weight: "bold", align: "right" }),
        f("field", 4, 18, 70, 5, { field: "stock_name", color: "#111111", size: 16, weight: "bold" }),
        f("field", 4, 23, 40, 4, { field: "stock_symbol", color: "#666666", size: 11 }),
        f("image", 4, 28, 92, 28, { field: "chart" }),
        f("heading", 4, 58, 50, 4, { text: "OUR GENERAL VIEW", color: "#6C4CF1", size: 11, weight: "bold" }),
        f("field", 4, 63, 92, 20, { field: "analysis", color: "#222222", size: 10.8, align: "justify" }),
        f("field", 8, 94, 30, 3, { field: "channel", color: "#6C4CF1", size: 9, weight: "bold" }),
        f("field", 44, 95, 12, 3, { field: "page_no", color: "#111111", size: 8.5, align: "center" }),
      ] },
      { id: uid(), kind: "stock", when: "rest", elements: [
        f("field", 4, 8, 70, 5, { field: "stock_name", color: "#111111", size: 16, weight: "bold" }),
        f("field", 4, 13, 40, 4, { field: "stock_symbol", color: "#666666", size: 11 }),
        f("image", 4, 20, 92, 32, { field: "chart" }),
        f("heading", 4, 55, 50, 4, { text: "OUR GENERAL VIEW", color: "#6C4CF1", size: 11, weight: "bold" }),
        f("field", 4, 60, 92, 24, { field: "analysis", color: "#222222", size: 10.8, align: "justify" }),
        f("field", 44, 95, 12, 3, { field: "page_no", color: "#111111", size: 8.5, align: "center" }),
      ] },
      { id: uid(), kind: "fixed", elements: [
        f("richtext", 4, 6, 92, 40, { html: "<h2>Disclaimer</h2><p>Investments are subject to market risks. Read all related documents carefully before investing.</p>", color: "#333333", size: 10 }),
        f("richtext", 4, 50, 92, 30, { html: "<h2>Disclosure</h2><p>The analyst holds no position in the securities discussed.</p>", color: "#333333", size: 10 }),
        f("heading", 60, 84, 36, 4, { text: "Authorised Signatory", color: "#444444", size: 11, weight: "bold" }),
      ] },
    ],
  };
}
const PAGE_W = 520, PAGE_H = Math.round(520 * 1.4142), PT = 520 / 595;
const ALIGN_ICON: Record<Align, typeof AlignLeft> = { left: AlignLeft, center: AlignCenter, right: AlignRight, justify: AlignJustify };
const TYPE_ICON: Record<ElType, typeof Type> = { text: Type, heading: Heading, richtext: Pilcrow, field: Database, image: ImageIcon, box: Square };
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export default function PdfTemplate() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["pdf-template"], queryFn: () => api.get<Record<string, unknown> | null>("/admin/pdf-template") });

  const [tab, setTab] = useState<"design" | "content">("design");
  const [pageIdx, setPageIdx] = useState(0);
  const [design, setDesign] = useState<Design>(defaultDesign);
  const [selId, setSelId] = useState<string | null>(null);
  const [content, setContent] = useState({ company_name: "", registration_details: "" });
  const drag = useRef<{ id: string; mode: "move" | "resize"; sx: number; sy: number; o: El } | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [guides, setGuides] = useState<{ v: number[]; h: number[] }>({ v: [], h: [] });
  const sampleQ = useQuery({ queryKey: ["pdf-sample"], queryFn: () => api.get<SampleData>("/admin/pdf-template/sample") });
  const sample = sampleQ.data;

  useEffect(() => {
    if (!data) return;
    setContent({
      company_name: (data.company_name as string) ?? "", registration_details: (data.registration_details as string) ?? "",
    });
    const d = data.design as (Partial<Design> & { stock_pages?: Page[]; fixed_pages?: Page[] }) | null;
    if (d?.pages?.length) {
      setDesign({ theme_color: d.theme_color || defaultDesign().theme_color, pages: d.pages });
    } else if (d && (d.stock_pages?.length || d.fixed_pages?.length)) {
      const pages: Page[] = [
        ...(d.stock_pages ?? []).map((p) => ({ ...p, kind: "stock" as PageKind, when: "all" as PageWhen })),
        ...(d.fixed_pages ?? []).map((p) => ({ ...p, kind: "fixed" as PageKind })),
      ];
      setDesign({ theme_color: d.theme_color || defaultDesign().theme_color, pages });
    } else if (d?.theme_color) {
      setDesign((cur) => ({ ...cur, theme_color: d.theme_color! }));
    }
  }, [data]);

  const pages = design.pages;
  const safeIdx = Math.min(pageIdx, Math.max(0, pages.length - 1));
  const page: Page | undefined = pages[safeIdx];
  const pageRef = useRef<Page | undefined>(page); pageRef.current = page;
  const sel = page?.elements.find((e) => e.id === selId) ?? null;

  const setPages = (fn: (p: Page[]) => Page[]) => setDesign((d) => ({ ...d, pages: fn(d.pages) }));
  const patchEl = (id: string, patch: Partial<El>) =>
    setPages((ps) => ps.map((p, i) => (i === safeIdx ? { ...p, elements: p.elements.map((e) => (e.id === id ? { ...e, ...patch } : e)) } : p)));
  const delEl = (id: string) => { setPages((ps) => ps.map((p, i) => (i === safeIdx ? { ...p, elements: p.elements.filter((e) => e.id !== id) } : p))); setSelId(null); };
  const dupEl = (el: El) => { const n = { ...el, id: uid(), x: Math.min(95, el.x + 2), y: Math.min(95, el.y + 2) }; setPages((ps) => ps.map((p, i) => (i === safeIdx ? { ...p, elements: [...p.elements, n] } : p))); setSelId(n.id); };
  const layer = (id: string, dir: 1 | -1) => setPages((ps) => ps.map((p, i) => { if (i !== safeIdx) return p; const arr = [...p.elements]; const k = arr.findIndex((e) => e.id === id); const j = k + dir; if (k < 0 || j < 0 || j >= arr.length) return p; [arr[k], arr[j]] = [arr[j], arr[k]]; return { ...p, elements: arr }; }));
  const alignPage = (el: El, which: string) => { const m: Record<string, Partial<El>> = { left: { x: 0 }, hcenter: { x: (100 - el.w) / 2 }, right: { x: 100 - el.w }, top: { y: 0 }, vcenter: { y: (100 - el.h) / 2 }, bottom: { y: 100 - el.h } }; patchEl(el.id, m[which]); };
  const addEl = (type: ElType) => {
    const base: El = { id: uid(), type, x: 30, y: 42, w: 40, h: 6, visible: true, color: "#111111", align: "left", font: "sans", opacity: 1,
      size: type === "heading" ? 16 : 11, weight: type === "heading" ? "bold" : "normal", pad: type === "box" || type === "image" ? 0 : 2 };
    if (type === "richtext") { base.html = "<p>Edit this <strong>rich</strong> text…</p>"; base.w = 60; base.h = 18; base.align = "left"; }
    if (type === "field") base.field = page?.kind !== "fixed" ? "stock_name" : "company_name";
    if (type === "image") { base.field = page?.kind !== "fixed" ? "chart" : "logo"; base.h = 24; }
    if (type === "box") { base.bg = design.theme_color; base.color = undefined; }
    if (type === "heading") base.text = "Heading";
    if (type === "text") base.text = "Text";
    setPages((ps) => ps.map((p, i) => (i === safeIdx ? { ...p, elements: [...p.elements, base] } : p)));
    setSelId(base.id);
  };
  const addPage = (kind: PageKind = "stock") => { setPages((ps) => [...ps, blankPage(kind)]); setPageIdx(design.pages.length); setSelId(null); };
  const dupPage = (i: number) => { setPages((ps) => { const src = ps[i]; const copy: Page = { ...src, id: uid(), elements: src.elements.map((e) => ({ ...e, id: uid() })) }; const a = [...ps]; a.splice(i + 1, 0, copy); return a; }); setPageIdx(i + 1); setSelId(null); };
  const delPage = (i: number) => { setPages((ps) => (ps.length > 1 ? ps.filter((_, k) => k !== i) : ps)); setPageIdx(0); setSelId(null); };
  const setPagePurpose = (i: number, kind: PageKind, when?: PageWhen) => setPages((ps) => ps.map((p, k) => (k === i ? { ...p, kind, when: kind === "stock" ? (when ?? p.when ?? "all") : undefined } : p)));

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const g = drag.current; if (!g || !canvasRef.current) return;
      const r = canvasRef.current.getBoundingClientRect();
      const dx = ((e.clientX - g.sx) / r.width) * 100, dy = ((e.clientY - g.sy) / r.height) * 100;
      if (g.mode === "move") {
        let nx = clamp(g.o.x + dx, 0, 100 - g.o.w), ny = clamp(g.o.y + dy, 0, 100 - g.o.h);
        const others = (pageRef.current?.elements ?? []).filter((el) => el.id !== g.id && el.visible !== false);
        const vc = [0, 50, 100], hc = [0, 50, 100];
        others.forEach((el) => { vc.push(el.x, el.x + el.w / 2, el.x + el.w); hc.push(el.y, el.y + el.h / 2, el.y + el.h); });
        const TH = 1.0; const gv: number[] = [], gh: number[] = [];
        let sx = false; for (const c of vc) { if (sx) break; for (const a of [nx, nx + g.o.w / 2, nx + g.o.w]) { if (Math.abs(a - c) <= TH) { nx += c - a; gv.push(c); sx = true; break; } } }
        let sy = false; for (const c of hc) { if (sy) break; for (const a of [ny, ny + g.o.h / 2, ny + g.o.h]) { if (Math.abs(a - c) <= TH) { ny += c - a; gh.push(c); sy = true; break; } } }
        nx = clamp(nx, 0, 100 - g.o.w); ny = clamp(ny, 0, 100 - g.o.h);
        patchEl(g.id, { x: nx, y: ny }); setGuides({ v: gv, h: gh });
      } else patchEl(g.id, { w: clamp(g.o.w + dx, 4, 100 - g.o.x), h: clamp(g.o.h + dy, 2, 100 - g.o.y) });
    };
    const up = () => { drag.current = null; setGuides({ v: [], h: [] }); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  }, [safeIdx]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!selId) return;
      const ae = document.activeElement as HTMLElement | null;
      if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.isContentEditable)) return;
      const map: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      const d = map[e.key]; if (!d) return;
      const el = pageRef.current?.elements.find((x) => x.id === selId); if (!el || el.locked) return;
      e.preventDefault(); const st = e.shiftKey ? 2 : 0.5;
      patchEl(selId, { x: clamp(el.x + d[0] * st, 0, 100 - el.w), y: clamp(el.y + d[1] * st, 0, 100 - el.h) });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selId, safeIdx]);

  const save = useMutation({
    mutationFn: () => api.put("/admin/pdf-template", { ...content, design }),
    onSuccess: () => { toast.success("PDF template saved"); qc.invalidateQueries({ queryKey: ["pdf-template"] }); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Could not save template"),
  });

  const selMeta = useMemo(() => (sel ? { isText: ["text", "heading", "field", "richtext"].includes(sel.type), isField: sel.type === "field", isImage: sel.type === "image", isBox: sel.type === "box", isRich: sel.type === "richtext" } : null), [sel]);
  const isStockPage = page?.kind !== "fixed";
  const fieldOpts = isStockPage ? TEXT_FIELDS : TEXT_FIELDS.filter((f) => !f.stockOnly);
  const imgOpts = isStockPage ? IMAGE_FIELDS : IMAGE_FIELDS.filter((f) => !f.stockOnly);
  const pageLabel = (p: Page) => (p.kind === "fixed" ? "Fixed" : p.when === "first" ? "Stock·1st" : p.when === "rest" ? "Stock·rest" : "Stock·all");
  const purposeValue = (p: Page) => (p.kind === "fixed" ? "fixed:" : `stock:${p.when ?? "all"}`);
  const previewText = (el: El): string => {
    if (el.type !== "field") return el.text ?? "";
    const k = el.field;
    if (k && ["stock_name", "stock_symbol", "short_name", "date", "analysis"].includes(k)) return (sample?.stock?.[k as keyof NonNullable<SampleData["stock"]>] as string) || fieldSample(k);
    if (k && ["company_name", "registration", "channel", "platform", "url"].includes(k)) return (sample?.[k as keyof SampleData] as string) || fieldSample(k);
    return fieldSample(k);
  };

  return (
    <div className="space-y-5">
      <style>{`.rte-preview h1,.rte-preview h2,.rte-preview h3{font-weight:700;margin:.15em 0;line-height:1.1}.rte-preview ul{list-style:disc;padding-left:1.1em;margin:.2em 0}.rte-preview ol{list-style:decimal;padding-left:1.1em;margin:.2em 0}.rte-preview p{margin:.2em 0}.rte-preview strong,.rte-preview b{font-weight:700}.rte-preview em,.rte-preview i{font-style:italic}.rte-preview u{text-decoration:underline}`}</style>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-700"><FileText size={20} /></span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">PDF Template Builder</h1>
            <p className="text-sm text-slate-500">Add pages, assign each a purpose (first stock / other stocks / fixed info), and drop dynamic pipeline fields anywhere.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-xl border border-slate-200 p-0.5">
            <button onClick={() => setTab("design")} className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium ${tab === "design" ? "bg-brand-50 text-brand-700" : "text-slate-500"}`}><Layout size={15} /> Design</button>
            <button onClick={() => setTab("content")} className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium ${tab === "content" ? "bg-brand-50 text-brand-700" : "text-slate-500"}`}><Type size={15} /> Content</button>
          </div>
          <button className="btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />} Save</button>
        </div>
      </div>

      {isLoading ? <div className="grid h-64 place-items-center"><Loader2 className="animate-spin text-slate-300" /></div> : tab === "design" ? (
        <>
          {/* Pages (one ordered list; each page is assigned a purpose) */}
          <div className="card flex flex-wrap items-center gap-3 p-3">
            <div className="flex flex-wrap items-center gap-1.5">
              {pages.map((p, i) => (
                <button key={p.id} onClick={() => { setPageIdx(i); setSelId(null); }}
                  className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs ${i === safeIdx ? "border-brand bg-brand-50 text-brand-700" : "border-slate-200 text-slate-500"}`}>
                  <span className="font-semibold">{i + 1}</span> {pageLabel(p)}
                </button>
              ))}
              <button onClick={() => addPage("stock")} className="inline-flex items-center gap-1 rounded-lg border border-dashed border-slate-300 px-2 py-1 text-xs text-slate-500 hover:border-brand hover:text-brand"><Plus size={12} /> Page</button>
            </div>
            {page && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-slate-200">|</span>
                <label className="text-xs text-slate-400">Purpose</label>
                <select className="input h-8 w-52 text-xs" value={purposeValue(page)} onChange={(e) => { const [k, w] = e.target.value.split(":"); setPagePurpose(safeIdx, k as PageKind, (w || undefined) as PageWhen | undefined); }}>
                  <option value="stock:first">Stock — first stock (with header)</option>
                  <option value="stock:rest">Stock — other stocks (no header)</option>
                  <option value="stock:all">Stock — every stock</option>
                  <option value="fixed:">Fixed info — after the stocks</option>
                </select>
                <button onClick={() => dupPage(safeIdx)} title="Duplicate this page" className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:border-brand hover:text-brand"><Copy size={12} /> Duplicate</button>
                {pages.length > 1 && <button onClick={() => delPage(safeIdx)} title="Delete page" className="grid h-7 w-7 place-items-center rounded-lg border border-slate-200 text-slate-400 hover:border-danger hover:text-danger"><Trash2 size={12} /></button>}
              </div>
            )}
            <span className="ml-auto text-xs text-slate-400">{page?.kind === "fixed" ? "Rendered once, after all stocks" : page?.when === "first" ? "Used for the FIRST stock only" : page?.when === "rest" ? "Used for stocks 2, 3, …" : "Used for EVERY stock"}</span>
          </div>

          <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
            {/* Canvas */}
            <div className="card flex flex-col items-center gap-3 overflow-auto p-6">
              <div className="flex flex-wrap justify-center gap-1.5">
                {(["heading", "text", "richtext", "field", "image", "box"] as ElType[]).map((t) => { const I = TYPE_ICON[t]; return (
                  <button key={t} onClick={() => addEl(t)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:border-brand hover:text-brand"><I size={13} /> {t === "field" ? "Field" : t === "richtext" ? "Rich text" : t[0].toUpperCase() + t.slice(1)}</button>
                ); })}
              </div>
              {!page ? <div className="grid h-40 place-items-center text-sm text-slate-400">No pages — add one above.</div> : (
                <div ref={canvasRef} onPointerDown={(e) => { if (e.target === canvasRef.current) setSelId(null); }}
                  className="relative shrink-0 bg-white shadow-lg ring-1 ring-slate-200" style={{ width: PAGE_W, height: PAGE_H, background: page.bg ?? "#ffffff" }}>
                  {page.elements.map((el) => {
                    if (el.visible === false) return null;
                    const isSel = selId === el.id;
                    const isImg = el.type === "image", isBox = el.type === "box";
                    const label = el.type === "field" ? previewText(el) : isImg ? `🖼 ${el.field}` : el.text ?? "";
                    const bT = el.bT ?? el.borderW ?? 0, bR = el.bR ?? el.borderW ?? 0, bB = el.bB ?? el.borderW ?? 0, bL = el.bL ?? el.borderW ?? 0;
                    const anyB = bT || bR || bB || bL;
                    const padCss = `${(el.padT ?? el.pad ?? 2) * PT}px ${(el.padR ?? el.pad ?? 2) * PT}px ${(el.padB ?? el.pad ?? 2) * PT}px ${(el.padL ?? el.pad ?? 2) * PT}px`;
                    const inline = el.widthMode === "inline";
                    const imgSrc = isImg ? (el.field === "chart" ? sample?.stock?.chart : el.field === "logo" ? sample?.company_logo : el.field === "channel_logo" ? sample?.channel_logo : null) : null;
                    return (
                      <div key={el.id} onPointerDown={(e) => { e.stopPropagation(); setSelId(el.id); if (!el.locked) drag.current = { id: el.id, mode: "move", sx: e.clientX, sy: e.clientY, o: el }; }}
                        className={`absolute cursor-move overflow-hidden ${isSel ? "outline outline-2 outline-brand" : "hover:outline hover:outline-1 hover:outline-brand/40"}`}
                        style={{
                          left: `${el.x}%`, top: `${el.y}%`, width: inline ? "auto" : `${el.w}%`, maxWidth: inline ? `${100 - el.x}%` : undefined, height: `${el.h}%`,
                          background: el.bg ?? (isImg ? "#eef2f7" : "transparent"),
                          ...(anyB ? { borderStyle: "solid", borderColor: el.borderColor ?? "#cccccc", borderTopWidth: bT, borderRightWidth: bR, borderBottomWidth: bB, borderLeftWidth: bL } : isImg ? { border: "1px dashed #cbd5e1" } : {}),
                          boxShadow: el.shadow ? "3px 3px 7px rgba(0,0,0,.22)" : undefined,
                          borderRadius: el.radius ? el.radius : undefined,
                          color: el.color, fontSize: (el.size ?? 10) * PT, fontWeight: el.weight === "bold" ? 700 : 400,
                          display: "flex", alignItems: isImg ? "center" : "flex-start",
                          justifyContent: isImg ? "center" : el.align === "center" ? "center" : el.align === "right" ? "flex-end" : "flex-start",
                          padding: padCss, lineHeight: 1.25,
                          textAlign: (el.align === "justify" ? "left" : el.align) as React.CSSProperties["textAlign"],
                        }}>
                        {el.type === "richtext"
                          ? <div className="rte-preview pointer-events-none w-full overflow-hidden" style={{ fontSize: (el.size ?? 11) * PT, opacity: el.opacity ?? 1 }} dangerouslySetInnerHTML={{ __html: el.html ?? "" }} />
                          : isImg && imgSrc
                          ? <img src={imgSrc} alt="" className="pointer-events-none object-contain" style={{ opacity: el.opacity ?? 1, width: `${el.imgW ?? 100}%`, height: `${el.imgH ?? 100}%` }} />
                          : <span className="pointer-events-none block w-full" style={{ whiteSpace: inline ? "nowrap" : "normal", overflowWrap: "anywhere", wordBreak: "break-word", overflow: "hidden", opacity: el.opacity ?? 1, fontStyle: el.italic ? "italic" : undefined, textDecoration: el.underline ? "underline" : undefined, color: isBox ? "rgba(255,255,255,.85)" : undefined }}>{label}</span>}
                        {isSel && <span onPointerDown={(e) => { e.stopPropagation(); if (!el.locked) drag.current = { id: el.id, mode: "resize", sx: e.clientX, sy: e.clientY, o: el }; }} className="absolute bottom-0 right-0 h-3.5 w-3.5 cursor-nwse-resize rounded-sm border-2 border-brand bg-white shadow" />}
                      </div>
                    );
                  })}
                  {guides.v.map((gx, i) => <div key={"v" + i} className="pointer-events-none absolute bottom-0 top-0 w-px bg-brand/70" style={{ left: `${gx}%` }} />)}
                  {guides.h.map((gy, i) => <div key={"h" + i} className="pointer-events-none absolute left-0 right-0 h-px bg-brand/70" style={{ top: `${gy}%` }} />)}
                  <div className="pointer-events-none absolute inset-[3.5%] border border-dashed border-slate-200" />
                  {sel && (
                    <div className="pointer-events-none absolute z-20 rounded bg-brand px-1.5 py-0.5 text-[9px] font-semibold text-white shadow"
                      style={{ left: `${sel.x}%`, top: `calc(${sel.y}% - 15px)` }}>{Math.round(sel.w)}% × {Math.round(sel.h)}%</div>
                  )}
                </div>
              )}
            </div>

            {/* Inspector */}
            <div className="card h-fit space-y-4 p-4">
              <div>
                <label className="label">Theme colour</label>
                <div className="flex items-center gap-2">
                  <input type="color" className="h-9 w-12 cursor-pointer rounded border border-slate-200" value={design.theme_color} onChange={(e) => setDesign((d) => ({ ...d, theme_color: e.target.value }))} />
                  <input className="input h-9" value={design.theme_color} onChange={(e) => setDesign((d) => ({ ...d, theme_color: e.target.value }))} />
                </div>
              </div>
              {page && (
                <div className="border-t border-slate-100 pt-3">
                  <label className="label">Page background</label>
                  <input type="color" className="h-9 w-full cursor-pointer rounded border border-slate-200" value={page.bg ?? "#ffffff"} onChange={(e) => setPages((ps) => ps.map((p, i) => (i === safeIdx ? { ...p, bg: e.target.value } : p)))} />
                </div>
              )}
              <div className="border-t border-slate-100 pt-3">
                {!sel || !selMeta ? <p className="text-sm text-slate-400">Add an element from the toolbar, then click it to style it. Drag to move, corner handle to resize.</p> : (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold capitalize text-slate-700">{sel.type}</span>
                      <div className="flex items-center gap-0.5">
                        <button title="Bring forward" onClick={() => layer(sel.id, 1)} className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 hover:bg-slate-100"><MoveUp size={14} /></button>
                        <button title="Send backward" onClick={() => layer(sel.id, -1)} className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 hover:bg-slate-100"><MoveDown size={14} /></button>
                        <button title="Duplicate" onClick={() => dupEl(sel)} className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 hover:bg-slate-100"><Copy size={14} /></button>
                        <button title={sel.locked ? "Unlock" : "Lock"} onClick={() => patchEl(sel.id, { locked: !sel.locked })} className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 hover:bg-slate-100">{sel.locked ? <Lock size={14} /> : <Unlock size={14} />}</button>
                        <button title={sel.visible === false ? "Show" : "Hide"} onClick={() => patchEl(sel.id, { visible: sel.visible === false })} className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 hover:bg-slate-100">{sel.visible === false ? <EyeOff size={14} /> : <Eye size={14} />}</button>
                        <button title="Delete" onClick={() => delEl(sel.id)} className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-danger"><Trash2 size={14} /></button>
                      </div>
                    </div>
                    {selMeta.isField && (
                      <div><label className="label">Dynamic field</label>
                        <select className="input h-9" value={sel.field ?? ""} onChange={(e) => patchEl(sel.id, { field: e.target.value })}>
                          {fieldOpts.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                        </select>
                        {["analysis", "disclaimer", "disclosure"].includes(sel.field ?? "") && (
                          <p className="mt-1 text-[11px] text-emerald-600">Rich text — overflow auto-continues onto new pages.</p>
                        )}
                      </div>
                    )}
                    {selMeta.isImage && (
                      <div><label className="label">Image source</label>
                        <select className="input h-9" value={sel.field ?? ""} onChange={(e) => patchEl(sel.id, { field: e.target.value })}>
                          {imgOpts.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                        </select></div>
                    )}
                    {(sel.type === "text" || sel.type === "heading") && (
                      <div><label className="label">Text</label><input className="input h-9" value={sel.text ?? ""} onChange={(e) => patchEl(sel.id, { text: e.target.value })} /></div>
                    )}
                    {selMeta.isText && (
                      <>
                        <div className="grid grid-cols-2 gap-2">
                          <div><label className="label">Size (pt)</label><input type="number" className="input h-9" value={sel.size ?? 10} onChange={(e) => patchEl(sel.id, { size: Number(e.target.value) })} /></div>
                          <div><label className="label">Weight</label><select className="input h-9" value={sel.weight ?? "normal"} onChange={(e) => patchEl(sel.id, { weight: e.target.value as "normal" | "bold" })}><option value="normal">Normal</option><option value="bold">Bold</option></select></div>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div><label className="label">Colour</label><input type="color" className="h-9 w-full cursor-pointer rounded border border-slate-200" value={sel.color ?? "#000000"} onChange={(e) => patchEl(sel.id, { color: e.target.value })} /></div>
                          <div><label className="label">Align</label>
                            <div className="flex gap-1">{(["left", "center", "right", "justify"] as Align[]).map((a) => { const I = ALIGN_ICON[a]; return (
                              <button key={a} onClick={() => patchEl(sel.id, { align: a })} className={`grid h-9 flex-1 place-items-center rounded-lg border ${sel.align === a ? "border-brand bg-brand-50 text-brand-700" : "border-slate-200 text-slate-500"}`}><I size={13} /></button>
                            ); })}</div>
                          </div>
                        </div>
                      </>
                    )}
                    <div><label className="label">Background</label><div className="flex gap-2"><input type="color" className="h-9 w-full cursor-pointer rounded border border-slate-200" value={sel.bg ?? "#ffffff"} onChange={(e) => patchEl(sel.id, { bg: e.target.value })} /><button className="btn-ghost h-9 px-2 text-xs" onClick={() => patchEl(sel.id, { bg: undefined })}>None</button></div></div>
                    <div>
                      <label className="label">Inner padding (T R B L)</label>
                      <div className="grid grid-cols-4 gap-2">
                        {(["padT", "padR", "padB", "padL"] as const).map((k) => (
                          <input key={k} type="number" className="input h-9" value={sel[k] ?? sel.pad ?? 2} onChange={(e) => patchEl(sel.id, { [k]: Number(e.target.value) } as Partial<El>)} />
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="label">Border (T R B L)</label>
                      <div className="grid grid-cols-4 gap-2">
                        {(["bT", "bR", "bB", "bL"] as const).map((k) => (
                          <input key={k} type="number" className="input h-9" value={sel[k] ?? sel.borderW ?? 0} onChange={(e) => patchEl(sel.id, { [k]: Number(e.target.value) } as Partial<El>)} />
                        ))}
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div><label className="label">B.colour</label><input type="color" className="h-9 w-full cursor-pointer rounded border border-slate-200" value={sel.borderColor ?? "#cccccc"} onChange={(e) => patchEl(sel.id, { borderColor: e.target.value })} /></div>
                      <div><label className="label">Radius</label><input type="number" className="input h-9" value={sel.radius ?? 0} onChange={(e) => patchEl(sel.id, { radius: Number(e.target.value) })} /></div>
                      <div><label className="label">Shadow</label><button onClick={() => patchEl(sel.id, { shadow: !sel.shadow })} className={`h-9 w-full rounded-lg border text-xs ${sel.shadow ? "border-brand bg-brand-50 text-brand-700" : "border-slate-200 text-slate-500"}`}>{sel.shadow ? "On" : "Off"}</button></div>
                    </div>
                    <div>
                      <label className="label">Width</label>
                      <div className="flex gap-1">
                        {(["custom", "full", "inline"] as const).map((m) => (
                          <button key={m} onClick={() => (m === "full" ? patchEl(sel.id, { widthMode: "full", x: 0, w: 100 }) : patchEl(sel.id, { widthMode: m }))} className={`flex-1 rounded-lg border px-2 py-1.5 text-xs capitalize ${(sel.widthMode ?? "custom") === m ? "border-brand bg-brand-50 text-brand-700" : "border-slate-200 text-slate-500"}`}>{m}</button>
                        ))}
                      </div>
                    </div>
                    {selMeta.isImage && (
                      <div className="grid grid-cols-2 gap-2">
                        <div><label className="label">Image W %</label><input type="number" className="input h-9" value={sel.imgW ?? 100} onChange={(e) => patchEl(sel.id, { imgW: Number(e.target.value) })} /></div>
                        <div><label className="label">Image H %</label><input type="number" className="input h-9" value={sel.imgH ?? 100} onChange={(e) => patchEl(sel.id, { imgH: Number(e.target.value) })} /></div>
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-2">
                      <div><label className="label">Opacity</label><input type="range" min={0} max={1} step={0.05} className="h-9 w-full" value={sel.opacity ?? 1} onChange={(e) => patchEl(sel.id, { opacity: Number(e.target.value) })} /></div>
                      <div><label className="label">Line height</label><input type="number" step={0.05} className="input h-9" value={sel.lh ?? 1.34} onChange={(e) => patchEl(sel.id, { lh: Number(e.target.value) })} /></div>
                    </div>
                    {selMeta.isText && (
                      <div className="grid grid-cols-2 gap-2">
                        <div><label className="label">Font</label><select className="input h-9" value={sel.font ?? "sans"} onChange={(e) => patchEl(sel.id, { font: e.target.value as "sans" | "serif" | "mono" })}><option value="sans">Sans</option><option value="serif">Serif</option><option value="mono">Mono</option></select></div>
                        {!selMeta.isRich && (
                          <div><label className="label">Style</label>
                            <div className="flex gap-1">
                              <button title="Bold" onClick={() => patchEl(sel.id, { weight: sel.weight === "bold" ? "normal" : "bold" })} className={`grid h-9 flex-1 place-items-center rounded-lg border ${sel.weight === "bold" ? "border-brand bg-brand-50 text-brand-700" : "border-slate-200 text-slate-500"}`}><Bold size={13} /></button>
                              <button title="Italic" onClick={() => patchEl(sel.id, { italic: !sel.italic })} className={`grid h-9 flex-1 place-items-center rounded-lg border ${sel.italic ? "border-brand bg-brand-50 text-brand-700" : "border-slate-200 text-slate-500"}`}><Italic size={13} /></button>
                              <button title="Underline" onClick={() => patchEl(sel.id, { underline: !sel.underline })} className={`grid h-9 flex-1 place-items-center rounded-lg border ${sel.underline ? "border-brand bg-brand-50 text-brand-700" : "border-slate-200 text-slate-500"}`}><Underline size={13} /></button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                    <div>
                      <label className="label">Position &amp; size (%)</label>
                      <div className="grid grid-cols-4 gap-2">
                        {(["x", "y", "w", "h"] as const).map((k) => (
                          <input key={k} type="number" className="input h-9" title={k.toUpperCase()} value={Math.round((sel[k] ?? 0) * 10) / 10} onChange={(e) => patchEl(sel.id, { [k]: clamp(Number(e.target.value), 0, 100) })} />
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="label">Align to page</label>
                      <div className="flex gap-1">
                        {([["left", AlignLeft], ["hcenter", AlignCenter], ["right", AlignRight]] as const).map(([w2, I]) => (
                          <button key={w2} onClick={() => alignPage(sel, w2)} className="grid h-8 flex-1 place-items-center rounded-lg border border-slate-200 text-slate-500 hover:border-brand hover:text-brand"><I size={13} /></button>
                        ))}
                        <button onClick={() => alignPage(sel, "top")} className="h-8 flex-1 rounded-lg border border-slate-200 text-[11px] text-slate-500 hover:border-brand hover:text-brand">Top</button>
                        <button onClick={() => alignPage(sel, "vcenter")} className="h-8 flex-1 rounded-lg border border-slate-200 text-[11px] text-slate-500 hover:border-brand hover:text-brand">Mid</button>
                        <button onClick={() => alignPage(sel, "bottom")} className="h-8 flex-1 rounded-lg border border-slate-200 text-[11px] text-slate-500 hover:border-brand hover:text-brand">Bot</button>
                      </div>
                    </div>
                    {selMeta.isRich && (
                      <div><label className="label">Rich content</label><RichTextEditor value={sel.html ?? ""} onChange={(html) => patchEl(sel.id, { html })} /></div>
                    )}
                  </div>
                )}
              </div>
              <button className="btn-ghost w-full" onClick={() => { setDesign(defaultDesign()); setSelId(null); setPageIdx(0); }}><RotateCcw size={15} /> Reset design</button>
            </div>
          </div>
        </>
      ) : (
        <div className="space-y-5">
          <div className="card p-6"><label className="label">Company Name</label><input className="input" value={content.company_name} onChange={(e) => setContent((s) => ({ ...s, company_name: e.target.value }))} placeholder="e.g. Acme Research Pvt. Ltd." /></div>
          {([["registration_details", "Registration Details", "SEBI registration number, validity, etc. Shown via the {registration} field."]] as const).map(([k, label, help]) => (
            <div key={k} className="card p-6"><label className="label">{label}</label><p className="mb-2 text-xs text-slate-400">{help}</p><RichTextEditor value={content[k]} onChange={(html) => setContent((s) => ({ ...s, [k]: html }))} /></div>
          ))}
          <p className="px-1 text-xs text-slate-400">Disclaimer, disclosure and any other notices are now designed directly on the <span className="font-medium">Fixed info</span> pages using rich-text elements.</p>
        </div>
      )}
    </div>
  );
}
