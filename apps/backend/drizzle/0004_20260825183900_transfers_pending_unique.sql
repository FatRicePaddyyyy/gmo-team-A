-- 同一ドメインに対して pendingTransfer が同時に 2 つ以上存在しないよう部分 UNIQUE 制約を張る。
-- SQLite の partial index で status='pendingTransfer' の行だけを対象にする。
CREATE UNIQUE INDEX `transfers_pending_domain_unique_idx`
  ON `transfers` (`domain_id`)
  WHERE `status` = 'pendingTransfer';
