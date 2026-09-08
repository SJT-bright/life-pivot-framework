ALTER TABLE manual_skincare_products
  ADD COLUMN photo_blob BLOB
  CHECK (
    photo_blob IS NULL OR length(photo_blob) BETWEEN 1 AND 2097152
  );

ALTER TABLE manual_skincare_products
  ADD COLUMN photo_mime TEXT
  CHECK (
    (photo_blob IS NULL AND photo_mime IS NULL) OR
    (photo_blob IS NOT NULL AND photo_mime IN ('image/jpeg', 'image/png', 'image/webp'))
  );

UPDATE app_meta SET value = '21' WHERE key = 'schema_version';
