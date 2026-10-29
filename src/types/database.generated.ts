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
        expires_at: Instant; consumed_at: Instant | null; created_at: Instant;
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
        version_number: number; title: string; effective_at: Instant;
        published_by: Id; published_at: Instant; retired_at: Instant | null;
      }>;
      contract_acceptances: Table<{
        id: Id; rental_id: Id; customer_id: Id; contract_version_id: Id; content_sha256: string;
        accepted_at: Instant; request_id: string; ip_hash: string | null; user_agent_hash: string | null;
      }>;
      evidence_objects: Table<{
        id: Id; purpose: Database["public"]["Enums"]["evidence_purpose"];
        customer_id: Id | null; rental_id: Id | null; laptop_id: Id | null; bucket_id: string; object_key: string;
        declared_mime_type: string; detected_mime_type: string | null; size_bytes: number;
        content_sha256: string | null; scan_result: "CLEAN" | "QUARANTINED" | null;
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
        lease_token: Id | null; lease_expires_at: Instant | null; last_error_category: string | null;
      }>;
      line_webhook_receipts: Table<{
        id: Id; provider_event_id: string; event_type: string; occurred_at: Instant | null;
        payload_hash: string; status: "RECEIVED" | "PROCESSING" | "PROCESSED" | "IGNORED" | "FAILED" | "DEAD";
        attempts: number; next_attempt_at: Instant; lease_token: Id | null;
        lease_expires_at: Instant | null; last_error_category: string | null;
        created_at: Instant; processed_at: Instant | null;
      }>;
      rental_financial_dispositions: Table<{
        rental_id: Id; inspection_id: Id; kind: "NO_FEES" | "ITEMIZED";
        deposit_satang: number; fee_total_satang: number; refundable_satang: number;
        fee_snapshot: Json; refund_id: Id; reason: string; finalized_by: Id; finalized_at: Instant;
      }>;
      system_settings: Table<{
        key: string; value: Json; version: number; updated_by: Id; updated_at: Instant;
      }>;
      line_bootstrap_nonces: Table<{
        nonce_hash: string; browser_binding_hash: string; issued_at: Instant;
        expires_at: Instant; consumed_at: Instant | null;
      }>;
      app_sessions: Table<{
        id: Id; customer_id: Id; token_hash: string; csrf_hash: string; issued_at: Instant;
        last_used_at: Instant; idle_expires_at: Instant; absolute_expires_at: Instant;
        rotated_from_id: Id | null; revoked_at: Instant | null;
      }>;
      kyc_submissions: Table<{ id: Id; rental_id: Id; customer_id: Id; created_at: Instant }>;
      kyc_submission_evidence: Table<{ submission_id: Id; evidence_id: Id }>;
      kyc_decisions: Table<{
        id: Id; submission_id: Id; status: Database["public"]["Enums"]["kyc_review_status"];
        decided_by: Id; reason: string | null; decided_at: Instant;
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
      app_issue_line_bootstrap_nonce: { Args: { p_nonce_hash: string; p_browser_binding_hash: string; p_expires_at: Instant }; Returns: Json };
      app_create_line_session: { Args: { p_nonce_hash: string; p_browser_binding_hash: string; p_line_subject: string; p_session_token_hash: string; p_csrf_hash: string; p_display_name: string | null; p_idle_expires_at: Instant; p_absolute_expires_at: Instant }; Returns: Json };
      app_resolve_session: { Args: { p_session_token_hash: string }; Returns: Json };
      app_revoke_session: { Args: { p_session_token_hash: string }; Returns: boolean };
      list_public_laptops: { Args: { p_start_date?: CivilDate; p_end_date?: CivilDate; p_limit?: number; p_cursor?: Id }; Returns: Json };
      get_public_laptop: { Args: { p_laptop_id: Id }; Returns: Json };
      get_current_contract: { Args: Record<PropertyKey, never>; Returns: Json };
      get_payment_settings: { Args: Record<PropertyKey, never>; Returns: Json };
      list_own_rentals: { Args: { p_limit?: number; p_cursor?: Id }; Returns: Json };
      get_own_rental: { Args: { p_rental_id: Id }; Returns: Json };
      create_rental_quote: { Args: { p_laptop_id: Id; p_start_date: CivilDate; p_end_date: CivilDate }; Returns: Json };
      create_rental_from_quote: { Args: { p_quote_id: Id; p_customer_name: string; p_customer_phone: string; p_idempotency_key: string; p_request_hash: string; p_request_id: string }; Returns: Json };
      accept_rental_contract: { Args: { p_rental_id: Id; p_contract_version_id: Id; p_content_hash: string; p_idempotency_key: string; p_request_hash: string; p_request_id: string; p_ip_hash?: string; p_user_agent_hash?: string }; Returns: Json };
      create_upload_intent_record: { Args: { p_purpose: Database["public"]["Enums"]["evidence_purpose"]; p_target_id: Id; p_filename: string; p_mime_type: string; p_size_bytes: number }; Returns: Json };
      authorize_upload_scan: { Args: { p_upload_id: Id }; Returns: Json };
      can_scan_storage_object: { Args: { candidate_bucket: string; candidate_name: string }; Returns: boolean };
      finalize_upload_intent_record: { Args: { p_upload_id: Id; p_detected_mime_type: string; p_detected_size_bytes: number; p_content_sha256: string; p_scan_result: string; p_idempotency_key: string; p_request_hash: string; p_request_id: string }; Returns: Json };
      submit_rental_payment: { Args: { p_rental_id: Id; p_evidence_id: Id; p_payment_type: Database["public"]["Enums"]["payment_type"]; p_idempotency_key: string; p_request_hash: string; p_request_id: string }; Returns: Json };
      list_admin_rentals: { Args: { p_status?: Database["public"]["Enums"]["rental_status"]; p_limit?: number; p_cursor?: Id }; Returns: Json };
      get_admin_session: { Args: Record<PropertyKey, never>; Returns: Json };
      get_admin_rental: { Args: { p_rental_id: Id }; Returns: Json };
      list_admin_laptops: { Args: { p_include_retired?: boolean; p_limit?: number; p_cursor?: Id }; Returns: Json };
      verify_rental_kyc: { Args: { p_rental_id: Id; p_evidence_ids: Id[]; p_reason: string | null; p_expected_version: number; p_idempotency_key: string; p_request_hash: string; p_request_id: string }; Returns: Json };
      reject_rental_kyc: { Args: { p_rental_id: Id; p_evidence_ids: Id[]; p_reason: string; p_expected_version: number; p_idempotency_key: string; p_request_hash: string; p_request_id: string }; Returns: Json };
      verify_rental_payment: { Args: { p_rental_id: Id; p_payment_id: Id; p_provider_reference: string; p_reason: string; p_expected_version: number; p_idempotency_key: string; p_request_hash: string; p_request_id: string }; Returns: Json };
      reject_rental_payment: { Args: { p_rental_id: Id; p_payment_id: Id; p_reason: string; p_expected_version: number; p_idempotency_key: string; p_request_hash: string; p_request_id: string }; Returns: Json };
      create_admin_laptop: { Args: Record<string, unknown>; Returns: Json };
      update_admin_laptop: { Args: Record<string, unknown>; Returns: Json };
      retire_admin_laptop: { Args: Record<string, unknown>; Returns: Json };
      execute_rental_command: { Args: Record<string, unknown>; Returns: Json };
      list_rental_inspections: { Args: { p_rental_id: Id }; Returns: Json };
      create_rental_inspection: { Args: Record<string, unknown>; Returns: Json };
      create_rental_fee_obligation: { Args: Record<string, unknown>; Returns: Json };
      request_rental_refund: { Args: Record<string, unknown>; Returns: Json };
      list_admin_rental_history: { Args: { p_rental_id: Id; p_limit?: number; p_cursor?: number }; Returns: Json };
      authorize_evidence_read: { Args: { p_evidence_id: Id }; Returns: Json };
      list_admin_settings: { Args: Record<PropertyKey, never>; Returns: Json };
      update_admin_setting: { Args: Record<string, unknown>; Returns: Json };
      publish_admin_contract: { Args: Record<string, unknown>; Returns: Json };
      list_admin_audit_events: { Args: { p_target_type?: string; p_target_id?: Id; p_limit?: number; p_cursor?: number }; Returns: Json };
      claim_notification_outbox: { Args: { p_limit?: number }; Returns: Json };
      complete_notification_outbox: { Args: { p_event_id: Id; p_lease_token: Id; p_delivered: boolean; p_error_category?: string; p_retry_after_seconds?: number }; Returns: boolean };
      persist_line_webhook_receipts: { Args: { p_events: Json }; Returns: Json };
      claim_line_webhook_receipts: { Args: { p_limit?: number }; Returns: Json };
      complete_line_webhook_receipt: { Args: { p_receipt_id: Id; p_lease_token: Id; p_outcome: "PROCESSED" | "IGNORED" | "FAILED"; p_error_category?: string; p_retry_after_seconds?: number }; Returns: boolean };
      get_rental_financial_summary: { Args: { p_rental_id: Id }; Returns: Json };
      confirm_rental_refund: { Args: { p_rental_id: Id; p_refund_id: Id; p_amount_satang: number; p_provider_reference: string; p_reason: string; p_expected_version: number; p_idempotency_key: string; p_request_hash: string; p_request_id: string }; Returns: Json };
      set_admin_laptop_status: { Args: { p_laptop_id: Id; p_status: "AVAILABLE" | "MAINTENANCE"; p_reason: string; p_expected_version: number; p_idempotency_key: string; p_request_hash: string; p_request_id: string }; Returns: Json };
      attach_admin_laptop_image: { Args: { p_laptop_id: Id; p_evidence_id: Id; p_alt_text: string | null; p_expected_version: number; p_idempotency_key: string; p_request_hash: string; p_request_id: string }; Returns: Json };
      get_customer_public_settings: { Args: Record<PropertyKey, never>; Returns: Json };
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
      kyc_review_status: "PENDING" | "VERIFIED" | "REJECTED";
    };
    CompositeTypes: Record<string, never>;
  };
};
