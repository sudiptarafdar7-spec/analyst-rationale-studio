import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, Eye, EyeOff, FileText, Layout, Loader2,
  RotateCcw, Save, Type,
} from "lucide-react";
import { api, ApiError } from "../../lib/api";
import { toast } from "../../store/toast";
import RichTextEditor from "../../components/RichTextEditor";

type Align = "left" | "center" | "right" | "justify";
interface ElStyle {
  x: number; y: number; w: number; h: number; // percentages of the A4 page
  visible?: boolean; text?: string; subtext?: string;
  size?: number; weight?: "normal" | "bold"; color?: string; align?: Align;
  bg?: string; borderW?: number; borderColor?: string; radius?: number;
}
interface Design { theme_color: string; elements: Record<string, ElStyle> }

interface ElDef { key: string; label: string; hasText?: boolean; hasBg?: boolean; hasBorder?: boolean; sample?: string }
const ELEMENTS: ElDef[] = [
  { key: "header", label: "Header band", hasBg: true },
  { key: "company_name", label: "Company name", hasText: true, sample: "Acme Research Pvt. Ltd." },
  { key: "registration", label: "Registration line", hasText: true, sample: "SEBI Reg: INH000000000" },
  { key: "logo", label: "Company logo", hasBorder: true },
  { key: "date", label: "Date", hasText: true, sample: "Date: 28-06-2026" },
  { key: "title", label: "Stock title", hasText: true, sample: "Reliance Industries (RELIANCE)" },
  { key: "chart", label: "Chart image", hasBorder: true },
  { key: "overview_label", label: "Overview heading", hasText: true, sample: "OUR GENERAL VIEW" },
  { key: "overview_text", label: "Overview / analysis", hasText: true, sample: "Hold for 2 months, stoploss ₹1,250, target ₹1,475+. The stock is showing strength above its 50-DMA…" },
  { key: "footer_channel", label: "Footer · channel", hasText: true, sample: "Money9" },
  { key: "footer_platform", label: "Footer · platform", hasText: true, sample: "YouTube" },
  { key: "footer_url", label: "Footer · URL", hasText: true, sample: "youtu.be/abc123" },
  { key: "footer_pageno", label: "Footer · page no.", hasText: true, sample: "Page 1" },
  { key: "disclaimer", label: "Disclaimer block", hasText: true, sample: "Investments are subject to market risks…" },
  { key: "disclosure", label: "Disclosure block", hasText: true, sample: "The analyst holds no position…" },
  { key: "sign_area", label: "Sign area", hasText: true, sample: "Authorised Signatory" },
];

function defaultDesign(): Design {
  return {
    theme_color: "#6C4CF1",
    elements: {
      header: { x: 0, y: 0, w: 100, h: 9, visible: true, bg: "#6C4CF1" },
      company_name: { x: 4, y: 2, w: 55, h: 4, visible: true, text: "Acme Research Pvt. Ltd.", color: "#ffffff", size: 13.5, weight: "bold", align: "left" },
      registration: { x: 4, y: 6, w: 70, h: 2.5, visible: true, text: "SEBI Reg: INH000000000", color: "#ffffff", size: 7.5, align: "left" },
      logo: { x: 86, y: 2, w: 10, h: 5, visible: true, borderW: 0, borderColor: "#ffffff" },
      date: { x: 60, y: 12, w: 36, h: 4, visible: true, text: "Date: 28-06-2026", color: "#111111", size: 11, weight: "bold", align: "right" },
      title: { x: 4, y: 18, w: 70, h: 5, visible: true, text: "Reliance Industries (RELIANCE)", color: "#111111", size: 16, weight: "bold", align: "left" },
      chart: { x: 4, y: 24, w: 92, h: 28, visible: true, borderW: 0, borderColor: "#cccccc" },
      overview_label: { x: 4, y: 54, w: 50, h: 4, visible: true, text: "OUR GENERAL VIEW", color: "#6C4CF1", size: 11, weight: "bold", align: "left" },
      overview_text: { x: 4, y: 59, w: 92, h: 18, visible: true, text: "Hold for 2 months, stoploss ₹1,250, target ₹1,475+. The stock is showing strength above its 50-DMA…", color: "#222222", size: 10.8, align: "justify" },
      footer_channel: { x: 8, y: 94, w: 30, h: 3, visible: true, text: "Money9", color: "#6C4CF1", size: 9, weight: "bold", align: "left" },
      footer_platform: { x: 8, y: 96.5, w: 30, h: 2.5, visible: true, text: "YouTube", color: "#666666", size: 8, align: "left" },
      footer_url: { x: 64, y: 95, w: 32, h: 3, visible: true, text: "youtu.be/abc123", color: "#444444", size: 7, align: "right" },
      footer_pageno: { x: 44, y: 95.5, w: 12, h: 3, visible: true, text: "Page 1", color: "#111111", size: 8.5, align: "center" },
      disclaimer: { x: 4, y: 80, w: 92, h: 6, visible: true, text: "Investments are subject to market risks…", color: "#333333", size: 9, align: "justify" },
      disclosure: { x: 4, y: 87, w: 92, h: 5, visible: true, text: "The analyst holds no position…", color: "#333333", size: 9, align: "justify" },
      sign_area: { x: 62, y: 80, w: 34, h: 8, visible: false, text: "Authorised Signatory", subtext: "Signature & Date", color: "#444444", size: 10, align: "left" },
    },
  };
}

const PAGE_W = 480; // px; A4 ratio 1:1.4142
const PAGE_H = Math.round(PAGE_W * 1.4142);
const PT_SCALE = PAGE_W / 595; // 595pt = A4 width
const ALIGN_ICON: Record<Align, typeof AlignLeft> = { left: AlignLeft, center: AlignCenter, right: AlignRight, justify: AlignJustify };

export default function PdfTemplate() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["pdf-template"], queryFn: () => api.get<Record<string, unknown> | null>("/admin/pdf-template") });

  const [tab, setTab] = useState<"design" | "content">("design");
  const [design, setDesign] = useState<Design>(defaultDesign);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState({ company_name: "", registration_details: "", disclaimer_text: "", disclosure_text: "", company_data: "" });
  const drag = useRef<{ key: string; mode: "move" | "resize"; sx: number; sy: number; o: ElStyle } | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!data) return;
    setContent({
      company_name: (data.company_name as string) ?? "",
      registration_details: (data.registration_details as string) ?? "",
      disclaimer_text: (data.disclaimer_text as string) ?? "",
      disclosure_text: (data.disclosure_text as string) ?? "",
      company_data: (data.company_data as string) ?? "",
    });
    const d = data.design as Design | null;
    if (d && d.elements) {
      const base = defaultDesign();
      setDesign({ theme_color: d.theme_color || base.theme_color, elements: { ...base.elements, ...d.elements } });
    }
  }, [data]);

  const save = useMutation({
    mutationFn: () => api.put("/admin/pdf-template", { ...content, design }),
    onSuccess: () => { toast.success("PDF template saved"); qc.invalidateQueries({ queryKey: ["pdf-template"] }); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Could not save template"),
  });

  const patchEl = (key: string, patch: Partial<ElStyle>) =>
    setDesign((d) => ({ ...d, elements: { ...d.elements, [key]: { ...d.elements[key], ...patch } } }));

  // drag / resize
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const g = drag.current; if (!g || !canvasRef.current) return;
      const r = canvasRef.current.getBoundingClientRect();
      const dx = ((e.clientX - g.sx) / r.width) * 100;
      const dy = ((e.clientY - g.sy) / r.height) * 100;
      if (g.mode === "move") {
        patchEl(g.key, { x: clamp(g.o.x + dx, 0, 100 - g.o.w), y: clamp(g.o.y + dy, 0, 100 - g.o.h) });
      } else {
        patchEl(g.key, { w: clamp(g.o.w + dx, 4, 100 - g.o.x), h: clamp(g.o.h + dy, 2, 100 - g.o.y) });
      }
    };
    const up = () => { drag.current = null; };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  }, []);

  const meta = useMemo(() => ELEMENTS.find((e) => e.key === selected), [selected]);
  const sel = selected ? design.elements[selected] : null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-700"><FileText size={20} /></span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">PDF Template Builder</h1>
            <p className="text-sm text-slate-500">Drag, resize and style every part of the compliance PDF. Colours, fonts and the layout drive the generated report.</p>
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
        <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
          {/* Canvas */}
          <div className="card flex justify-center overflow-auto p-6">
            <div ref={canvasRef} onPointerDown={(e) => { if (e.target === canvasRef.current) setSelected(null); }}
              className="relative shrink-0 bg-white shadow-lg ring-1 ring-slate-200"
              style={{ width: PAGE_W, height: PAGE_H }}>
              {ELEMENTS.map((def) => {
                const el = design.elements[def.key]; if (!el || el.visible === false) return null;
                const isSel = selected === def.key;
                const isChart = def.key === "chart"; const isLogo = def.key === "logo";
                return (
                  <div key={def.key}
                    onPointerDown={(e) => { e.stopPropagation(); setSelected(def.key); drag.current = { key: def.key, mode: "move", sx: e.clientX, sy: e.clientY, o: el }; }}
                    className={`absolute cursor-move overflow-hidden ${isSel ? "outline outline-2 outline-brand" : "hover:outline hover:outline-1 hover:outline-brand/40"}`}
                    style={{
                      left: `${el.x}%`, top: `${el.y}%`, width: `${el.w}%`, height: `${el.h}%`,
                      background: def.hasBg ? el.bg : isChart || isLogo ? "#f1f5f9" : "transparent",
                      border: (el.borderW ?? 0) > 0 ? `${el.borderW}px solid ${el.borderColor}` : isChart || isLogo ? "1px dashed #cbd5e1" : undefined,
                      borderRadius: el.radius ? `${el.radius}px` : undefined,
                      color: el.color, fontSize: (el.size ?? 10) * PT_SCALE,
                      fontWeight: el.weight === "bold" ? 700 : 400,
                      textAlign: (el.align === "justify" ? "left" : el.align) as React.CSSProperties["textAlign"],
                      display: "flex", alignItems: isChart || isLogo ? "center" : "flex-start",
                      justifyContent: isChart || isLogo ? "center" : el.align === "center" ? "center" : el.align === "right" ? "flex-end" : "flex-start",
                      padding: "1px 3px", lineHeight: 1.25,
                    }}>
                    <span className="pointer-events-none block w-full truncate-none" style={{ whiteSpace: def.key === "overview_text" || def.key.startsWith("disclaim") || def.key.startsWith("disclos") ? "normal" : "nowrap", overflow: "hidden" }}>
                      {isChart ? "📈 Chart" : isLogo ? "LOGO" : el.text ?? def.sample}
                    </span>
                    {isSel && (
                      <span onPointerDown={(e) => { e.stopPropagation(); drag.current = { key: def.key, mode: "resize", sx: e.clientX, sy: e.clientY, o: el }; }}
                        className="absolute bottom-0 right-0 h-3 w-3 cursor-nwse-resize bg-brand" style={{ borderRadius: 2 }} />
                    )}
                  </div>
                );
              })}
            </div>
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
            <div className="border-t border-slate-100 pt-3">
              {!sel || !meta ? (
                <p className="text-sm text-slate-400">Select an element on the page to style it. Drag to move, use the corner handle to resize.</p>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-slate-700">{meta.label}</span>
                    <button onClick={() => patchEl(selected!, { visible: sel.visible === false ? true : false })}
                      className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-slate-500 hover:bg-slate-100">
                      {sel.visible === false ? <><EyeOff size={13} /> Hidden</> : <><Eye size={13} /> Visible</>}
                    </button>
                  </div>
                  {meta.hasText && (
                    <div>
                      <label className="label">Text</label>
                      <input className="input h-9" value={sel.text ?? ""} onChange={(e) => patchEl(selected!, { text: e.target.value })} />
                      {selected === "sign_area" && <input className="input mt-1.5 h-9" value={sel.subtext ?? ""} placeholder="Sub-text" onChange={(e) => patchEl(selected!, { subtext: e.target.value })} />}
                    </div>
                  )}
                  {meta.hasText && (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        <div><label className="label">Size (pt)</label><input type="number" className="input h-9" value={sel.size ?? 10} onChange={(e) => patchEl(selected!, { size: Number(e.target.value) })} /></div>
                        <div><label className="label">Weight</label>
                          <select className="input h-9" value={sel.weight ?? "normal"} onChange={(e) => patchEl(selected!, { weight: e.target.value as "normal" | "bold" })}><option value="normal">Normal</option><option value="bold">Bold</option></select>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div><label className="label">Colour</label><input type="color" className="h-9 w-full cursor-pointer rounded border border-slate-200" value={sel.color ?? "#000000"} onChange={(e) => patchEl(selected!, { color: e.target.value })} /></div>
                        <div><label className="label">Align</label>
                          <div className="flex gap-1">
                            {(["left", "center", "right", "justify"] as Align[]).map((a) => { const I = ALIGN_ICON[a]; return (
                              <button key={a} onClick={() => patchEl(selected!, { align: a })} className={`grid h-9 flex-1 place-items-center rounded-lg border ${sel.align === a ? "border-brand bg-brand-50 text-brand-700" : "border-slate-200 text-slate-500"}`}><I size={14} /></button>
                            ); })}
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                  {meta.hasBg && (
                    <div><label className="label">Background</label><input type="color" className="h-9 w-full cursor-pointer rounded border border-slate-200" value={sel.bg ?? "#6C4CF1"} onChange={(e) => patchEl(selected!, { bg: e.target.value })} /></div>
                  )}
                  {meta.hasBorder && (
                    <div className="grid grid-cols-3 gap-2">
                      <div><label className="label">Border</label><input type="number" className="input h-9" value={sel.borderW ?? 0} onChange={(e) => patchEl(selected!, { borderW: Number(e.target.value) })} /></div>
                      <div><label className="label">Colour</label><input type="color" className="h-9 w-full cursor-pointer rounded border border-slate-200" value={sel.borderColor ?? "#cccccc"} onChange={(e) => patchEl(selected!, { borderColor: e.target.value })} /></div>
                      <div><label className="label">Radius</label><input type="number" className="input h-9" value={sel.radius ?? 0} onChange={(e) => patchEl(selected!, { radius: Number(e.target.value) })} /></div>
                    </div>
                  )}
                </div>
              )}
            </div>
            <button className="btn-ghost w-full" onClick={() => { setDesign(defaultDesign()); setSelected(null); }}><RotateCcw size={15} /> Reset design</button>
            <p className="text-[11px] text-slate-400">Phase 1: colours, typography, chart border/size, footer fields, the overview heading and the sign area drive the PDF. Free positions are saved for the preview.</p>
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="card p-6"><label className="label">Company Name</label>
            <input className="input" value={content.company_name} onChange={(e) => setContent((s) => ({ ...s, company_name: e.target.value }))} placeholder="e.g. Acme Research Pvt. Ltd." /></div>
          {([["registration_details", "Registration Details", "SEBI registration number, validity, etc. Shown on the letterhead."],
             ["disclaimer_text", "Disclaimer", "Standard disclaimer printed on the report."],
             ["disclosure_text", "Disclosure", "Analyst / firm disclosures."],
             ["company_data", "Company Data", "Contact details (JSON) and any extra footer info."]] as const).map(([k, label, help]) => (
            <div key={k} className="card p-6">
              <label className="label">{label}</label>
              <p className="mb-2 text-xs text-slate-400">{help}</p>
              <RichTextEditor value={content[k]} onChange={(html) => setContent((s) => ({ ...s, [k]: html }))} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }
