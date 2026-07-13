export type SessionState = "initializing" | "ready" | "expired" | "error";

export interface LiffSessionView {
  state: SessionState;
  message: string;
  actionLabel?: string;
}

export function sessionView(state: SessionState): LiffSessionView {
  switch (state) {
    case "initializing": return { state, message: "กำลังเชื่อมต่อ LINE…" };
    case "ready": return { state, message: "เชื่อมต่ออย่างปลอดภัยแล้ว" };
    case "expired": return { state, message: "เซสชันหมดอายุ", actionLabel: "เข้าสู่ระบบผ่าน LINE อีกครั้ง" };
    case "error": return { state, message: "เชื่อมต่อ LINE ไม่สำเร็จ", actionLabel: "ลองอีกครั้ง" };
  }
}
