# **System Requirement & Architecture Spec: ระบบปล่อยเช่าโน๊ตบุ๊คออนไลน์**

**Document Version:** 1.0  
**Project Description:** ระบบจัดการการเช่าโน๊ตบุ๊คออนไลน์แบบครบวงจร รองรับการใช้งานของลูกค้าผ่าน Line OA (LIFF App) โดยไม่ต้องสมัครสมาชิกใหม่ และมีระบบหลังบ้านสำหรับแอดมินเพื่อจัดการสต๊อก สัญญา และตรวจสอบสภาพเครื่อง

## **1\. Updated Use Cases (สรุปความต้องการของระบบ)**

### **👤 ฝั่งผู้ใช้งาน (Customer / Line User)**

* **Browsing:** ดูรายการโน๊ตบุ๊คที่ว่างพร้อมเช่า รวมถึงรายละเอียดสเปคและราคา  
* **Calculating:** คำนวณค่าเช่ารวมตามจำนวนวันและค่ามัดจำ  
* **Booking & KYC:** กดทำรายการเช่า พร้อมระบบยืนยันตัวตน (KYC) โดยการอัปโหลดรูปถ่ายบัตรประชาชน  
* **Contract Agreement:** อ่านและกดยอมรับเงื่อนไข/สัญญาเช่าก่อนทำรายการ  
* **Payment:** ชำระเงินผ่านการโอน (QR Code) และอัปโหลดสลิปผ่านระบบ  
* **Tracking:** ติดตามสถานะออเดอร์ของตนเอง (เช่น รอตรวจสอบ, กำลังจัดส่ง, เช่าอยู่)  
* **Communication:** ติดต่อแอดมินผ่าน Line OA

### **👑 ฝั่งผู้ดูแลระบบ (Admin / Owner)**

* **Inventory Management:** เพิ่ม/ลบ/แก้ไข ข้อมูลโน๊ตบุ๊ค สเปค ราคาเช่ารายวัน สถานะเครื่อง (ว่าง, ติดเช่า, ส่งซ่อม)  
* **Order Management:** อนุมัติการเช่า ตรวจสอบสลิปโอนเงิน และตรวจสอบความถูกต้องของบัตรประชาชน  
* **Condition Tracking (New):** บันทึกรูปภาพสภาพเครื่อง **ก่อนส่งมอบ** และ **หลังรับคืน** พร้อมแนบโน้ตเพื่อเป็นหลักฐานป้องกันข้อพิพาท  
* **Deposit Management (New):** จัดการคืนเงินมัดจำเมื่อลูกค้าคืนเครื่องและสภาพเครื่องปกติ  
* **System Settings:** ปรับแก้ข้อความตอบกลับอัตโนมัติ ข้อกำหนด สัญญาเช่า และ QR Code รับเงินผ่านหน้าหลังบ้าน

## **2\. System Architecture**

สถาปัตยกรรมเน้นความคุ้มค่า (Cost-Effective) โดยใช้บริการระดับ Free Tier เป็นหลัก เหมาะสำหรับการเริ่มต้นและขยายสเกลในอนาคต

### **Tech Stack**

| Component | Technology | Note |
| :---- | :---- | :---- |
| **Frontend** | Next.js (React), Tailwind CSS | ทำ Line LIFF (ลูกค้า) และ Dashboard (แอดมิน) |
| **Backend (API)** | Next.js API Routes | Serverless API รองรับ RESTful |
| **Database** | PostgreSQL (Supabase) | Relational DB เหมาะกับข้อมูลที่มีความเชื่อมโยงสูง |
| **File Storage** | Supabase Storage | เก็บรูปเครื่อง, รูปสลิป, รูปบัตรประชาชน |
| **Hosting** | Vercel | โฮสต์ Next.js ฟรีและเสถียร |
| **Integration** | Line Messaging API | เชื่อมต่อแชทและแจ้งเตือนผ่าน Line OA |

### **Workflow Flow**

1. **Line OA \-\> LIFF:** ลูกค้ากดเมนูใน Line เพื่อเปิดหน้าเว็บ (LIFF App) ดึง line\_user\_id เป็นตัวแทนบัญชี  
2. **Order & Upload:** ลูกค้าทำรายการ ไฟล์ภาพ (สลิป, บัตรปชช) ถูกส่งไปเก็บที่ Supabase Storage และส่ง URL กลับมาบันทึกลง Database  
3. **Notify Admin:** ระบบเรียก Line Messaging API ยิงแจ้งเตือนแอดมินว่ามีคำสั่งซื้อใหม่  
4. **Admin Process:** แอดมินจัดการคำสั่งซื้อ อัปเดตสถานะผ่านเว็บ Dashboard \-\> ข้อมูลวิ่งกลับไปอัปเดตที่ Supabase

## **3\. Database Schema (PostgreSQL)**

### **Entity Relationship Diagram (ERD)**

Code snippet  
erDiagram  
    CUSTOMERS ||--o{ RENTALS : "places"  
    LAPTOPS ||--o{ RENTALS : "is rented in"  
    RENTALS ||--o{ PAYMENTS : "has"  
    RENTALS ||--o{ CONDITION\_LOGS : "is inspected via"  
      
    CUSTOMERS {  
        uuid id PK  
        string line\_user\_id UK  
        string name  
        string phone  
        string id\_card\_image\_url  
        datetime created\_at  
    }

    LAPTOPS {  
        uuid id PK  
        string name  
        text specs  
        decimal daily\_rate  
        decimal deposit\_amount  
        jsonb images  
        enum status "AVAILABLE, RENTED, MAINTENANCE"  
    }

    RENTALS {  
        uuid id PK  
        uuid customer\_id FK  
        uuid laptop\_id FK  
        datetime start\_date  
        datetime end\_date  
        datetime actual\_return\_date  
        decimal total\_rent\_price  
        decimal deposit\_amount  
        enum status "PENDING, APPROVED, ACTIVE, COMPLETED, CANCELLED"  
        boolean contract\_agreed  
        datetime created\_at  
    }

    PAYMENTS {  
        uuid id PK  
        uuid rental\_id FK  
        enum type "RENT\_AND\_DEPOSIT, REFUND, LATE\_FEE, DAMAGE\_FEE"  
        decimal amount  
        string slip\_image\_url  
        enum status "PENDING, VERIFIED, REJECTED"  
        datetime paid\_at  
    }

    CONDITION\_LOGS {  
        uuid id PK  
        uuid rental\_id FK  
        enum inspect\_type "BEFORE\_RENT, AFTER\_RETURN"  
        jsonb images  
        text notes  
        datetime created\_at  
    }

    SYSTEM\_SETTINGS {  
        string key PK  
        text value  
        datetime updated\_at  
    }

### **Data Dictionary & Constraints**

* CUSTOMERS.line\_user\_id: ต้องเป็น Unique เพื่อใช้ Identify ลูกค้าเก่า/ใหม่  
* LAPTOPS.images, CONDITION\_LOGS.images: เก็บเป็น JSON Array ของ URL เพื่อรองรับการอัปโหลดหลายรูป  
* **Enums:**  
  * Laptop Status: AVAILABLE, RENTED, MAINTENANCE  
  * Rental Status: PENDING, APPROVED, ACTIVE (กำลังเช่า), COMPLETED (คืนแล้ว), CANCELLED  
  * Payment Type: RENT\_AND\_DEPOSIT (ลูกค้าจ่าย), REFUND (คืนมัดจำ), LATE\_FEE (ค่าปรับเกินเวลา), DAMAGE\_FEE (ค่าปรับพัง)

## **4\. Technical Notes สำหรับทีมพัฒนา (Developer Notes)**

1. **Timezone:** ข้อมูลวันที่และเวลาทั้งหมด (created\_at, start\_date, end\_date) ให้จัดเก็บในรูปแบบ UTC เสมอ และทำการแปลงเป็น UTC+7 (Asia/Bangkok) ที่ฝั่ง Frontend  
2. **Soft Delete:** โต๊ะ Laptops ให้เพิ่มคอลัมน์ is\_deleted (Boolean) หรือ deleted\_at (Timestamp) แทนการลบ row ทิ้ง (Hard Delete) เพื่อรักษา Referential Integrity ของประวัติการเช่าเก่าๆ  
3. **Data Privacy (PDPA):** ภาพบัตรประชาชนในตาราง Customers ควรมีการกำหนดสิทธิ์ (Bucket Policy) ใน Storage ให้เฉพาะ Admin ที่ผ่านการยืนยันตัวตนแล้วเท่านั้นที่สามารถเปิดดูได้  
4. **Data Types:** ยอดเงิน (Price, Amount) แนะนำให้ใช้ Type เป็น Decimal(10,2) หรือเก็บเป็น Integer (หน่วยสตางค์) แล้วค่อยหาร 100 ตอนแสดงผลเพื่อป้องกันปัญหา Floating Point

