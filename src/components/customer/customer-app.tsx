"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CustomerApi, CustomerApiError, canCompleteRental, customerErrorMessage, formatBangkokDateTime, formatMoney, isPaymentSubmitted, validateCustomer,
  validateDateRange, validatePrivateImage, type ContractVersion, type CustomerLaptop,
  type CustomerLaptopDetail, type CustomerQuote, type CustomerRental, type CustomerRentalCompletion, type PaymentSettings,
  type RentalCompletionSummary,
} from "@/lib/liff/customer-adapter";
import { establishCustomerSession, loadBrowserLiff, type SessionState } from "@/lib/liff/session";
import styles from "./customer.module.css";

const statusOrder = [
  "DRAFT", "PENDING_PAYMENT", "PENDING_REVIEW", "APPROVED", "PREPARING", "READY_FOR_HANDOVER",
  "ACTIVE", "RETURN_PENDING", "INSPECTION_PENDING", "REFUND_PENDING", "COMPLETED",
] as const;
const statusLabels: Record<string, string> = {
  DRAFT: "แบบร่าง", PENDING_PAYMENT: "รอหลักฐาน", PENDING_REVIEW: "รอตรวจสอบ", APPROVED: "อนุมัติแล้ว",
  PREPARING: "เตรียมเครื่อง", READY_FOR_HANDOVER: "พร้อมส่งมอบ", ACTIVE: "กำลังเช่า", RETURN_PENDING: "รอคืนเครื่อง",
  INSPECTION_PENDING: "ตรวจสภาพ", REFUND_PENDING: "คืนมัดจำ", COMPLETED: "เสร็จสิ้น", REJECTED: "ไม่อนุมัติ",
  CANCELLED: "ยกเลิก", EXPIRED: "หมดอายุ",
};

export function CustomerApp() {
  const [session, setSession] = useState<SessionState>("initializing");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [laptops, setLaptops] = useState<CustomerLaptop[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [detail, setDetail] = useState<CustomerLaptopDetail | null>(null);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [quote, setQuote] = useState<CustomerQuote | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [rental, setRental] = useState<CustomerRental | null>(null);
  const [rentals, setRentals] = useState<CustomerRental[]>([]);
  const [contract, setContract] = useState<ContractVersion | null>(null);
  const [contractChecked, setContractChecked] = useState(false);
  const [contractAccepted, setContractAccepted] = useState(false);
  const [payment, setPayment] = useState<PaymentSettings | null>(null);
  const [kycReady, setKycReady] = useState(false);
  const [slipEvidenceId, setSlipEvidenceId] = useState<string | null>(null);
  const [paymentSubmitted, setPaymentSubmitted] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState<RentalCompletionSummary["paymentStatus"]>("NOT_SUBMITTED");
  const [contactLineUrl, setContactLineUrl] = useState<string | null>(null);
  const [contactUnavailable, setContactUnavailable] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const started = useRef(false);

  const authenticate = useCallback(async () => {
    const liff = await loadBrowserLiff();
    await establishCustomerSession(liff, process.env.NEXT_PUBLIC_LINE_LIFF_ID ?? "");
    setSession("ready");
  }, []);
  const api = useMemo(() => new CustomerApi(fetch, authenticate), [authenticate]);

  function showError(error: unknown) {
    if (error instanceof CustomerApiError && error.code === "AUTH_REQUIRED") setSession("expired");
    setMessage(customerErrorMessage(error));
  }

  const clearBooking = useCallback(() => {
    setRental(null); setQuote(null); setContract(null); setContractChecked(false); setContractAccepted(false);
    setPayment(null); setKycReady(false); setSlipEvidenceId(null); setPaymentSubmitted(false); setPaymentStatus("NOT_SUBMITTED");
  }, []);

  function applyCompletion(completion: CustomerRentalCompletion) {
    const summary = completion.rental.completionSummary;
    setRental(completion.rental); setContract(completion.contract); setPayment(completion.payment);
    setKycReady(summary.kycReady); setSlipEvidenceId(summary.paymentEvidenceId);
    setContractAccepted(Boolean(summary.acceptedContract)); setContractChecked(Boolean(summary.acceptedContract));
    setPaymentStatus(summary.paymentStatus); setPaymentSubmitted(isPaymentSubmitted(summary.paymentStatus));
    setRentals((items) => [completion.rental, ...items.filter((item) => item.id !== completion.rental.id)]);
  }

  const load = useCallback(async () => {
    setBusy(true); setMessage(null); setSession("initializing"); setContactUnavailable(false);
    try {
      await authenticate();
      const [catalog, ownRentals, settings] = await Promise.all([
        api.listLaptops(), api.listRentals(),
        api.getPublicSettings().catch(() => { setContactUnavailable(true); return { contactLineUrl: null }; }),
      ]);
      clearBooking(); setContactLineUrl(settings.contactLineUrl);
      setLaptops(catalog.data); setSelectedId(catalog.data[0]?.id ?? ""); setRentals(ownRentals.data);
      if (catalog.data[0]) setDetail(await api.getLaptop(catalog.data[0].id));
    } catch (error) {
      setSession(error instanceof CustomerApiError && error.code === "AUTH_REQUIRED" ? "expired" : "error");
      setMessage(customerErrorMessage(error));
    } finally { setBusy(false); }
  }, [api, authenticate, clearBooking]);

  useEffect(() => { if (!started.current) { started.current = true; void load(); } }, [load]);

  async function resumeRental(rentalId: string) {
    clearBooking(); setBusy(true); setMessage(null);
    try { applyCompletion(await api.getRentalCompletion(rentalId)); }
    catch (error) { showError(error); }
    finally { setBusy(false); }
  }

  function requireEditableRental() {
    if (!rental || !canCompleteRental(rental)) {
      setMessage("รายการนี้ไม่พร้อมรับหลักฐานแล้ว กรุณาโหลดรายการล่าสุดอีกครั้ง"); return false;
    }
    return true;
  }

  async function selectLaptop(laptop: CustomerLaptop) {
    setSelectedId(laptop.id); setQuote(null); setMessage(null); setBusy(true);
    try { setDetail(await api.getLaptop(laptop.id)); }
    catch (error) { showError(error); }
    finally { setBusy(false); }
  }

  async function requestQuote() {
    if (!selectedId || !validateDateRange(startDate, endDate)) { setMessage("เลือกวันเริ่มและวันคืนที่ถูกต้อง"); return; }
    setBusy(true); setMessage(null); setQuote(null);
    try { setQuote(await api.createQuote(selectedId, startDate, endDate)); }
    catch (error) { showError(error); }
    finally { setBusy(false); }
  }

  async function createBooking() {
    if (!quote || !validateCustomer(name, phone)) { setMessage("กรอกชื่อและเบอร์โทร 9–15 หลักให้ครบ"); return; }
    setBusy(true); setMessage(null);
    try {
      const created = await api.createRental(quote.quoteId, { name: name.trim(), phone });
      setRental(created); setRentals((items) => [created, ...items.filter((item) => item.id !== created.id)]);
      applyCompletion(await api.getRentalCompletion(created.id));
    } catch (error) {
      showError(error);
      if (error instanceof CustomerApiError && error.code === "CONFLICT") setQuote(null);
    } finally { setBusy(false); }
  }

  async function upload(file: File | undefined, purpose: "KYC_ID" | "PAYMENT_SLIP") {
    if (!file || !rental || !requireEditableRental() || (purpose === "KYC_ID" ? kycReady : Boolean(slipEvidenceId) || paymentSubmitted)) return;
    const validation = validatePrivateImage(file);
    if (!validation.valid) { setMessage(validation.reason!); return; }
    setBusy(true); setMessage(null); setUploadProgress(0);
    try {
      const result = await api.uploadEvidence(purpose, rental.id, file, setUploadProgress);
      if (result.status !== "READY") throw new Error("ไฟล์อยู่ระหว่างกักกัน กรุณาติดต่อเจ้าหน้าที่");
      if (purpose === "KYC_ID") setKycReady(true); else setSlipEvidenceId(result.evidenceId);
    } catch (error) { showError(error); }
    finally { setBusy(false); setUploadProgress(null); }
  }

  async function acceptContract() {
    if (!rental || !contract || !contractChecked || contractAccepted || !requireEditableRental()) return;
    setBusy(true); setMessage(null);
    try { await api.acceptContract(rental.id, contract); setContractAccepted(true); }
    catch (error) { showError(error); }
    finally { setBusy(false); }
  }

  async function submitPayment() {
    if (!rental || !slipEvidenceId || !kycReady || !contractAccepted || paymentSubmitted || !requireEditableRental()) return;
    setBusy(true); setMessage(null);
    try {
      await api.submitPayment(rental.id, slipEvidenceId); setPaymentSubmitted(true); setPaymentStatus("SUBMITTED");
      applyCompletion(await api.getRentalCompletion(rental.id));
    } catch (error) { showError(error); }
    finally { setBusy(false); }
  }

  const specs = detail ? Object.entries(detail.specs) : [];
  const customerValid = validateCustomer(name, phone);
  const rentalEditable = Boolean(rental && canCompleteRental(rental));

  return (
    <main className={styles.shell} aria-busy={busy}>
      <header className={styles.header}>
        <div><span className={styles.eyebrow}>REDBOOK RENTAL</span><h1>หาเครื่องที่ใช่<br />เช่าได้ในไม่กี่ขั้นตอน</h1></div>
        <div className={styles.session} aria-live="polite"><span /> {session === "ready" ? "เชื่อมต่อ LINE แล้ว" : session === "initializing" ? "กำลังเชื่อมต่อ…" : "ยังไม่เชื่อมต่อ"}</div>
      </header>

      {message ? <StateNotice message={message} onRetry={() => void load()} /> : null}
      {busy && session === "initializing" ? <LoadingState /> : null}

      {session === "ready" ? <>
        <section className={styles.section} aria-labelledby="catalog-title">
          <div className={styles.sectionHead}><div><span className={styles.kicker}>01 · เลือกเครื่อง</span><h2 id="catalog-title">เครื่องที่พร้อมเช่า</h2></div><span className={styles.count}>{laptops.length} เครื่อง</span></div>
          {laptops.length ? <div className={styles.cards}>{laptops.map((item) => (
            <button className={`${styles.card} ${item.id === selectedId ? styles.selected : ""}`} key={item.id} onClick={() => void selectLaptop(item)} aria-pressed={item.id === selectedId}>
              <div className={styles.device} style={safeImageStyle(item.thumbnailUrl)} aria-hidden="true"><span /></div>
              <strong>{item.name}</strong><small>มัดจำ {formatMoney(item.deposit)}</small><div><b>{formatMoney(item.dailyRate)}</b><span> / วัน</span></div>
            </button>
          ))}</div> : <p className={styles.empty}>ยังไม่มีเครื่องพร้อมเช่า</p>}
        </section>

        {detail ? <section className={styles.detail} aria-labelledby="detail-title">
          <span className={styles.kicker}>02 · วันเช่าและราคา</span><h2 id="detail-title">{detail.name}</h2>
          <ul className={styles.specs}>{specs.map(([key, value]) => <li key={key}><b>{key}</b><br />{String(value)}</li>)}</ul>
          <div className={styles.dates}>
            <label>วันเริ่ม<input type="date" value={startDate} onChange={(event) => { setStartDate(event.target.value); setQuote(null); }} /></label>
            <label>วันคืน<input type="date" value={endDate} onChange={(event) => { setEndDate(event.target.value); setQuote(null); }} /></label>
          </div>
          <button className={styles.primary} type="button" onClick={() => void requestQuote()} disabled={busy}>ตรวจวันว่างและขอราคา</button>
          {quote ? <div className={styles.quote} aria-live="polite">
            <div><span>ค่าเช่า {quote.rentalDays} วัน</span><strong>{formatMoney(quote.rentalSubtotal)}</strong></div>
            <div><span>เงินมัดจำ</span><strong>{formatMoney(quote.deposit)}</strong></div>
            <div className={styles.total}><span>ยอดชำระ</span><strong>{formatMoney(quote.totalDue)}</strong></div>
            <small>ราคาจาก server · หมดอายุ {formatBangkokDateTime(quote.expiresAt)}</small>
          </div> : null}
        </section> : null}

        {quote && !rental ? <section className={styles.section} aria-labelledby="booking-title">
          <span className={styles.kicker}>03 · สร้างรายการ</span><h2 id="booking-title">ข้อมูลผู้เช่า</h2>
          <div className={styles.formCard}><div className={styles.form}>
            <label>ชื่อสำหรับติดต่อ<input value={name} maxLength={120} autoComplete="name" onChange={(event) => setName(event.target.value)} /></label>
            <label>เบอร์โทร<input inputMode="tel" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} /></label>
            {(name || phone) && !customerValid ? <p role="alert">กรอกชื่อและเบอร์โทร 9–15 หลักให้ครบ</p> : null}
          </div><div className={styles.actions}><button className={styles.primary} disabled={!customerValid || busy} onClick={() => void createBooking()}>ยืนยันสร้างรายการ</button></div></div>
        </section> : null}

        {rental ? <section className={styles.section} aria-labelledby="evidence-title">
          <span className={styles.kicker}>04 · ยืนยันและชำระเงิน</span><h2 id="evidence-title">รายการ #{rental.id.slice(0, 8)}</h2>
          <div className={styles.formCard}>
            <p>สถานะรายการ: {statusLabels[rental.status]} · ยอดจากระบบ {formatMoney(rental.totalDue)}</p>
            {rental.holdExpiresAt ? <p>เวลาสำรองเครื่องถึง {formatBangkokDateTime(rental.holdExpiresAt)} เวลาไทย</p> : null}
            {paymentSubmitted ? <p role="status">{paymentStatus === "VERIFIED" ? "ยืนยันการชำระเงินแล้ว" : "ส่งหลักฐานแล้ว อยู่ระหว่างรอตรวจสอบ ไม่ต้องส่งซ้ำ"}</p> : null}
            {paymentStatus === "REJECTED" ? <p role="alert">หลักฐานชำระเงินถูกปฏิเสธ กรุณาแนบสลิปใหม่แล้วส่งอีกครั้ง</p> : null}
            {paymentStatus === "VOIDED" ? <p role="status">หลักฐานเดิมถูกยกเลิก กรุณาแนบสลิปใหม่</p> : null}
            {!rentalEditable && !paymentSubmitted ? <p role="status">รายการนี้หมดเวลาหรือไม่อยู่ในสถานะรับหลักฐาน กรุณาตรวจรายการล่าสุด</p> : null}
            <UploadPanel label="1. เอกสาร KYC" ready={kycReady} busy={busy || !rentalEditable} onFile={(file) => void upload(file, "KYC_ID")} />
            {uploadProgress !== null ? <p className={styles.uploadMessage} role="status">อัปโหลด {uploadProgress}%</p> : null}
            {contract ? <div className={styles.flowBlock}><h3>2. {contract.title} · ฉบับ {contract.version}</h3><div className={styles.contract} tabIndex={0}>{contract.content}</div>
              <label className={styles.check}><input type="checkbox" checked={contractChecked} disabled={contractAccepted || !rentalEditable} onChange={(event) => setContractChecked(event.target.checked)} /> ฉันอ่านและยอมรับสัญญาฉบับนี้</label>
              <button className={styles.secondary} disabled={!contractChecked || contractAccepted || busy || !rentalEditable} onClick={() => void acceptContract()}>{contractAccepted ? "บันทึกการยอมรับฉบับนี้แล้ว ✓" : "บันทึกการยอมรับ"}</button>
            </div> : null}
            {payment ? <div className={styles.flowBlock}><h3>3. ชำระเงิน</h3><div className={styles.qr} style={safeImageStyle(payment.qrImageUrl)} role="img" aria-label={`QR ชำระเงิน ${payment.accountDisplayName}`}><span>QR</span></div><p className={styles.copy}>{payment.accountDisplayName}</p>
              <UploadPanel label="สลิปการโอน" ready={Boolean(slipEvidenceId)} busy={busy || !rentalEditable || paymentSubmitted} onFile={(file) => void upload(file, "PAYMENT_SLIP")} />
              <button className={styles.primary} disabled={!kycReady || !contractAccepted || !slipEvidenceId || !rentalEditable || paymentSubmitted || busy} onClick={() => void submitPayment()}>ส่งหลักฐานเพื่อรอตรวจสอบ</button>
              {!kycReady || !contractAccepted || !slipEvidenceId ? <small className={styles.hint}>ต้องแนบ KYC, ยอมรับสัญญา และแนบสลิปให้ครบ</small> : null}
            </div> : null}
            <div className={styles.actions}><button className={styles.secondary} disabled={busy} onClick={() => void resumeRental(rental.id)}>โหลดสถานะรายการล่าสุด</button>
              <button className={styles.secondary} disabled={busy} onClick={clearBooking}>{paymentSubmitted ? "เริ่มจองรายการใหม่" : "กลับไปเลือกเครื่อง"}</button></div>
          </div>
        </section> : null}

        <RentalTimeline rentals={rentals} laptops={laptops} busy={busy} onResume={(id) => void resumeRental(id)} />
      </> : null}

      <footer className={styles.footer}><div><strong>ต้องการความช่วยเหลือ?</strong><span>คุยกับทีมผ่าน LINE</span></div>{contactLineUrl ? <a href={contactLineUrl} target="_blank" rel="noreferrer">เปิด LINE</a> : <span role="status">{contactUnavailable ? "โหลดช่องทางติดต่อไม่ได้ กรุณาโหลดใหม่" : "ยังไม่ได้ตั้งค่าช่องทางติดต่อ LINE"}</span>}{contactUnavailable ? <button className={styles.secondary} disabled={busy} onClick={() => void api.getPublicSettings().then((settings) => { setContactLineUrl(settings.contactLineUrl); setContactUnavailable(false); }).catch(() => setContactUnavailable(true))}>ลองโหลดช่องทางติดต่ออีกครั้ง</button> : null}<small>ข้อมูล KYC และสลิปเป็นไฟล์ private; ลิงก์อัปโหลดมีอายุจำกัด</small></footer>
    </main>
  );
}

function UploadPanel({ label, ready, busy, onFile }: { label: string; ready: boolean; busy: boolean; onFile: (file: File | undefined) => void }) {
  return <div className={styles.flowBlock}><h3>{label}</h3>{ready ? <p role="status">มีไฟล์ที่ตรวจแล้ว ไม่ต้องอัปโหลดซ้ำ</p> : <label className={styles.upload}><input type="file" disabled={busy} accept="image/jpeg,image/png,image/webp" onChange={(event) => { onFile(event.target.files?.[0]); event.target.value = ""; }} /><span>เลือก JPG, PNG หรือ WebP</span><small>สูงสุด 10 MB · ไฟล์ส่วนตัว</small></label>}</div>;
}

function RentalTimeline({ rentals, laptops, busy, onResume }: { rentals: CustomerRental[]; laptops: CustomerLaptop[]; busy: boolean; onResume: (id: string) => void }) {
  if (!rentals.length) return null;
  return <section className={styles.status} aria-labelledby="status-title"><span className={styles.kicker}>05 · ติดตามรายการ</span><h2 id="status-title">รายการของฉัน</h2>{rentals.map((rental) => {
    const current = statusOrder.indexOf(rental.status as (typeof statusOrder)[number]);
    return <article className={styles.rental} key={rental.id}><b>{laptops.find((item) => item.id === rental.laptopId)?.name ?? `รายการ #${rental.id.slice(0, 8)}`}</b><p>{rental.startDate} — {rental.endDate} · {statusLabels[rental.status]}</p>
      {current >= 0 ? <ol>{statusOrder.slice(1, 7).map((status, index) => <li key={status} className={index + 1 <= current ? styles.done : ""}><span />{statusLabels[status]}</li>)}</ol> : null}
      <small>อัปเดต {formatBangkokDateTime(rental.updatedAt)} เวลาไทย</small>
      {["PENDING_PAYMENT", "PENDING_REVIEW"].includes(rental.status) ? <div className={styles.actions}><button className={styles.secondary} disabled={busy} onClick={() => onResume(rental.id)}>เปิดรายการ / ทำต่อ</button></div> : null}</article>;
  })}</section>;
}

function safeImageStyle(url: string): { backgroundImage?: string } {
  try { const parsed = new URL(url, typeof location === "undefined" ? "https://local.invalid" : location.origin); return ["http:", "https:", "data:"].includes(parsed.protocol) ? { backgroundImage: `url("${url.replace(/["\\]/g, "")}")` } : {}; }
  catch { return {}; }
}
function LoadingState() { return <section className={styles.loading} aria-live="polite"><span /><span /><span /><p>กำลังเตรียมข้อมูลจากระบบ…</p></section>; }
function StateNotice({ message, onRetry }: { message: string; onRetry: () => void }) { return <section className={styles.notice} role="alert"><b>ขออภัย มีบางอย่างติดขัด</b><p>{message}</p><button onClick={onRetry}>ลองอีกครั้ง</button></section>; }
