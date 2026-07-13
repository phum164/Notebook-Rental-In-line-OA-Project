/* Generated-compatible database contract. Regenerate with `supabase gen types typescript --local` after a clean reset. */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type Table<Row, Insert = Partial<Row>, Update = Partial<Insert>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

type Id = string;
type Instant = string;
type CivilDate = string;

export type Database = {
  public: {
    Tables: {
      customers: Table<{
        id: Id; line_user_id: string; display_name: string | null; phone: string | null;
        disabled_at: Instant | null; created_at: Instant; updated_at: Instant;
      }>;
      admin_users: Table<{
        id: Id; role: Database["public"]["Enums"]["admin_role"]; disabled_at: Instant | null;
        created_at: Instant; updated_at: Instant;
      }>;
      laptops: Table<{
        id: Id; name: string; specs: Json; daily_rate_satang: number; deposit_satang: number;
        currency: "THB"; status: Database["public"]["Enums"]["laptop_status"];
        deleted_at: Instant | null; version: number; created_at: Instant; updated_at: Instant;
      }>;
      laptop_images: Table<{
        id: Id; laptop_id: Id; object_key: string; alt_text: string | null;
        sort_order: number; created_at: Instant;
      }>;
      rental_quotes: Table<{
        id: Id; customer_id: Id; laptop_id: Id; start_date: CivilDate; end_date: CivilDate;
        rental_days: number; daily_rate_satang: number; rental_subtotal_satang: number;
        deposit_satang: number; total_due_satang: number; currency: "THB";
        expires_at: Instant; created_at: Instant;
      }>;
      rentals: Table<{
        id: Id; customer_id: Id; laptop_id: Id; quote_id: Id | null; start_date: CivilDate;
        end_date: CivilDate; daily_rate_satang: number; rental_subtotal_satang: number;
        deposit_satang: number; total_due_satang: number; currency: "THB";
        status: Database["public"]["Enums"]["rental_status"]; hold_expires_at: Instant | null;
        fulfillment_method: Database["public"]["Enums"]["fulfillment_method"];
        recipient_name: string | null; contact_phone: string | null; address_snapshot: Json | null;
        outbound_tracking_reference: string | null; inbound_tracking_reference: string | null;
        handed_over_at: Instant | null; return_requested_at: Instant | null; returned_at: Instant | null;
        version: number; created_at: Instant; updated_at: Instant;
      }>;
      rental_inventory_reservations: Table<{
        rental_id: Id; laptop_id: Id; rental_dates: string; hold_expires_at: Instant | null; created_at: Instant;
      }>;
      contract_versions: Table<{
        id: Id; version: string; content_snapshot: string; content_sha256: string;
        published_by: Id; published_at: Instant; retired_at: Instant | null;
      }>;
      contract_acceptances: Table<{
        id: Id; rental_id: Id; customer_id: Id; contract_version_id: Id; content_sha256: string;
        accepted_at: Instant; request_id: string; ip_hash: string | null; user_agent_hash: string | null;
      }>;
      evidence_objects: Table<{
        id: Id; purpose: Database["public"]["Enums"]["evidence_purpose"];
        customer_id: Id | null; rental_id: Id | null; bucket_id: string; object_key: string;
        declared_mime_type: string; detected_mime_type: string | null; size_bytes: number;
        status: Database["public"]["Enums"]["evidence_status"]; finalized_at: Instant | null; created_at: Instant;
      }>;
      upload_intents: Table<{
        id: Id; evidence_id: Id; owner_customer_id: Id | null; expires_at: Instant;
        consumed_at: Instant | null; created_at: Instant;
      }>;
      payments: Table<{
        id: Id; rental_id: Id; type: Database["public"]["Enums"]["payment_type"];
        status: Database["public"]["Enums"]["payment_status"]; amount_satang: number; currency: "THB";
        evidence_id: Id | null; attempt_number: number; submitted_at: Instant | null;
        verified_by: Id | null; verified_at: Instant | null; decision_reason: string | null;
        provider_reference: string | null; created_at: Instant; updated_at: Instant;
      }>;
      condition_logs: Table<{
        id: Id; rental_id: Id; inspection_type: Database["public"]["Enums"]["inspection_type"];
        notes: string | null; finalized_at: Instant | null; finalized_by: Id | null;
        supersedes_id: Id | null; created_by: Id; created_at: Instant;
      }>;
      condition_log_evidence: Table<{ condition_log_id: Id; evidence_id: Id; sort_order: number }>;
      fee_obligations: Table<{
        id: Id; rental_id: Id; category: string; amount_satang: number; reason: string;
        assessed_by: Id; created_at: Instant;
      }>;
      refunds: Table<{
        id: Id; rental_id: Id; status: Database["public"]["Enums"]["refund_status"];
        amount_satang: number; currency: "THB"; reason: string; requested_by: Id | null;
        approved_by: Id | null; idempotency_key: string; provider_reference: string | null;
        completed_at: Instant | null; created_at: Instant; updated_at: Instant;
      }>;
      refund_attempts: Table<{
        id: Id; refund_id: Id; attempt_number: number; outcome: string;
        provider_reference: string | null; error_category: string | null; attempted_at: Instant;
      }>;
      rental_status_history: Table<{
        id: number; rental_id: Id; prior_status: Database["public"]["Enums"]["rental_status"] | null;
        new_status: Database["public"]["Enums"]["rental_status"];
        actor_type: Database["public"]["Enums"]["actor_type"]; actor_id: Id | null;
        reason: string | null; request_id: string | null; created_at: Instant;
      }>;
      audit_events: Table<{
        id: number; actor_type: Database["public"]["Enums"]["actor_type"]; actor_id: Id | null;
        action: string; target_type: string; target_id: Id | null; request_id: string | null;
        idempotency_key: string | null; prior_status: string | null; new_status: string | null;
        outcome: string; metadata: Json; occurred_at: Instant;
      }>;
      idempotency_records: Table<{
        id: Id; principal_type: Database["public"]["Enums"]["actor_type"]; principal_id: Id;
        operation: string; target_id: Id | null; idempotency_key: string; request_hash: string;
        response_status: number | null; response_body: Json | null; created_at: Instant; expires_at: Instant | null;
      }>;
      notification_outbox: Table<{
        id: Id; aggregate_type: string; aggregate_id: Id; event_type: string;
        recipient_customer_id: Id | null; payload: Json; idempotency_key: string;
        status: Database["public"]["Enums"]["outbox_status"]; attempts: number;
        next_attempt_at: Instant; delivered_at: Instant | null; created_at: Instant;
      }>;
      system_settings: Table<{
        key: string; value: Json; version: number; updated_by: Id; updated_at: Instant;
      }>;
    };
    Views: Record<string, never>;
    Functions: {
      current_customer_id: { Args: Record<PropertyKey, never>; Returns: Id | null };
      current_admin_id: { Args: Record<PropertyKey, never>; Returns: Id | null };
      has_admin_role: { Args: { required_roles: Database["public"]["Enums"]["admin_role"][] }; Returns: boolean };
      owns_rental: { Args: { candidate_rental_id: Id }; Returns: boolean };
      can_insert_storage_object: { Args: { candidate_bucket: string; candidate_name: string }; Returns: boolean };
      expire_rental_holds: { Args: { p_limit?: number }; Returns: number };
    };
    Enums: {
      admin_role: "OWNER" | "OPERATIONS" | "REVIEWER" | "VIEWER";
      laptop_status: "AVAILABLE" | "RESERVED" | "RENTED" | "MAINTENANCE" | "RETIRED";
      rental_status: "DRAFT" | "PENDING_PAYMENT" | "PENDING_REVIEW" | "APPROVED" | "PREPARING" | "READY_FOR_HANDOVER" | "ACTIVE" | "RETURN_PENDING" | "INSPECTION_PENDING" | "REFUND_PENDING" | "COMPLETED" | "REJECTED" | "CANCELLED" | "EXPIRED";
      payment_status: "PENDING" | "SUBMITTED" | "VERIFIED" | "REJECTED" | "VOIDED";
      payment_type: "RENT_AND_DEPOSIT" | "LATE_FEE" | "DAMAGE_FEE" | "REFUND";
      refund_status: "NOT_REQUIRED" | "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED" | "CANCELLED";
      inspection_type: "BEFORE_RENT" | "AFTER_RETURN";
      fulfillment_method: "PICKUP" | "DELIVERY";
      evidence_purpose: "KYC_ID" | "PAYMENT_SLIP" | "CONDITION_BEFORE" | "CONDITION_AFTER" | "LAPTOP_PRODUCT";
      evidence_status: "PENDING_UPLOAD" | "QUARANTINED" | "READY" | "REJECTED";
      actor_type: "CUSTOMER" | "ADMIN" | "SYSTEM" | "SERVICE_WORKER";
      outbox_status: "PENDING" | "PROCESSING" | "DELIVERED" | "FAILED";
    };
    CompositeTypes: Record<string, never>;
  };
};
