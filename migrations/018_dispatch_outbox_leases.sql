ALTER TABLE dispatch_outbox
  ADD COLUMN lease_owner text,
  ADD COLUMN lease_expires_at timestamptz,
  ADD COLUMN delivery_attempts integer NOT NULL DEFAULT 0 CHECK (delivery_attempts >= 0),
  ADD CONSTRAINT dispatch_outbox_lease_pair_check
    CHECK ((lease_owner IS NULL) = (lease_expires_at IS NULL));

DROP INDEX dispatch_outbox_pending_idx;

CREATE INDEX dispatch_outbox_pending_idx
  ON dispatch_outbox (queue_name, available_at, lease_expires_at, id)
  WHERE dispatched_at IS NULL;
