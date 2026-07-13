"use client";

import { useMemo, useState } from "react";
import {
  formatBangkokDateTime,
  formatMoney,
  getMockSnapshot,
  type DemoScenario,
  validateCustomer,
  validatePrivateImage,
} from "@/lib/liff/customer-adapter";
import styles from "./customer.module.css";

const scenarios: readonly { value: DemoScenario; label: string }[] = [
  { value: "ready", label: "พร้อมใช้งาน" }, { value: "loading", label: "กำลังโหลด" },
  { value: "empty", label: "ไม่มีข้อมูล" }, { value: "error", label: "ระบบขัดข้อง" },
  { value: "expired", label: "เซสชันหมดอายุ" }, { value: "conflict", label: "วันจองชน" },
  { value: "upload-failure", label: "อัปโหลดล้มเหลว" },
];

const statusSteps = ["ส่งคำขอ", "รอตรวจสอบ", "อนุมัติ", "เตรียมเครื่อง", "รับเครื่อง"] as const;

export function CustomerApp() {
  const [scenario, setScenario] = useState<DemoScenario>("ready");
  const [selected, setSelected] = useState(0);
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [kycReady, setKycReady] = useState(false);
  const [slipReady, setSlipReady] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const snapshot = useMemo(() => getMockSnapshot(scenario), [scenario]);
  const laptop = snapshot.laptops[selected] ?? snapshot.laptops[0];
  const customerValid = validateCustomer(name, phone);
  const canSubmit = customerValid && kycReady && slipReady && accepted && scenario === "ready";

  function receiveFile(file: File | undefined, kind: "kyc" | "slip") {
    if (!file) return;
    const validation = validatePrivateImage(file);
    if (!validation.valid || scenario === "upload-failure") {
      setUploadMessage(validation.reason ?? "อัปโหลดไม่สำเร็จ กรุณาลองอีกครั้ง");
      if (kind === "kyc") setKycReady(false); else setSlipReady(false);
      return;
    }
    setUploadMessage("ตรวจไฟล์แล้ว พร้อมส่งแบบ private เมื่อยืนยัน");
    if (kind === "kyc") setKycReady(true); else setSlipReady(true);
  }

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div><span className={styles.eyebrow}>REDBOOK RENTAL</span><h1>หาเครื่องที่ใช่<br />เช่าได้ในไม่กี่ขั้นตอน</h1></div>
        <div className={styles.session} aria-label="สถานะเซสชัน"><span /> LINE connected · mock</div>
      </header>

      <section className={styles.demo} aria-labelledby="demo-title">
        <label id="demo-title" htmlFor="scenario">ดูสถานะหน้าจอ</label>
        <select id="scenario" value={scenario} onChange={(event) => setScenario(event.target.value as DemoScenario)}>
          {scenarios.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
      </section>

      {scenario === "loading" ? <LoadingState /> : null}
      {snapshot.message ? <StateNotice scenario={scenario} message={snapshot.message} onRetry={() => setScenario("ready")} /> : null}

      {scenario !== "loading" && scenario !== "empty" && scenario !== "error" && scenario !== "expired" ? (
        <>
          <section className={styles.section} aria-labelledby="catalog-title">
            <div className={styles.sectionHead}><div><span className={styles.kicker}>01 · เลือกเครื่อง</span><h2 id="catalog-title">พร้อมไปกับทุกงาน</h2></div><span className={styles.count}>{snapshot.laptops.length} เครื่อง</span></div>
            <div className={styles.cards}>
              {snapshot.laptops.map((item, index) => (
                <button className={`${styles.card} ${index === selected ? styles.selected : ""}`} key={item.id} onClick={() => setSelected(index)} aria-pressed={index === selected}>
                  <div className={styles.device} aria-hidden="true"><span /></div>
                  <strong>{item.name}</strong><small>{item.tagline}</small>
                  <div><b>{formatMoney(item.dailyRate)}</b><span> / วัน</span></div>
                </button>
              ))}
            </div>
          </section>

          {laptop ? <section className={styles.detail} aria-labelledby="detail-title">
            <span className={styles.kicker}>02 · รายละเอียดและวันเช่า</span><h2 id="detail-title">{laptop.name}</h2>
            <ul className={styles.specs}>{laptop.specs.map((spec) => <li key={spec}>{spec}</li>)}</ul>
            <div className={styles.dates}><label>วันเริ่ม<input type="date" defaultValue="2026-07-20" /></label><label>วันคืน<input type="date" defaultValue="2026-07-22" /></label></div>
            {scenario === "conflict" ? null : snapshot.quote ? <div className={styles.quote}>
              <div><span>ค่าเช่า {snapshot.quote.rentalDays} วัน</span><strong>{formatMoney(snapshot.quote.rentalSubtotal)}</strong></div>
              <div><span>เงินมัดจำ</span><strong>{formatMoney(snapshot.quote.deposit)}</strong></div>
              <div className={styles.total}><span>ยอดที่ต้องชำระ</span><strong>{formatMoney(snapshot.quote.totalDue)}</strong></div>
              <small>ราคาจากระบบ · quote มีอายุจำกัดและจะตรวจวันว่างอีกครั้งตอนยืนยัน</small>
            </div> : null}
          </section> : null}

          <section className={styles.section} aria-labelledby="booking-title">
            <span className={styles.kicker}>03 · จองและยืนยัน</span><h2 id="booking-title">ครบ ชัด ปลอดภัย</h2>
            <nav className={styles.steps} aria-label="ขั้นตอนการจอง">{["ข้อมูล", "KYC", "สัญญา", "ชำระเงิน"].map((label, index) => <button key={label} onClick={() => setStep(index + 1)} aria-current={step === index + 1 ? "step" : undefined}><span>{index + 1}</span>{label}</button>)}</nav>
            <div className={styles.formCard}>
              {step === 1 ? <div className={styles.form}><label>ชื่อสำหรับติดต่อ<input value={name} onChange={(e) => setName(e.target.value)} placeholder="ชื่อ-นามสกุล" /></label><label>เบอร์โทร<input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0812345678" /></label>{(name || phone) && !customerValid ? <p role="alert">กรอกชื่อและเบอร์โทร 9–15 หลักให้ครบ</p> : null}</div> : null}
              {step === 2 ? <UploadPanel label="ภาพเอกสาร KYC" ready={kycReady} onFile={(file) => receiveFile(file, "kyc")} /> : null}
              {step === 3 ? <div><h3>ข้อตกลงการเช่า · ฉบับตัวอย่าง</h3><p className={styles.copy}>อ่านเนื้อหาฉบับที่ระบบส่งมาให้ครบก่อนยอมรับ ระบบจริงจะบันทึก version, hash และเวลาที่กดยอมรับ</p><label className={styles.check}><input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} /> ฉันอ่านและยอมรับข้อตกลงฉบับนี้</label></div> : null}
              {step === 4 ? <><div className={styles.qr} aria-label="พื้นที่ QR ชำระเงิน"><span>QR</span><small>ตัวอย่างเท่านั้น</small></div><UploadPanel label="สลิปการโอน" ready={slipReady} onFile={(file) => receiveFile(file, "slip")} /></> : null}
              {uploadMessage ? <p className={styles.uploadMessage} role="status">{uploadMessage}</p> : null}
              <div className={styles.actions}><button className={styles.secondary} disabled={step === 1} onClick={() => setStep(Math.max(1, step - 1))}>ย้อนกลับ</button>{step < 4 ? <button className={styles.primary} onClick={() => setStep(Math.min(4, step + 1))}>ถัดไป</button> : <button className={styles.primary} disabled={!canSubmit}>ส่งหลักฐานเพื่อรอตรวจสอบ</button>}</div>
              {!canSubmit && step === 4 ? <small className={styles.hint}>ต้องกรอกข้อมูล, แนบ KYC/สลิป และยอมรับสัญญาให้ครบ</small> : null}
            </div>
          </section>

          {snapshot.rental ? <section className={styles.status} aria-labelledby="status-title">
            <span className={styles.kicker}>04 · ติดตามรายการ</span><h2 id="status-title">อยู่ระหว่างตรวจสอบ</h2><p>{snapshot.rental.laptopName} · {snapshot.rental.startDate} — {snapshot.rental.endDate}</p>
            <ol>{statusSteps.map((label, index) => <li key={label} className={index < 2 ? styles.done : ""}><span />{label}</li>)}</ol>
            <small>อัปเดต {formatBangkokDateTime(snapshot.rental.updatedAt)} เวลาไทย</small>
          </section> : null}
        </>
      ) : null}

      <footer className={styles.footer}><div><strong>ต้องการความช่วยเหลือ?</strong><span>คุยกับทีมผ่าน LINE OA</span></div><a href="https://line.me/" target="_blank" rel="noreferrer">เปิดแชต LINE</a><small>Mock UI เท่านั้น · ไม่มีข้อมูลหรือไฟล์ถูกส่งออกจากอุปกรณ์</small></footer>
    </main>
  );
}

function UploadPanel({ label, ready, onFile }: { label: string; ready: boolean; onFile: (file: File | undefined) => void }) {
  return <div><h3>{label}</h3><label className={styles.upload}><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => onFile(e.target.files?.[0])} /><span>{ready ? "ตรวจไฟล์แล้ว ✓" : "แตะเพื่อเลือก JPG, PNG หรือ WebP"}</span><small>สูงสุด 10 MB · ไฟล์ส่วนตัว ไม่สร้างลิงก์ถาวร</small></label></div>;
}

function LoadingState() { return <section className={styles.loading} aria-live="polite"><span /><span /><span /><p>กำลังเตรียมรายการเครื่อง…</p></section>; }

function StateNotice({ scenario, message, onRetry }: { scenario: DemoScenario; message: string; onRetry: () => void }) {
  return <section className={styles.notice} role={scenario === "error" || scenario === "expired" ? "alert" : "status"}><b>{scenario === "empty" ? "ยังไม่เจอเครื่อง" : scenario === "conflict" ? "รายการเปลี่ยนแปลง" : "ขออภัย มีบางอย่างติดขัด"}</b><p>{message}</p><button onClick={onRetry}>{scenario === "expired" ? "เข้าสู่ระบบผ่าน LINE อีกครั้ง" : "ลองอีกครั้ง"}</button></section>;
}
