// Build the download filename "<channel>-<dd-mm-yyyy>-<HH-MM>[-signed].pdf",
// matching the server-generated PDF name.
interface JobLike {
  platform_name?: string | null;
  title?: string | null;
  video_date?: string | null;
  video_time?: string | null;
}

function fmtDate(d?: string | null): string {
  if (!d) return "";
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : d;
}

export function pdfFileName(job: JobLike, signed = false): string {
  const chan = job.platform_name || job.title || "rationale";
  const time = (job.video_time || "").slice(0, 5).replace(":", "-");
  const base = [chan, fmtDate(job.video_date), time].filter(Boolean).join("-").replace(/[^\w.-]+/g, "_");
  return `${base}${signed ? "-signed" : ""}.pdf`;
}
