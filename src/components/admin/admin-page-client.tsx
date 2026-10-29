"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AdminApi, AdminApiError, CONDITION_IMAGE_LIMIT, validateConditionImages, type ConditionPurpose } from "./adapters/admin-api";
import type { AdminLaptop, AdminRental, AdminSetting, AuditEvent, EvidenceSummary, FinancialSummary, InspectionSummary, LaptopInput, RentalCommand } from "./adapters/types";
import { PageHeading, adminStyles as styles, useAdminContext } from "./admin-shell";
import { CommandPanel } from "./command-panel";
import { SecureEvidenceViewer } from "./secure-evidence-viewer";
import { StatusBadge } from "./status-badge";

export type AdminPageKind = "dashboard" | "inventory" | "rentals" | "detail" | "inspections" | "finance" | "settings" | "audit";

export function AdminPageClient({ kind, rentalId }: { kind: AdminPageKind; rentalId?: string }) {
  const api = useMemo(() => new AdminApi(), []);
  const [rentals, setRentals] = useState<AdminRental[]>([]);
  const [laptops, setLaptops] = useState<AdminLaptop[]>([]);
  const [rental, setRental] = useState<AdminRental>();
  const [inspections, setInspections] = useState<InspectionSummary[]>([]);
  const [settings, setSettings] = useState<AdminSetting[]>([]);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState<string>();

  const load = useCallback(async () => {
    setBusy(true); setMessage(undefined);
    try {
      if (kind === "dashboard") { const [r, l] = await Promise.all([api.listRentals(), api.listLaptops()]); setRentals(r); setLaptops(l); }
      if (["rentals", "inspections", "finance"].includes(kind)) setRentals(await api.listRentals());
      if (kind === "inventory") setLaptops(await api.listLaptops(true));
      if (kind === "detail" && rentalId) { const current = await api.getRental(rentalId); setRental(current); if (["PREPARING", "INSPECTION_PENDING"].includes(current.status)) setInspections(await api.listInspections(rentalId)); }
      if (kind === "settings") setSettings(await api.listSettings());
      if (kind === "audit") setAudit(await api.listAudit());
    } catch (error) { setMessage(errorMessage(error)); }
    finally { setBusy(false); }
  }, [api, kind, rentalId]);
  // Fetch is the external system synchronized by this effect.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  if (busy) return <p role="status">กำลังโหลดข้อมูลจาก server…</p>;
  return <>{message ? <div className={styles.error} role="alert">{message} <button type="button" onClick={() => void load()}>ลองอีกครั้ง</button></div> : null}
    {kind === "dashboard" ? <Dashboard rentals={rentals} laptops={laptops} /> : null}
    {kind === "inventory" ? <Inventory api={api} items={laptops} refresh={load} report={setMessage} /> : null}
    {kind === "rentals" ? <Rentals items={rentals} /> : null}
    {kind === "detail" && rental ? <RentalDetail api={api} rental={rental} inspections={inspections} refresh={load} report={setMessage} /> : null}
    {kind === "inspections" ? <Queue title="งานตรวจสภาพ" items={rentals.filter((item) => ["PREPARING", "INSPECTION_PENDING"].includes(item.status))} /> : null}
    {kind === "finance" ? <Finance api={api} items={rentals} refresh={load} report={setMessage} /> : null}
    {kind === "settings" ? <Settings api={api} items={settings} refresh={load} report={setMessage} /> : null}
    {kind === "audit" ? <Audit items={audit} /> : null}
  </>;
}

function Dashboard({ rentals, laptops }: { rentals: AdminRental[]; laptops: AdminLaptop[] }) {
  return <><PageHeading eyebrow="Operations overview" title="ศูนย์ควบคุมงานเช่า">ข้อมูลจริงจาก API ตามสิทธิ์ของ session ปัจจุบัน</PageHeading><div className={styles.grid}>
    <Metric label="รอตรวจเอกสาร" value={rentals.filter((r) => r.status === "PENDING_REVIEW").length} href="/admin/rentals" />
    <Metric label="กำลังเตรียม/ใช้งาน" value={rentals.filter((r) => ["PREPARING", "ACTIVE"].includes(r.status)).length} href="/admin/inspections" />
    <Metric label="เครื่องพร้อมเช่า" value={laptops.filter((l) => l.status === "AVAILABLE").length} href="/admin/inventory" />
  </div></>;
}
function Metric({ label, value, href }: { label: string; value: number; href: "/admin/rentals" | "/admin/inspections" | "/admin/inventory" }) { return <section className={styles.card}><div className={styles.muted}>{label}</div><div className={styles.metric}>{value}</div><Link href={href}>เปิดรายการ</Link></section>; }

function Rentals({ items }: { items: AdminRental[] }) {
  return <><PageHeading eyebrow="Review queue" title="รายการเช่า">สถานะและผลตรวจมาจาก server</PageHeading><div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>รายการ</th><th>ลูกค้า</th><th>ช่วงเช่า</th><th>สถานะ</th><th>ตรวจสอบ</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td><a href={`/admin/rentals/${item.id}`}><strong>#{item.id.slice(0, 8)}</strong></a></td><td>{item.customerSummary.displayName}<div className={styles.muted}>{item.customerSummary.phoneMasked}</div></td><td>{item.startDate} – {item.endDate}</td><td><StatusBadge tone={item.status === "PENDING_REVIEW" ? "warning" : "default"}>{item.status}</StatusBadge></td><td>KYC {item.reviewSummary.kycStatus}<br />Payment {item.reviewSummary.paymentStatus}</td></tr>)}</tbody></table></div></>;
}
function Queue({ title, items }: { title: string; items: AdminRental[] }) { return <><PageHeading eyebrow="Server queue" title={title}>เปิดแต่ละรายการเพื่อบันทึกหลักฐานแบบ append-only</PageHeading><Rentals items={items} /></>; }

function Inventory({ api, items, refresh, report }: { api: AdminApi; items: AdminLaptop[]; refresh: () => Promise<void>; report: (v?: string) => void }) {
  const context = useAdminContext();
  const [editing, setEditing] = useState<AdminLaptop>(); const [name, setName] = useState(""); const [daily, setDaily] = useState(""); const [deposit, setDeposit] = useState(""); const [specs, setSpecs] = useState("");
  const [reason, setReason] = useState(""); const [productImage, setProductImage] = useState<File>(); const [altText, setAltText] = useState(""); const [busy, setBusy] = useState(false);
  const input = (): LaptopInput => ({ name: name.trim(), specs: { ...editing?.specs, description: specs.trim() }, dailyRateSatang: Number(daily), depositSatang: Number(deposit) });
  async function run(work: () => Promise<unknown>) { setBusy(true); try { await work(); reset(); await refresh(); } catch (error) { report(errorMessage(error)); } finally { setBusy(false); } }
  async function save() { if (!name.trim() || !daily || !deposit || !Number.isSafeInteger(Number(daily)) || !Number.isSafeInteger(Number(deposit)) || Number(daily) < 0 || Number(deposit) < 0) { report("กรอกชื่อและจำนวนสตางค์ให้ถูกต้อง"); return; } await run(() => editing ? api.updateLaptop(editing.id, input(), editing.version) : api.createLaptop(input())); }
  async function uploadProductImage() { if (!editing || !productImage) return; await run(async () => { const evidenceId = await api.uploadProductEvidence(editing.id, productImage); return api.attachLaptopImage(editing.id, evidenceId, altText.trim(), editing.version); }); }
  function reset() { setEditing(undefined); setName(""); setDaily(""); setDeposit(""); setSpecs(""); setReason(""); setProductImage(undefined); setAltText(""); }
  return <><PageHeading eyebrow="Inventory" title="คลังโน้ตบุ๊ก">จัดการข้อมูลเครื่องและเก็บประวัติรายการที่เลิกใช้งาน</PageHeading>
    <section className={styles.card}><h2>{editing ? "แก้ไขเครื่อง" : "เพิ่มเครื่อง"}</h2>
      <div className={styles.field}><label>ชื่อ<input value={name} onChange={(event) => setName(event.target.value)} /></label></div>
      <div className={styles.field}><label>รายละเอียดสเปก<textarea value={specs} onChange={(event) => setSpecs(event.target.value)} /></label></div>
      <div className={styles.field}><label>ค่าเช่า (สตางค์)<input type="number" min="0" step="1" value={daily} onChange={(event) => setDaily(event.target.value)} /></label></div>
      <div className={styles.field}><label>มัดจำ (สตางค์)<input type="number" min="0" step="1" value={deposit} onChange={(event) => setDeposit(event.target.value)} /></label></div>
      <div className={styles.actions}><button className={styles.button} type="button" disabled={busy} onClick={() => void save()}>บันทึก</button>{editing ? <button className={styles.secondaryButton} type="button" disabled={busy} onClick={reset}>ยกเลิก</button> : null}</div>
      {editing && !editing.retiredAt ? <>
        {["AVAILABLE", "MAINTENANCE"].includes(editing.status) ? <div className={styles.field}>
          <h3>สถานะเครื่อง</h3><label>เหตุผลเปลี่ยนสถานะ<input value={reason} maxLength={500} disabled={busy} onChange={(event) => setReason(event.target.value)} /></label>
          <button className={styles.secondaryButton} disabled={busy || !reason.trim()} onClick={() => void run(() => api.setLaptopStatus(editing.id, editing.status === "MAINTENANCE" ? "AVAILABLE" : "MAINTENANCE", reason.trim(), editing.version))}>{editing.status === "MAINTENANCE" ? "นำกลับมาให้เช่า" : "นำเครื่องเข้าซ่อมบำรุง"}</button>
        </div> : <p className={styles.muted}>เปลี่ยนสถานะซ่อมบำรุงได้เมื่อเครื่องไม่มีรายการเช่าค้าง</p>}
        <div className={styles.field}><h3>รูปสินค้า</h3><p className={styles.muted}>รูปนี้จะแสดงให้ลูกค้าเห็นในรายการเครื่อง</p>
          <label>เลือกรูปเครื่อง<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; try { validateConditionImages([file]); setProductImage(file); } catch (error) { report(errorMessage(error)); } }} /></label>
          <label>คำอธิบายรูป<input value={altText} maxLength={500} disabled={busy} onChange={(event) => setAltText(event.target.value)} /></label>
          <button className={styles.secondaryButton} disabled={busy || !productImage} onClick={() => void uploadProductImage()}>บันทึกรูปสินค้า</button>
        </div>
      </> : null}
    </section>
    <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>ชื่อ</th><th>สถานะ</th><th>ค่าเช่า/วัน</th><th>Version</th><th>การทำงาน</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td>{item.name}</td><td>{item.status}</td><td>{formatSatang(item.dailyRateSatang)}</td><td>{item.version}</td><td><button className={styles.secondaryButton} type="button" disabled={busy} onClick={() => { reset(); setEditing(item); setName(item.name); setDaily(String(item.dailyRateSatang)); setDeposit(String(item.depositSatang)); setSpecs(typeof item.specs.description === "string" ? item.specs.description : ""); }}>แก้ไข</button>{item.retiredAt ? <span className={styles.muted}> เก็บประวัติแล้ว</span> : context?.roles.includes("OWNER") ? <button className={styles.secondaryButton} type="button" disabled={busy} onClick={() => void run(() => api.retireLaptop(item.id, item.version))}>เลิกใช้งาน</button> : null}</td></tr>)}</tbody></table></div>
  </>;
}

function RentalDetail({ api, rental, inspections, refresh, report }: { api: AdminApi; rental: AdminRental; inspections: InspectionSummary[]; refresh: () => Promise<void>; report: (v?: string) => void }) {
  const context = useAdminContext();
  const [reason, setReason] = useState(""); const [providerRef, setProviderRef] = useState("");
  const evidence: EvidenceSummary[] = [...rental.reviewSummary.kycEvidenceIds.map((id) => ({ id, purpose: "KYC" as const, label: "เอกสาร KYC", maskedSubject: rental.customerSummary.phoneMasked })), ...(rental.reviewSummary.paymentEvidenceId ? [{ id: rental.reviewSummary.paymentEvidenceId, purpose: "PAYMENT_SLIP" as const, label: "หลักฐานชำระเงิน", maskedSubject: `รายการ #${rental.id.slice(0, 8)}` }] : [])];
  async function run(work: () => Promise<unknown>) { try { await work(); setReason(""); await refresh(); } catch (e) { report(errorMessage(e)); } }
  async function command(command: RentalCommand) {
    const afterInspection = inspections.find((item) => item.type === "AFTER_RETURN");
    if (["reject", "request-return", "finalize-inspection"].includes(command) && !reason.trim()) { report("กรอกเหตุผลก่อนดำเนินการ"); return; }
    if (command === "finalize-inspection" && !afterInspection) { report("บันทึกผลตรวจสภาพหลังรับคืนก่อนสรุปยอด"); return; }
    await run(() => api.command(rental.id, command, rental.version, {
      ...(reason ? { reason } : {}),
      ...(command === "finalize-inspection" && afterInspection ? { inspectionId: afterInspection.id } : {}),
    }));
  }
  return <><PageHeading eyebrow="Rental case" title={`รายการ #${rental.id.slice(0, 8)}`}>ข้อมูลผู้เช่าถูก mask และ action มาจาก server</PageHeading><div className={styles.grid2}><section className={styles.card}><h2>ภาพรวม</h2><p>{rental.customerSummary.displayName} · {rental.customerSummary.phoneMasked}</p><p>{rental.startDate} – {rental.endDate}</p><StatusBadge tone="warning">{rental.status}</StatusBadge><p>{formatSatang(rental.totalDue.amountSatang)}</p><p className={styles.muted}>Version {rental.version}</p></section><section className={styles.card}><h2>ผลตรวจ</h2><p>KYC: {rental.reviewSummary.kycStatus}</p><p>Payment: {rental.reviewSummary.paymentStatus}</p><div className={styles.field}><label>เหตุผล/บันทึก<textarea value={reason} maxLength={500} rows={3} onChange={(e) => setReason(e.target.value)} /></label></div></section></div>
    {context?.permissions.includes("evidence:review") ? <div className={styles.grid2}>{evidence.map((item) => <SecureEvidenceViewer key={item.id} evidence={item} />)}</div> : null}
    {context?.permissions.includes("rental:review") && rental.reviewSummary.kycStatus === "PENDING" ? <section className={styles.card}><h2>ตรวจ KYC</h2><div className={styles.actions}><button className={styles.button} onClick={() => void run(() => api.reviewKyc(rental.id, "verify", rental.reviewSummary.kycEvidenceIds, rental.version, undefined))}>ยืนยัน</button><button className={styles.secondaryButton} disabled={!reason.trim()} onClick={() => void run(() => api.reviewKyc(rental.id, "reject", rental.reviewSummary.kycEvidenceIds, rental.version, reason))}>ปฏิเสธ</button></div></section> : null}
    {context?.permissions.includes("rental:review") && rental.reviewSummary.paymentStatus === "SUBMITTED" && rental.reviewSummary.paymentAttemptId ? <section className={styles.card}><h2>ตรวจชำระเงิน</h2><div className={styles.field}><label>เลขอ้างอิงผู้ให้บริการ<input value={providerRef} onChange={(e) => setProviderRef(e.target.value)} /></label></div><div className={styles.actions}><button className={styles.button} disabled={!providerRef.trim()} onClick={() => void run(() => api.reviewPayment(rental.id, rental.reviewSummary.paymentAttemptId!, "verify", rental.version, { reason: reason || "ตรวจสอบยอดแล้ว", providerReference: providerRef }))}>ยืนยัน</button><button className={styles.secondaryButton} disabled={!reason.trim()} onClick={() => void run(() => api.reviewPayment(rental.id, rental.reviewSummary.paymentAttemptId!, "reject", rental.version, { reason }))}>ปฏิเสธ</button></div></section> : null}
    <CommandPanel commands={rental.allowedCommands} onCommand={(value) => void command(value)} />
    {context?.permissions.includes("inspection:write") && ["PREPARING", "INSPECTION_PENDING"].includes(rental.status) ? <ConditionInspection api={api} rentalId={rental.id} purpose={rental.status === "PREPARING" ? "CONDITION_BEFORE" : "CONDITION_AFTER"} inspections={inspections} refresh={refresh} report={report} /> : null}
  </>;
}

function ConditionInspection({ api, rentalId, purpose, inspections, refresh, report }: {
  api: AdminApi; rentalId: string; purpose: ConditionPurpose; inspections: InspectionSummary[];
  refresh: () => Promise<void>; report: (value?: string) => void;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [evidenceIds, setEvidenceIds] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const type = purpose === "CONDITION_BEFORE" ? "BEFORE_RENT" : "AFTER_RETURN";
  const complete = inspections.some((item) => item.type === type);

  function choose(selected: FileList | null) {
    const next = Array.from(selected ?? []);
    if (!next.length) return;
    try { validateConditionImages(next, evidenceIds.length); setFiles(next); setMessage(undefined); }
    catch (error) { setMessage(errorMessage(error)); }
  }
  async function upload() {
    setBusy(true); setMessage(undefined);
    try {
      for (const file of files) {
        const evidenceId = await api.uploadConditionEvidence(rentalId, purpose, file);
        setEvidenceIds((current) => [...current, evidenceId]);
        setFiles((current) => current.filter((pending) => pending !== file));
      }
    } catch (error) { setMessage(errorMessage(error)); }
    finally { setBusy(false); }
  }
  async function save() {
    if (!evidenceIds.length || files.length || !notes.trim()) return;
    setBusy(true); setMessage(undefined);
    try { await api.createInspection(rentalId, { type, evidenceIds, notes: notes.trim() }); await refresh(); }
    catch (error) { report(errorMessage(error)); }
    finally { setBusy(false); }
  }
  return <section className={styles.card} aria-busy={busy}>
    <h2>{type === "BEFORE_RENT" ? "บันทึกสภาพก่อนส่งมอบ" : "บันทึกสภาพหลังรับคืน"}</h2>
    {complete ? <p role="status">บันทึกการตรวจสภาพขั้นตอนนี้แล้ว</p> : <>
      <div className={styles.field}><label>รูปสภาพเครื่อง<input type="file" multiple accept="image/jpeg,image/png,image/webp" disabled={busy || evidenceIds.length >= CONDITION_IMAGE_LIMIT} onChange={(event) => { choose(event.target.files); event.target.value = ""; }} /></label><small className={styles.muted}>JPG, PNG หรือ WebP · ไม่เกิน 10 MB ต่อรูป · สูงสุด 12 รูป · เก็บแบบส่วนตัว</small></div>
      <p role="status" aria-live="polite">รูปที่ผ่านการตรวจสอบ {evidenceIds.length}/{CONDITION_IMAGE_LIMIT} รูป{files.length ? ` · รออัปโหลด ${files.length} รูป` : ""}{busy ? " · กำลังดำเนินการ…" : ""}</p>
      {files.length ? <div className={styles.actions}><button className={styles.secondaryButton} type="button" disabled={busy} onClick={() => void upload()}>อัปโหลดรูปที่เหลือ</button><button className={styles.secondaryButton} type="button" disabled={busy} onClick={() => setFiles([])}>ยกเลิกรูปที่ยังไม่อัปโหลด</button></div> : null}
      {message ? <p className={styles.error} role="alert">{message}</p> : null}
      <div className={styles.field}><label>บันทึกสภาพ<textarea value={notes} disabled={busy} onChange={(event) => setNotes(event.target.value)} maxLength={2000} /></label></div>
      <button className={styles.button} type="button" disabled={busy || !notes.trim() || !evidenceIds.length || Boolean(files.length)} onClick={() => void save()}>บันทึกการตรวจสภาพ</button>
    </>}
    {inspections.map((item) => <p key={item.id}>{item.type === "BEFORE_RENT" ? "ก่อนส่งมอบ" : "หลังรับคืน"} · {item.evidenceIds.length} รูป · {new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" }).format(new Date(item.finalizedAt))}</p>)}
  </section>;
}

function Finance({ api, items, refresh, report }: { api: AdminApi; items: AdminRental[]; refresh: () => Promise<void>; report: (v?: string) => void }) {
  const eligible = items.filter((item) => ["INSPECTION_PENDING", "REFUND_PENDING", "COMPLETED"].includes(item.status));
  const [selected, setSelected] = useState(eligible[0]?.id ?? "");
  const current = eligible.find((item) => item.id === selected);
  return <><PageHeading eyebrow="Finance" title="ค่าธรรมเนียมและคืนเงิน">ตรวจสรุปยอดและบันทึกหลักฐานการโอนคืนที่ดำเนินการแล้ว</PageHeading>
    {eligible.length ? <section className={styles.card}><div className={styles.field}><label>รายการ<select value={selected} onChange={(event) => setSelected(event.target.value)}>{eligible.map((item) => <option value={item.id} key={item.id}>#{item.id.slice(0, 8)} · {item.status}</option>)}</select></label></div></section> : <p role="status">ยังไม่มีรายการที่ต้องดำเนินการทางการเงิน</p>}
    {current ? <RentalFinance key={current.id} api={api} rental={current} refresh={refresh} report={report} /> : null}
  </>;
}

function RentalFinance({ api, rental, refresh, report }: { api: AdminApi; rental: AdminRental; refresh: () => Promise<void>; report: (value?: string) => void }) {
  const [summary, setSummary] = useState<FinancialSummary>();
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false);
  const [amount, setAmount] = useState(""); const [reason, setReason] = useState(""); const [type, setType] = useState<"LATE_FEE" | "DAMAGE_FEE">("LATE_FEE");
  const [providerReference, setProviderReference] = useState(""); const [confirmationReason, setConfirmationReason] = useState(""); const [transferred, setTransferred] = useState(false);
  const refund = summary?.refunds.find((item) => ["PENDING", "FAILED"].includes(item.status));
  useEffect(() => {
    let cancelled = false;
    void api.getFinancialSummary(rental.id).then((value) => { if (!cancelled) setSummary(value); }).catch((error) => { if (!cancelled) report(errorMessage(error)); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [api, rental.id, report]);
  async function addFee() {
    const amountSatang = Number(amount);
    if (!amount || !Number.isSafeInteger(amountSatang) || amountSatang <= 0 || !reason.trim()) { report("กรอกจำนวนสตางค์และเหตุผลให้ครบ"); return; }
    setBusy(true);
    try { await api.createFee(rental.id, { type, amountSatang, reason: reason.trim() }); setSummary(await api.getFinancialSummary(rental.id)); setAmount(""); setReason(""); }
    catch (error) { report(errorMessage(error)); }
    finally { setBusy(false); }
  }
  async function confirmRefund() {
    if (!summary || !refund || !providerReference.trim() || !confirmationReason.trim() || !transferred) return;
    setBusy(true);
    try {
      setSummary(await api.confirmRefund(rental.id, refund.id, { amountSatang: refund.amountSatang, providerReference: providerReference.trim(), reason: confirmationReason.trim() }, summary.version));
      await refresh();
    } catch (error) { report(errorMessage(error)); }
    finally { setBusy(false); }
  }
  if (loading) return <p role="status">กำลังโหลดสรุปยอด…</p>;
  if (!summary) return null;
  return <div className={styles.grid2} aria-busy={busy}>
    <section className={styles.card}><h2>สรุปยอดรายการ</h2><p>มัดจำ {formatSatang(summary.depositSatang)}</p>
      <h3>รายการค่าธรรมเนียม</h3>{summary.fees.length ? <ul>{summary.fees.map((fee) => <li key={fee.id}>{fee.type === "LATE_FEE" ? "ค่าคืนล่าช้า" : "ค่าเสียหาย"} · {formatSatang(fee.amountSatang)} · {fee.reason}</li>)}</ul> : <p>ยังไม่มีค่าธรรมเนียม</p>}
      {summary.disposition ? <div role="status"><h3>ผลสรุปที่ยืนยันแล้ว</h3><p>{summary.disposition.kind === "NO_FEES" ? "ไม่มีค่าธรรมเนียม" : "หักค่าธรรมเนียมตามรายการ"} · {summary.disposition.reason}</p><p>ค่าธรรมเนียมรวม {formatSatang(summary.disposition.feeTotalSatang)}</p><p><strong>ยอดคืนเงิน {formatSatang(summary.disposition.refundableSatang)}</strong></p></div> : <p className={styles.notice}>ตรวจรูปและบันทึกค่าธรรมเนียมให้ครบ แล้วสรุปผลตรวจสภาพในหน้ารายการเช่าเพื่อยืนยันยอดคืนเงิน</p>}
      <Link href={`/admin/rentals/${rental.id}`}>เปิดรายการเช่าและผลตรวจสภาพ</Link>
      {!summary.disposition && rental.status === "INSPECTION_PENDING" ? <>
        <h3>เพิ่มค่าธรรมเนียม</h3><div className={styles.field}><label>ประเภท<select value={type} disabled={busy} onChange={(event) => setType(event.target.value as typeof type)}><option value="LATE_FEE">ค่าคืนล่าช้า</option><option value="DAMAGE_FEE">ค่าเสียหาย</option></select></label></div>
        <div className={styles.field}><label>จำนวน (สตางค์)<input type="number" min="1" step="1" value={amount} disabled={busy} onChange={(event) => setAmount(event.target.value)} /></label></div>
        <div className={styles.field}><label>เหตุผล<textarea value={reason} maxLength={500} disabled={busy} onChange={(event) => setReason(event.target.value)} /></label></div>
        <button className={styles.button} disabled={busy || !amount || !reason.trim()} onClick={() => void addFee()}>บันทึกค่าธรรมเนียม</button>
      </> : null}
    </section>
    <section className={styles.card}><h2>การคืนเงินมัดจำ</h2>
      {summary.refunds.length ? summary.refunds.map((item) => <p key={item.id}>{formatSatang(item.amountSatang)} · {({ NOT_REQUIRED: "ไม่ต้องคืนเงิน", PENDING: "รอยืนยันการโอนคืน", PROCESSING: "กำลังดำเนินการ", COMPLETED: "คืนเงินแล้ว", FAILED: "ต้องดำเนินการใหม่", CANCELLED: "ยกเลิก" })[item.status]}{item.providerReference ? ` · เลขอ้างอิง ${item.providerReference}` : ""}</p>) : <p>ยังไม่มีภาระคืนเงินที่สรุปแล้ว</p>}
      {refund ? <>
        <p className={styles.notice}>หน้านี้บันทึกการโอนที่ผู้ดูแลทำผ่านธนาคารแล้ว กรุณาโอนให้ครบ {formatSatang(refund.amountSatang)} และตรวจผู้รับก่อนยืนยัน</p>
        <div className={styles.field}><label>เลขอ้างอิงการโอน<input value={providerReference} maxLength={200} disabled={busy} onChange={(event) => setProviderReference(event.target.value)} /></label></div>
        <div className={styles.field}><label>บันทึกการคืนเงิน<textarea value={confirmationReason} maxLength={500} disabled={busy} onChange={(event) => setConfirmationReason(event.target.value)} /></label></div>
        <div className={styles.field}><label><input type="checkbox" checked={transferred} disabled={busy} onChange={(event) => setTransferred(event.target.checked)} /> ยืนยันว่าได้โอนคืนตามยอดข้างต้นและตรวจหลักฐานแล้ว</label></div>
        <button className={styles.button} disabled={busy || !transferred || !providerReference.trim() || !confirmationReason.trim()} onClick={() => void confirmRefund()}>ยืนยันการโอนคืนที่ทำแล้ว</button>
      </> : null}
    </section>
  </div>;
}

function Settings({ api, items, refresh, report }: { api: AdminApi; items: AdminSetting[]; refresh: () => Promise<void>; report: (v?: string) => void }) {
  const [key, setKey] = useState<AdminSetting["key"]>(items[0]?.key ?? "PAYMENT_INSTRUCTIONS"); const current = items.find((item) => item.key === key); const [value, setValue] = useState(""); const [title, setTitle] = useState(""); const [content, setContent] = useState("");
  const [qrImageUrl, setQrImageUrl] = useState(""); const [accountDisplayName, setAccountDisplayName] = useState("");
  async function update() {
    try {
      let nextValue = value;
      if (key === "PAYMENT_INSTRUCTIONS") {
        const address = new URL(qrImageUrl);
        if (address.protocol !== "https:" || address.username || address.password || !accountDisplayName.trim()) throw new Error("กรอกลิงก์ QR แบบ HTTPS และชื่อบัญชีให้ครบ");
        nextValue = JSON.stringify({ qrImageUrl: address.href, accountDisplayName: accountDisplayName.trim() });
      }
      await api.updateSetting(key, nextValue, current?.version ?? 0); setValue(""); await refresh();
    } catch (error) { report(errorMessage(error)); }
  }
  async function publish() { try { await api.publishContract({ title, content, effectiveAt: new Date().toISOString() }); setTitle(""); setContent(""); } catch (e) { report(errorMessage(e)); } }
  return <><PageHeading eyebrow="Owner only" title="ตั้งค่าระบบ">ปรับข้อความ ข้อมูลรับเงิน และสัญญาเช่า</PageHeading><div className={styles.grid2}>
    <section className={styles.card}><h2>ข้อความและการชำระเงิน</h2>
      <div className={styles.field}><label>ประเภท<select value={key} onChange={(event) => { setKey(event.target.value as AdminSetting["key"]); setValue(""); }}><option value="PAYMENT_INSTRUCTIONS">ข้อมูลรับเงิน</option><option value="CONTACT_LINE_URL">ลิงก์ติดต่อ LINE</option><option value="AUTO_REPLY_TEXT">ข้อความตอบกลับ</option></select></label></div>
      {key === "PAYMENT_INSTRUCTIONS" ? <>
        <div className={styles.field}><label>ลิงก์รูป QR รับเงิน<input type="url" placeholder="https://…" value={qrImageUrl} onChange={(event) => setQrImageUrl(event.target.value)} /></label></div>
        <div className={styles.field}><label>ชื่อบัญชีที่แสดง<input value={accountDisplayName} maxLength={200} onChange={(event) => setAccountDisplayName(event.target.value)} /></label></div>
      </> : <div className={styles.field}><label>ค่าใหม่<textarea value={value} maxLength={5000} onChange={(event) => setValue(event.target.value)} /></label></div>}
      <button className={styles.button} disabled={key === "PAYMENT_INSTRUCTIONS" ? !qrImageUrl.trim() || !accountDisplayName.trim() : !value.trim()} onClick={() => void update()}>บันทึก</button>
    </section>
    <section className={styles.card}><h2>เผยแพร่สัญญา</h2><div className={styles.field}><label>ชื่อ<input value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} /></label></div><div className={styles.field}><label>เนื้อหา<textarea value={content} maxLength={100000} onChange={(event) => setContent(event.target.value)} /></label></div><button className={styles.button} disabled={!title.trim() || !content.trim()} onClick={() => void publish()}>เผยแพร่สัญญาฉบับใหม่</button></section>
  </div></>;
}

function Audit({ items }: { items: AuditEvent[] }) { return <><PageHeading eyebrow="Append-only history" title="ประวัติการทำงาน">Projection ที่ redact แล้วจาก server</PageHeading><div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>เวลา UTC</th><th>Action</th><th>เป้าหมาย</th><th>Actor</th><th>ผล</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td>{item.occurredAt}</td><td>{item.action}</td><td>{item.targetType} {item.targetId?.slice(0, 8)}</td><td>{item.actorType}</td><td>{item.outcome}</td></tr>)}</tbody></table></div></>; }
function formatSatang(value: number): string { return new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB" }).format(value / 100); }
function errorMessage(error: unknown): string { if (error instanceof AdminApiError) { if (error.code === "AUTH_REQUIRED") return "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่"; if (error.code === "FORBIDDEN") return "บัญชีนี้ไม่มีสิทธิ์ดำเนินการ"; if (["CONFLICT", "IDEMPOTENCY_CONFLICT"].includes(error.code)) return "ข้อมูลเปลี่ยนแล้ว กรุณาโหลดใหม่ก่อนทำรายการซ้ำ"; return error.message; } return error instanceof Error ? error.message : "ดำเนินการไม่สำเร็จ"; }
